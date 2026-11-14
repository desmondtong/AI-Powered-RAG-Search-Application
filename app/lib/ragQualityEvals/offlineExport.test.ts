import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseRagEvalFixture } from "./fixtureSchema";
import { synthesizeOfflineCorpusEntry } from "./offlineExport";
import { sampleFixtureInput } from "./testSupport";

describe("rag-eval offline export synthesizer", () => {
  it("builds one retained block per paragraph with deterministic IDs and hashes", () => {
    const fixture = parseRagEvalFixture(sampleFixtureInput());
    const first = synthesizeOfflineCorpusEntry(fixture);
    const second = synthesizeOfflineCorpusEntry(fixture);
    assert.deepEqual(first, second);
    assert.deepEqual(first.active.source_blocks.map((block) => block.text), fixture.experience.paragraphs);
    assert.equal(first.active.revision.revision.status, "indexed");
    assert.equal(first.active.content_hash, first.active.revision.revision.approved_content_hash);
    assert.equal(first.latest_unindexed, null);
  });

  it("clones R2 from R1 for the active-vs-latest plan, keeping logical IDs and blocks", () => {
    const fixture = parseRagEvalFixture({ ...sampleFixtureInput(), revision_plan: { kind: "active-r1-latest-r2-unindexed", r2_evidence_summary_suffix: " (edited)" } });
    const entry = synthesizeOfflineCorpusEntry(fixture);
    const r2 = entry.latest_unindexed!;
    assert.equal(r2.revision.revision.status, "approved");
    assert.notEqual(r2.revision.revision.revision_id, entry.active.revision.revision.revision_id);
    assert.notEqual(r2.content_hash, entry.active.content_hash);
    assert.deepEqual(r2.source_blocks, entry.active.source_blocks);
    const ids = (exportDoc: typeof r2) => exportDoc.revision.experiences.flatMap((experience) => [experience.logical_id, ...experience.evidence_items.map((item) => item.logical_id)]);
    assert.deepEqual(ids(r2), ids(entry.active));
  });
});
