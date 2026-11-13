import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchApprovedExperienceEvidence, type ApprovedExperienceSearchResult } from "../experience/approvedSearch";
import { buildEvidenceContext, citationFromEvidence, evidenceKey, retainedSourceSpan } from "./context";
import type { JdFitRequirement } from "./contracts";
import { JdFitError } from "./contracts";
import { JdFitDeadline } from "./generation";
import { retrieveRequirementEvidence, type JdFitSearch } from "./retrieval";
import { makeHit, scriptedSearch } from "./testFixtures";

function requirement(id: number, query = `query ${id}`): JdFitRequirement {
  return { requirement_id: `R${id}`, text: `Requirement ${id}`, importance: "required", retrieval_query: query };
}

const vector = () => Array.from({ length: 1536 }, (_, index) => (index === 0 ? 1 : 0));

/**
 * Fake RPC with the same eligibility rule as match_approved_experience_chunks: only rows of a non-deleted source's
 * active revision are returned. It records every RPC call so tests can inspect arguments.
 */
function activeRevisionDatabase(
  sources: Array<{ sourceId: string; activeRevisionId: string | null; latestApprovedRevisionId: string }>,
  rows: ApprovedExperienceSearchResult[],
) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const active = new Map(sources.map((source) => [source.sourceId, source.activeRevisionId]));
      const data = rows
        .filter((row) => active.get(row.source_id) === row.revision_id)
        .map((row) => ({
          ...row,
          parent_source_document_id: row.parent.source_document_id,
          parent_source_file_name: row.parent.source_file_name,
          parent_source_file_type: row.parent.source_file_type,
          parent_text: row.parent.parent_text,
          parent_metadata: row.parent.metadata,
          parent_created_at: row.parent.created_at,
          parent_updated_at: row.parent.updated_at,
        }));
      return { data, error: null };
    },
  };
  const search: JdFitSearch = (query, options) =>
    searchApprovedExperienceEvidence(query, { ...options, client, embed: async () => vector() });
  return { search, calls };
}

describe("JD-fit approved evidence retrieval", () => {
  it("calls only the approved-search helper, never with a source list, at most four at a time", async () => {
    const requirements = Array.from({ length: 10 }, (_, index) => requirement(index + 1));
    const searched = scriptedSearch({});
    await retrieveRequirementEvidence({ requirements, deadline: new JdFitDeadline(10_000), search: searched.search });

    assert.equal(searched.calls.length, 10);
    assert.ok(searched.maxInFlight <= 4, `max in flight was ${searched.maxInFlight}`);
    assert.ok(searched.maxInFlight > 1, "lookups run concurrently");
    for (const call of searched.calls) {
      assert.deepEqual(Object.keys(call.options).sort(), ["matchCount", "matchThreshold"]);
      assert.equal(call.options.matchCount, 8);
    }
  });

  it("passes no source filter to the database, so every eligible source is searched", async () => {
    const database = activeRevisionDatabase(
      [{ sourceId: "s1", activeRevisionId: "r1", latestApprovedRevisionId: "r1" }],
      [makeHit({ chunkRowId: "c1", text: "Built APIs.", sourceId: "s1", revisionId: "r1" })],
    );
    const result = await retrieveRequirementEvidence({
      requirements: [requirement(1)],
      deadline: new JdFitDeadline(10_000),
      search: database.search,
    });
    assert.equal(result[0].hits.length, 1);
    assert.deepEqual(database.calls.map((call) => call.fn), ["match_approved_experience_chunks"]);
    assert.equal(database.calls[0].args.source_ids, null);
  });

  it("uses active R1 while R2 is approved but not indexed, distinguished by revision ID and hash", async () => {
    const shared = { sourceId: "src-1", logicalExperienceId: "exp-atlas", logicalChunkId: "exp-atlas:chunk-1" };
    const r1 = makeHit({ ...shared, chunkRowId: "row-r1", revisionId: "rev-1", approvedContentHash: "sha256:r1", text: "Led the Atlas migration." });
    const r2 = makeHit({ ...shared, chunkRowId: "row-r2", revisionId: "rev-2", approvedContentHash: "sha256:r2", text: "Led the Atlas migration." });
    assert.equal(r1.logical_chunk_id, r2.logical_chunk_id, "both revisions share logical IDs");

    const database = activeRevisionDatabase(
      [{ sourceId: "src-1", activeRevisionId: "rev-1", latestApprovedRevisionId: "rev-2" }],
      [r1, r2],
    );
    const requirements = [requirement(1)];
    const retrieved = await retrieveRequirementEvidence({ requirements, deadline: new JdFitDeadline(10_000), search: database.search });
    const context = buildEvidenceContext(requirements, retrieved);
    const citations = context.evidence.map(citationFromEvidence);

    assert.equal(citations.length, 1);
    assert.equal(citations[0].revision_id, "rev-1");
    assert.equal(citations[0].approved_content_hash, "sha256:r1");
    assert.ok(citations.every((citation) => citation.revision_id !== "rev-2" && citation.approved_content_hash !== "sha256:r2"));
  });

  it("surfaces search failures and deadline expiry as JD-fit errors", async () => {
    const failing: JdFitSearch = async () => {
      throw new Error("Failed to search approved experience evidence: boom");
    };
    await assert.rejects(
      retrieveRequirementEvidence({ requirements: [requirement(1)], deadline: new JdFitDeadline(10_000), search: failing }),
      (error: unknown) => error instanceof JdFitError && error.code === "retrieval-failed" && error.retryable,
    );
    const slow: JdFitSearch = () => new Promise((resolve) => setTimeout(() => resolve([]), 200));
    await assert.rejects(
      retrieveRequirementEvidence({ requirements: [requirement(1)], deadline: new JdFitDeadline(20), search: slow }),
      (error: unknown) => error instanceof JdFitError && error.code === "deadline-exceeded",
    );
  });
});

