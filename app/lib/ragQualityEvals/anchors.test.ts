import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getExperienceRevisionExport, type ExperienceServiceClient } from "../experience/apiService";
import type { StructuredExperienceExport } from "../experience/contracts";
import type { JdFitCitation } from "../jdFit/contracts";
import { makeHit } from "../jdFit/testFixtures";
import {
  AnchorError,
  citationMatchesAnchor,
  hitMatchesAnchor,
  resolvePassageAnchor,
  revisionIdentityOfExport,
  type PassageAnchor,
} from "./anchors";
import { parseRagEvalFixture } from "./fixtureSchema";
import { synthesizeOfflineCorpusEntry } from "./offlineExport";
import { RecordingSupabaseClient, sampleFixtureInput } from "./testSupport";

const PASSAGE = "Designed TypeScript REST APIs for invoice reconciliation";

function r1r2() {
  const fixture = parseRagEvalFixture({
    ...sampleFixtureInput(),
    revision_plan: { kind: "active-r1-latest-r2-unindexed", r2_evidence_summary_suffix: " (edited)" },
  });
  const entry = synthesizeOfflineCorpusEntry(fixture);
  return { r1: entry.active, r2: entry.latest_unindexed! };
}

function citationFor(anchor: PassageAnchor, overrides: Partial<JdFitCitation> = {}): JdFitCitation {
  return {
    evidence_handle: "E1",
    source_id: anchor.source_id,
    source_file_name: "x.docx",
    revision_id: anchor.revision_id,
    approved_content_hash: anchor.approved_content_hash,
    logical_experience_id: "exp",
    logical_parent_id: "exp:parent",
    logical_chunk_id: "exp:chunk",
    evidence_logical_ids: anchor.evidence_logical_ids,
    source_span: { block_id: anchor.block_id, start: anchor.start, end: anchor.end },
    quote: anchor.passage,
    ...overrides,
  };
}

function exportRows(exportDoc: StructuredExperienceExport, status: string) {
  const revision = exportDoc.revision;
  return {
    revision: {
      id: revision.revision.revision_id,
      source_id: revision.source.source_id,
      extraction_id: revision.extraction.extraction_snapshot_id,
      status,
      draft_json: null,
      draft_version: revision.revision.draft_version,
      approved_json: revision,
      approved_content_hash: exportDoc.content_hash,
      model_version: revision.revision.model_version,
      prompt_version: revision.revision.prompt_version,
      parse_error: null,
    },
  };
}

