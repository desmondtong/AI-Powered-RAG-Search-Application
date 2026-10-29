import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assignRevisionLogicalIds,
  hashCanonicalRevisionContent,
  parseCanonicalExperienceRevision,
  parseExtractionSnapshot,
} from "./contracts";
import {
  documentedCanonicalProjectFixture,
  documentedExtractionSnapshotFixture,
} from "./fixtures";
import { freezeApprovedExperienceIndexPlan } from "./parentPlanning";

function readExperienceReadme() {
  return readFileSync(join(process.cwd(), "app/lib/experience/README.md"), "utf8");
}

describe("experience planning documentation", () => {
  it("documents planning bounds, context-only headers, span provenance, and configuration versions", () => {
    const readme = readExperienceReadme();
    for (const term of [
      "Parent And Child Planning",
      "EXPERIENCE_PARENT_MAX_UTF16_UNITS",
      "EXPERIENCE_CHILD_TARGET_UTF16_UNITS",
      "EXPERIENCE_CHILD_MAX_UTF16_UNITS",
      "EXPERIENCE_MAX_CHILD_CHUNKS_PER_REVISION",
      "experience-parent-planning-v1",
      "experience-child-planning-v1",
      "experience-embedding-context-v1",
      "experience-index-plan-v1",
      "RETRIEVAL_DOCUMENT",
      "1536 dimensions",
      "Generated summaries",
      "deterministic `plan_hash`",
    ]) {
      assert.match(readme, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("round-trips the documented canonical fixture into source-faithful parents and children", () => {
    const snapshot = parseExtractionSnapshot(documentedExtractionSnapshotFixture);
    const assigned = assignRevisionLogicalIds(parseCanonicalExperienceRevision(documentedCanonicalProjectFixture));
    const approvedContentHash = hashCanonicalRevisionContent(assigned);
    const approved = parseCanonicalExperienceRevision({
      ...assigned,
      revision: {
        ...assigned.revision,
        status: "approved",
        approved_content_hash: approvedContentHash,
      },
    });
    const frozen = freezeApprovedExperienceIndexPlan({
      snapshot,
      revision: approved,
      maxChildChunksPerRevision: 10,
    });

    const blocks = new Map(snapshot.blocks.map((block) => [block.block_id, block]));
    assert.equal(frozen.expected_child_count, approved.experiences[0].evidence_items.length);
    assert.equal(frozen.expected_evidence_count, approved.experiences[0].evidence_items.length);
    assert.equal(frozen.preparation_config.chunking_version, "experience-parent-planning-v1+experience-child-planning-v1+experience-embedding-context-v1");
    assert.equal(frozen.preparation_config.embedding_task_type, "RETRIEVAL_DOCUMENT");
    assert.equal(frozen.preparation_config.embedding_dimensions, 1536);

    for (const parent of frozen.parent_plan.parents) {
      for (const span of parent.source_spans) {
        const block = blocks.get(span.block_id);
        assert.ok(block);
        assert.equal(block.text.slice(span.start, span.end), span.text);
        assert.equal(parent.parent_text.slice(span.parent_start, span.parent_end), span.text);
      }
    }

    for (const child of frozen.child_plan.children) {
      const block = blocks.get(child.source_span.block_id);
      assert.ok(block);
      assert.equal(block.text.slice(child.source_span.start, child.source_span.end), child.child_text);
      assert.equal(child.source_span.text, child.child_text);
      assert.ok(child.embedding_text.endsWith(child.child_text));
      assert.doesNotMatch(child.child_text, /^Project:/);
      assert.doesNotMatch(child.child_text, /^Role:/);
      assert.doesNotMatch(child.embedding_text, /Led the API integration\./);
    }
  });
});