describe("JD-fit evidence context", () => {
  it("collapses duplicate passages once, including hits without a logical chunk ID", () => {
    const shared = makeHit({ chunkRowId: "c1", text: "Designed REST APIs for billing." });
    const noLogical = makeHit({ chunkRowId: "c2", text: "Ran Kubernetes clusters.", logicalChunkId: null, start: 100 });
    const requirements = [requirement(1), requirement(2)];
    const context = buildEvidenceContext(requirements, [
      { requirement_id: "R1", hits: [shared, noLogical] },
      { requirement_id: "R2", hits: [{ ...shared }, { ...noLogical }] },
    ]);

    assert.equal(context.stats.retrieved_count, 4);
    assert.equal(context.stats.deduped_evidence_count, 2);
    assert.deepEqual(context.evidence.map((record) => record.handle), ["E1", "E2"]);
    assert.deepEqual(context.handlesByRequirement.get("R1"), ["E1", "E2"]);
    assert.deepEqual(context.handlesByRequirement.get("R2"), ["E1", "E2"]);
    assert.equal(evidenceKey(noLogical, retainedSourceSpan(noLogical)!), `${noLogical.source_id}|${noLogical.revision_id}|c2@b1:100-124`);
  });

  it("trims context deterministically, keeping each requirement's best hits first", () => {
    const hit = (id: string, size: number) => makeHit({ chunkRowId: id, text: id.padEnd(size, "."), start: Number(id.slice(1)) * 1000 });
    const requirements = [requirement(1), requirement(2)];
    const retrieved = [
      { requirement_id: "R1", hits: [hit("a1", 40), hit("a2", 40), hit("a3", 40)] },
      { requirement_id: "R2", hits: [hit("b1", 40), hit("b2", 40)] },
    ];
    const first = buildEvidenceContext(requirements, retrieved, 120);
    const second = buildEvidenceContext(requirements, retrieved, 120);

    assert.deepEqual(first.evidence.map((record) => record.hit.id), ["a1", "b1", "a2"]);
    assert.deepEqual(second.evidence.map((record) => record.hit.id), ["a1", "b1", "a2"]);
    assert.equal(first.stats.context_characters, 120);
    assert.equal(first.stats.trimmed_evidence_count, 2);
    assert.equal(first.stats.context_truncated, true);
    assert.deepEqual(first.handlesByRequirement.get("R2"), ["E2"]);
  });

  it("keeps full parent-expanded citation lineage", () => {
    const hit = makeHit({
      chunkRowId: "c9",
      text: "Cut deploy time by 40%.",
      blockId: "b7",
      start: 12,
      evidenceLogicalIds: ["exp-atlas:ev-3", "exp-atlas:ev-4"],
      fileName: "resume.docx",
    });
    const context = buildEvidenceContext([requirement(1)], [{ requirement_id: "R1", hits: [hit] }]);
    const citation = citationFromEvidence(context.evidence[0]);

    assert.deepEqual(citation, {
      evidence_handle: "E1",
      source_id: hit.source_id,
      source_file_name: "resume.docx",
      revision_id: hit.revision_id,
      approved_content_hash: hit.approved_content_hash,
      logical_experience_id: "exp-atlas",
      logical_parent_id: "exp-atlas:parent-1",
      logical_chunk_id: hit.logical_chunk_id,
      evidence_logical_ids: ["exp-atlas:ev-3", "exp-atlas:ev-4"],
      source_span: { block_id: "b7", start: 12, end: 12 + hit.child_text.length },
      quote: "Cut deploy time by 40%.",
    });
    assert.equal(context.evidence[0].hit.parent.parent_text.includes("Cut deploy time"), true, "parent context is retained");
  });
});