describe("rag-eval revision-anchored ground truth", () => {
  it("resolves a passage to the revision identity and block-relative span", () => {
    const { r1 } = r1r2();
    const anchor = resolvePassageAnchor(r1, { passage: PASSAGE });
    const block = r1.source_blocks.find((candidate) => candidate.block_id === anchor.block_id)!;
    assert.equal(block.text.slice(anchor.start, anchor.end), PASSAGE);
    assert.deepEqual(
      { source_id: anchor.source_id, revision_id: anchor.revision_id, approved_content_hash: anchor.approved_content_hash },
      revisionIdentityOfExport(r1),
    );
    assert.equal(anchor.covered, true);
    assert.ok(anchor.evidence_logical_ids.length > 0);
  });

  it("distinguishes sibling revisions that share logical IDs and blocks", () => {
    const { r1, r2 } = r1r2();
    const a1 = resolvePassageAnchor(r1, { passage: PASSAGE });
    const a2 = resolvePassageAnchor(r2, { passage: PASSAGE });
    assert.deepEqual(a1.evidence_logical_ids, a2.evidence_logical_ids, "siblings share logical IDs");
    assert.deepEqual([a1.block_id, a1.start, a1.end], [a2.block_id, a2.start, a2.end], "siblings share spans");
    assert.notEqual(a1.revision_id, a2.revision_id);
    assert.notEqual(a1.approved_content_hash, a2.approved_content_hash);

    assert.equal(citationMatchesAnchor(citationFor(a1), a1), true);
    assert.equal(citationMatchesAnchor(citationFor(a2), a1), false, "an R2 citation never satisfies an R1 anchor");
    assert.equal(citationMatchesAnchor(citationFor(a1, { approved_content_hash: a2.approved_content_hash }), a1), false);

    const r1Hit = makeHit({ chunkRowId: "row-1", text: PASSAGE, sourceId: a1.source_id, revisionId: a1.revision_id, approvedContentHash: a1.approved_content_hash, blockId: a1.block_id, start: a1.start });
    const r2Hit = makeHit({ chunkRowId: "row-1", text: PASSAGE, sourceId: a2.source_id, revisionId: a2.revision_id, approvedContentHash: a2.approved_content_hash, blockId: a2.block_id, start: a2.start });
    assert.equal(hitMatchesAnchor(r1Hit, a1), true);
    assert.equal(hitMatchesAnchor(r2Hit, a1), false);
  });

  it("matches citations by span overlap within the same block only", () => {
    const { r1 } = r1r2();
    const anchor = resolvePassageAnchor(r1, { passage: PASSAGE });
    assert.equal(citationMatchesAnchor(citationFor(anchor, { source_span: { block_id: anchor.block_id, start: anchor.end - 3, end: anchor.end + 20 } }), anchor), true);
    assert.equal(citationMatchesAnchor(citationFor(anchor, { source_span: { block_id: anchor.block_id, start: anchor.end, end: anchor.end + 5 } }), anchor), false);
    assert.equal(citationMatchesAnchor(citationFor(anchor, { source_span: { block_id: "block-0099", start: anchor.start, end: anchor.end } }), anchor), false);
  });

  it("rejects vector row IDs, generated summaries, parent headers, and embedding text as anchors", () => {
    const { r1 } = r1r2();
    const hit = makeHit({ chunkRowId: "9f1c2d7e-0000-4000-8000-000000000001", text: PASSAGE });
    const code = (input: unknown) => {
      try {
        resolvePassageAnchor(r1, input);
      } catch (error) {
        return error instanceof AnchorError ? error.code : "other";
      }
      return "accepted";
    };
    assert.equal(code({ chunk_row_id: hit.id }), "invalid-anchor");
    assert.equal(code({ passage: PASSAGE, vector_row_id: hit.id }), "invalid-anchor");
    assert.equal(code(hit.id), "invalid-anchor");
    assert.equal(code({ passage: hit.id }), "passage-not-in-retained-blocks");
    assert.equal(code({ passage: hit.embedding_text }), "passage-not-in-retained-blocks");
    assert.equal(code({ passage: hit.parent.parent_text }), "passage-not-in-retained-blocks");
    const generatedSummary = "Built invoicing APIs in TypeScript for a billing platform";
    assert.equal(code({ passage: generatedSummary }), "passage-not-in-retained-blocks");
    assert.equal(code({ passage: PASSAGE }), "accepted");
  });

  it("rejects an export whose identity differs from the expected manifest revision", () => {
    const { r1, r2 } = r1r2();
    assert.throws(() => resolvePassageAnchor(r2, { passage: PASSAGE }, revisionIdentityOfExport(r1)), (error: unknown) => error instanceof AnchorError && error.code === "export-identity-mismatch");
  });

  it("produces the same anchors offline as from the real export function over equivalent retained rows", async () => {
    const { r1 } = r1r2();
    const { revision } = exportRows(r1, "indexed");
    const source = r1.revision.source;
    const client = new RecordingSupabaseClient({
      experience_sources: [{ id: source.source_id, original_file_name: source.original_file_name, original_file_type: source.original_file_type, original_byte_sha256: source.byte_sha256, deleted_at: null }],
      experience_revisions: [revision],
      experience_extractions: [{
        id: r1.revision.extraction.extraction_snapshot_id,
        source_id: source.source_id,
        text_sha256: r1.revision.extraction.text_sha256,
        parser_version: r1.revision.extraction.parser_version,
        normalization_version: r1.revision.extraction.normalization_version,
        blocks: r1.source_blocks,
        warnings: [],
      }],
    });
    const real = await getExperienceRevisionExport(source.source_id, r1.revision.revision.revision_id, client as unknown as ExperienceServiceClient);
    assert.deepEqual(client.mutations(), []);
    for (const passage of [PASSAGE, "blog post about TypeScript tips"]) {
      assert.deepEqual(resolvePassageAnchor(real, { passage }), resolvePassageAnchor(r1, { passage }));
    }
    assert.deepEqual(real.resolved_source_refs, r1.resolved_source_refs);
    assert.deepEqual(real.source_blocks, r1.source_blocks);
  });
});
