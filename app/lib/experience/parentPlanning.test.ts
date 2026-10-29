import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCanonicalExperienceRevision } from "./contracts";
import { buildExperienceExtractionSnapshot } from "./extractionSnapshot";
import { buildExperienceParentPlan } from "./parentPlanning";
import {
  EXPERIENCE_STRUCTURED_PROMPT_VERSION,
  buildStructuredExperienceDraft,
  type StructuredExperienceModelProposal,
} from "./structuredGeneration";

const SOURCE_ID = "50000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "50000000-0000-4000-8000-000000000002";
const REVISION_ID = "50000000-0000-4000-8000-000000000003";

function snapshotFixture() {
  return buildExperienceExtractionSnapshot({
    sourceId: SOURCE_ID,
    extractionSnapshotId: SNAPSHOT_ID,
    originalFileName: "experience.docx",
    originalFileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    byteSha256: "byte-hash",
    segments: [
      {
        text: [
          "Project Atlas shipped a source-grounded review workflow.",
          "I led API integration and reviewer approval.",
          "Atlas follow-up retained source detail for partition checks.",
        ].join(" "),
      },
      {
        text: [
          "Project Borealis improved retrieval coverage.",
          "I designed parent context partitioning for Borealis.",
        ].join(" "),
      },
    ],
  });
}

function proposalFixture(): StructuredExperienceModelProposal {
  return {
    schema_version: "1",
    warnings: [],
    experiences: [
      {
        type: "project",
        title: { value: "Project Atlas", source_refs: [{ block_id: "block-0001", quote: "Project Atlas" }] },
        organization: { value: null, source_refs: [] },
        role: { value: null, source_refs: [] },
        period: {
          start: { value: null, source_refs: [] },
          end: { value: null, source_refs: [] },
          precision: "unknown",
        },
        technologies: { value: [], source_refs: [] },
        context_refs: [
          { block_id: "block-0001", quote: "Project Atlas shipped a source-grounded review workflow." },
        ],
        evidence_items: [
          {
            kind: "contribution",
            summary: "Led API integration.",
            source_refs: [{ block_id: "block-0001", quote: "I led API integration" }],
            attribution: "individual",
            activity_status: "completed",
          },
          {
            kind: "responsibility",
            summary: "Reviewer approval.",
            source_refs: [{ block_id: "block-0001", quote: "reviewer approval" }],
            attribution: "individual",
            activity_status: "completed",
          },
          {
            kind: "background",
            summary: "Retained source detail.",
            source_refs: [{ block_id: "block-0001", quote: "Atlas follow-up retained source detail" }],
            attribution: "unspecified",
            activity_status: "completed",
          },
        ],
      },
      {
        type: "project",
        title: { value: "Project Borealis", source_refs: [{ block_id: "block-0002", quote: "Project Borealis" }] },
        organization: { value: null, source_refs: [] },
        role: { value: null, source_refs: [] },
        period: {
          start: { value: null, source_refs: [] },
          end: { value: null, source_refs: [] },
          precision: "unknown",
        },
        technologies: { value: [], source_refs: [] },
        context_refs: [{ block_id: "block-0002", quote: "Project Borealis improved retrieval coverage." }],
        evidence_items: [
          {
            kind: "decision",
            summary: "Designed parent context partitioning.",
            source_refs: [{ block_id: "block-0002", quote: "I designed parent context partitioning" }],
            attribution: "individual",
            activity_status: "completed",
          },
        ],
      },
    ],
  };
}

function approvedRevision() {
  const draft = buildStructuredExperienceDraft({
    snapshot: snapshotFixture(),
    proposal: proposalFixture(),
    revisionId: REVISION_ID,
    modelVersion: "gemini-test",
    promptVersion: EXPERIENCE_STRUCTURED_PROMPT_VERSION,
  });
  return parseCanonicalExperienceRevision({
    ...draft,
    revision: {
      ...draft.revision,
      status: "approved",
    },
    review_acknowledgements: {
      warnings: true,
      unassigned_blocks: true,
    },
  });
}

describe("experience parent planning", () => {
  it("keeps separate projects in separate source-derived parents", () => {
    const plan = buildExperienceParentPlan({
      snapshot: snapshotFixture(),
      revision: approvedRevision(),
      maxParentUtf16Units: 1_000,
    });

    assert.equal(plan.parents.length, 2);
    assert.equal(new Set(plan.parents.map((parent) => parent.logical_experience_id)).size, 2);
    assert.match(plan.parents[0].parent_text, /Project Atlas/);
    assert.doesNotMatch(plan.parents[0].parent_text, /Project Borealis/);
    assert.match(plan.parents[1].parent_text, /Project Borealis/);
    assert.doesNotMatch(plan.parents[1].parent_text, /Project Atlas/);
  });

  it("deduplicates overlapping spans, partitions by bounds, and preserves all evidence mappings", () => {
    const revision = approvedRevision();
    const plan = buildExperienceParentPlan({
      snapshot: snapshotFixture(),
      revision,
      maxParentUtf16Units: 70,
    });
    const atlasParents = plan.parents.filter(
      (parent) => parent.logical_experience_id === revision.experiences[0].logical_id,
    );
    const expectedEvidenceIds = revision.experiences[0].evidence_items.map((item) => item.logical_id).sort();
    const plannedEvidenceIds = [...new Set(atlasParents.flatMap((parent) => parent.evidence_logical_ids))].sort();

    assert.ok(atlasParents.length > 1);
    assert.deepEqual(plannedEvidenceIds, expectedEvidenceIds);
    for (const parent of atlasParents) {
      assert.ok(parent.parent_text.length <= 70);
      for (const span of parent.source_spans) {
        assert.equal(parent.parent_text.slice(span.parent_start, span.parent_end), span.text);
      }
    }
    assert.equal(
      atlasParents.filter((parent) => parent.parent_text.includes("Project Atlas shipped")).length,
      1,
    );
  });
});
