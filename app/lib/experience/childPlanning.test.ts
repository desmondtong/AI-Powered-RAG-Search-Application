import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCanonicalExperienceRevision } from "./contracts";
import { buildExperienceExtractionSnapshot } from "./extractionSnapshot";
import { buildExperienceChildPlan, buildExperienceParentPlan } from "./parentPlanning";
import {
  EXPERIENCE_STRUCTURED_PROMPT_VERSION,
  buildStructuredExperienceDraft,
  type StructuredExperienceModelProposal,
} from "./structuredGeneration";

const SOURCE_ID = "60000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "60000000-0000-4000-8000-000000000002";
const REVISION_ID = "60000000-0000-4000-8000-000000000003";
const LONG_TEXT = [
  "Long planning sentence one carries source detail.",
  "Long planning sentence two carries more source detail.",
  "Long planning sentence three closes the retained passage.",
].join(" ");

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
          "Organization ByteDance.",
          "Period 2024.",
          "Technologies React and Supabase.",
          "First noncontiguous contribution.",
          "Second noncontiguous contribution.",
          "Shared deployment detail.",
          LONG_TEXT,
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
        organization: { value: "ByteDance", source_refs: [{ block_id: "block-0001", quote: "Organization ByteDance" }] },
        role: { value: "Lead Engineer", source_refs: [{ block_id: "block-0001", quote: "Role Lead Engineer" }] },
        period: {
          start: { value: "2024", source_refs: [{ block_id: "block-0001", quote: "Period 2024" }] },
          end: { value: null, source_refs: [] },
          precision: "year",
        },
        technologies: {
          value: ["React", "Supabase"],
          source_refs: [{ block_id: "block-0001", quote: "Technologies React and Supabase" }],
        },
        context_refs: [{ block_id: "block-0001", quote: "Project Atlas context." }],
        evidence_items: [
          {
            kind: "contribution",
            summary: "Handled two separate contributions.",
            source_refs: [
              { block_id: "block-0001", quote: "First noncontiguous contribution" },
              { block_id: "block-0001", quote: "Second noncontiguous contribution" },
            ],
            attribution: "individual",
            activity_status: "completed",
          },
          {
            kind: "outcome",
            summary: "Shared deployment detail.",
            source_refs: [{ block_id: "block-0001", quote: "Shared deployment detail" }],
            attribution: "team",
            activity_status: "completed",
          },
          {
            kind: "responsibility",
            summary: "Repeated reference to shared deployment detail.",
            source_refs: [{ block_id: "block-0001", quote: "Shared deployment detail" }],
            attribution: "team",
            activity_status: "completed",
          },
          {
            kind: "background",
            summary: "Long retained passage.",
            source_refs: [{ block_id: "block-0001", quote: LONG_TEXT }],
            attribution: "unspecified",
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

describe("experience child planning", () => {
  it("keeps noncontiguous refs separate, deduplicates repeated spans, and splits long spans exactly", () => {
    const snapshot = snapshotFixture();
    const revision = approvedRevision();
    const parentPlan = buildExperienceParentPlan({
      snapshot,
      revision,
      maxParentUtf16Units: 1_000,
    });
    const childPlan = buildExperienceChildPlan({
      snapshot,
      revision,
      parentPlan,
      childTargetUtf16Units: 52,
      childMaxUtf16Units: 64,
    });

    const [noncontiguousItem, firstSharedItem, secondSharedItem, longItem] = revision.experiences[0].evidence_items;
    const noncontiguousChildren = childPlan.children.filter((child) =>
      child.evidence_logical_ids.includes(noncontiguousItem.logical_id ?? ""),
    );
    assert.equal(noncontiguousChildren.length, 2);
    assert.notEqual(noncontiguousChildren[0].source_span.start, noncontiguousChildren[1].source_span.start);

    const sharedChildren = childPlan.children.filter((child) => child.child_text === "Shared deployment detail");
    assert.equal(sharedChildren.length, 1);
    assert.deepEqual(sharedChildren[0].evidence_logical_ids, [
      firstSharedItem.logical_id,
      secondSharedItem.logical_id,
    ].sort());
    assert.equal(sharedChildren[0].embedding_config.task_type, "RETRIEVAL_DOCUMENT");
    assert.equal(sharedChildren[0].embedding_config.dimensions, 1536);
    assert.equal(childPlan.embedding_config.task_type, "RETRIEVAL_DOCUMENT");
    assert.equal(childPlan.embedding_config.dimensions, 1536);
    assert.match(sharedChildren[0].embedding_text, /^Project: Project Atlas\nRole: Lead Engineer\nTechnologies mentioned: React, Supabase\nEvidence kinds: outcome, responsibility\n\nShared deployment detail$/);
    assert.equal(sharedChildren[0].child_text, "Shared deployment detail");
    assert.equal(sharedChildren[0].source_span.text, "Shared deployment detail");
    assert.doesNotMatch(sharedChildren[0].embedding_text, /Repeated reference/);
    assert.doesNotMatch(sharedChildren[0].embedding_text, /ByteDance/);
    assert.doesNotMatch(sharedChildren[0].embedding_text, /2024/);
    assert.deepEqual(sharedChildren[0].metadata.embedding_config, sharedChildren[0].embedding_config);
    assert.deepEqual(sharedChildren[0].metadata.contextual_headers, [
      "Project: Project Atlas",
      "Role: Lead Engineer",
      "Technologies mentioned: React, Supabase",
      "Evidence kinds: outcome, responsibility",
    ]);

    const longChildren = childPlan.children.filter((child) =>
      child.evidence_logical_ids.includes(longItem.logical_id ?? ""),
    );
    assert.ok(longChildren.length > 1);
    assert.equal(longChildren.map((child) => child.child_text).join(""), LONG_TEXT);
    for (const child of longChildren) {
      assert.ok(child.child_text.length <= 64);
      assert.equal(child.source_span.text, child.child_text);
      assert.equal(snapshot.blocks[0].text.slice(child.source_span.start, child.source_span.end), child.child_text);
    }
  });
});
