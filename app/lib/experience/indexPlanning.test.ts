import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashCanonicalRevisionContent,
  parseCanonicalExperienceRevision,
  type CanonicalExperienceRevision,
} from "./contracts";
import { buildExperienceExtractionSnapshot } from "./extractionSnapshot";
import {
  buildExperienceChildPlan,
  buildExperienceParentPlan,
  freezeApprovedExperienceIndexPlan,
} from "./parentPlanning";
import {
  EXPERIENCE_STRUCTURED_PROMPT_VERSION,
  buildStructuredExperienceDraft,
  type StructuredExperienceModelProposal,
} from "./structuredGeneration";

const SOURCE_ID = "70000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "70000000-0000-4000-8000-000000000002";
const REVISION_ID = "70000000-0000-4000-8000-000000000003";

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
          "Project Atlas context.",
          "Role Lead Engineer.",
          "Technologies React and Supabase.",
          "First source-backed contribution.",
          "Second source-backed outcome.",
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
        role: { value: "Lead Engineer", source_refs: [{ block_id: "block-0001", quote: "Role Lead Engineer" }] },
        period: {
          start: { value: null, source_refs: [] },
          end: { value: null, source_refs: [] },
          precision: "unknown",
        },
        technologies: {
          value: ["React", "Supabase"],
          source_refs: [{ block_id: "block-0001", quote: "Technologies React and Supabase" }],
        },
        context_refs: [{ block_id: "block-0001", quote: "Project Atlas context." }],
        evidence_items: [
          {
            kind: "contribution",
            summary: "First source-backed contribution.",
            source_refs: [{ block_id: "block-0001", quote: "First source-backed contribution" }],
            attribution: "individual",
            activity_status: "completed",
          },
          {
            kind: "outcome",
            summary: "Second source-backed outcome.",
            source_refs: [{ block_id: "block-0001", quote: "Second source-backed outcome" }],
            attribution: "team",
            activity_status: "completed",
          },
        ],
      },
    ],
  };
}

function draftRevision() {
  return buildStructuredExperienceDraft({
    snapshot: snapshotFixture(),
    proposal: proposalFixture(),
    revisionId: REVISION_ID,
    modelVersion: "gemini-test",
    promptVersion: EXPERIENCE_STRUCTURED_PROMPT_VERSION,
  });
}

function approvedRevision(): CanonicalExperienceRevision {
  const acknowledged = parseCanonicalExperienceRevision({
    ...draftRevision(),
    revision: {
      ...draftRevision().revision,
      status: "approved",
    },
    review_acknowledgements: {
      warnings: true,
      unassigned_blocks: true,
    },
  });
  const approvedContentHash = hashCanonicalRevisionContent(acknowledged);
  return parseCanonicalExperienceRevision({
    ...acknowledged,
    revision: {
      ...acknowledged.revision,
      approved_content_hash: approvedContentHash,
    },
  });
}

describe("experience index plan freeze", () => {
  it("freezes deterministic approved parent-child plans with expected counts and configuration", () => {
    const snapshot = snapshotFixture();
    const revision = approvedRevision();
    const first = freezeApprovedExperienceIndexPlan({
      snapshot,
      revision,
      maxChildChunksPerRevision: 10,
    });
    const second = freezeApprovedExperienceIndexPlan({
      snapshot,
      revision,
      maxChildChunksPerRevision: 10,
    });

    assert.equal(first.plan_hash, second.plan_hash);
    assert.match(first.plan_hash, /^[0-9a-f]{64}$/);
    assert.equal(first.approved_content_hash, hashCanonicalRevisionContent(revision));
    assert.equal(first.expected_parent_count, first.parent_plan.parents.length);
    assert.equal(first.expected_child_count, first.child_plan.children.length);
    assert.equal(first.expected_evidence_count, revision.experiences[0].evidence_items.length);
    assert.equal(first.preparation_config.embedding_task_type, "RETRIEVAL_DOCUMENT");
    assert.equal(first.preparation_config.embedding_dimensions, 1536);
    assert.equal(first.preparation_config.max_child_chunks_per_revision, 10);
    assert.equal(first.preparation_config.chunking_version, "experience-parent-planning-v1+experience-child-planning-v1+experience-embedding-context-v1");
    assert.deepEqual(first.parent_plan, second.parent_plan);
    assert.deepEqual(first.child_plan, second.child_plan);
  });

  it("rejects over-limit plans before embedding preparation", () => {
    assert.throws(
      () =>
        freezeApprovedExperienceIndexPlan({
          snapshot: snapshotFixture(),
          revision: approvedRevision(),
          maxChildChunksPerRevision: 1,
        }),
      /exceeds the child chunk limit: 2\/1/,
    );
  });

  it("fails explicitly when approved evidence is missing from the child plan", () => {
    const snapshot = snapshotFixture();
    const revision = approvedRevision();
    const parentPlan = buildExperienceParentPlan({ snapshot, revision });
    const childPlan = buildExperienceChildPlan({ snapshot, revision, parentPlan });
    const missingEvidenceId = revision.experiences[0].evidence_items[1].logical_id;
    assert.ok(missingEvidenceId);
    const incompleteChildPlan = structuredClone(childPlan);
    incompleteChildPlan.children = incompleteChildPlan.children.filter(
      (child) => !child.evidence_logical_ids.includes(missingEvidenceId),
    );

    assert.throws(
      () =>
        freezeApprovedExperienceIndexPlan({
          snapshot,
          revision,
          parentPlan,
          childPlan: incompleteChildPlan,
        }),
      new RegExp(`Approved evidence is missing from child plan: ${missingEvidenceId}`),
    );
  });

  it("requires an approved revision with a matching frozen content hash", () => {
    assert.throws(
      () =>
        freezeApprovedExperienceIndexPlan({
          snapshot: snapshotFixture(),
          revision: draftRevision(),
        }),
      /Only approved revisions can be frozen/,
    );

    const approved = approvedRevision();
    assert.throws(
      () =>
        freezeApprovedExperienceIndexPlan({
          snapshot: snapshotFixture(),
          revision: {
            ...approved,
            revision: {
              ...approved.revision,
              approved_content_hash: "stale-hash",
            },
          },
        }),
      /Approved revision content hash must match/,
    );
  });
});
