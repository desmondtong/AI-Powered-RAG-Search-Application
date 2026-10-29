import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ActivityStatusSchema,
  AttributionSchema,
  CanonicalExperienceRevision,
  EvidenceKindSchema,
  ExperienceTypeSchema,
  RevisionStatusSchema,
  SourceWorkflowStatusSchema,
  StructuredExperienceExportSchema,
  assignRevisionLogicalIds,
  assertApprovedRevisionImmutable,
  assertSpanInSnapshot,
  buildCoverageReport,
  canonicalStringify,
  hashCanonicalRevisionContent,
  parseCanonicalExperienceRevision,
  parseExtractionSnapshot,
  resolveRevisionSourceReferences,
  resolveQuoteReferences,
} from "./contracts";
import { documentedCanonicalProjectFixture, documentedExtractionSnapshotFixture } from "./fixtures";

const snapshot = parseExtractionSnapshot({
  source_id: "source-1",
  extraction_snapshot_id: "snapshot-1",
  original_file_name: "experience.docx",
  original_file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  byte_sha256: "bytes",
  text_sha256: "text",
  parser_version: "parser-v1",
  normalization_version: "normalize-v1",
  blocks: [
    {
      block_id: "block-1",
      order: 0,
      text: "Project Atlas shipped a search workflow. I led the API integration.",
      text_start: 0,
      text_end: 67,
    },
    {
      block_id: "block-2",
      order: 1,
      text: "General responsibility: mentored team members and planned Q4 rollout. Unicode 👩‍💻 works.",
      text_start: 67,
      text_end: 157,
    },
  ],
});

function projectRevision(overrides: Partial<CanonicalExperienceRevision> = {}): CanonicalExperienceRevision {
  return parseCanonicalExperienceRevision({
    schema_version: "1",
    source: {
      source_id: "source-1",
      original_file_name: "experience.docx",
      original_file_type: "docx",
      byte_sha256: "bytes",
    },
    extraction: {
      extraction_snapshot_id: "snapshot-1",
      text_sha256: "text",
      parser_version: "parser-v1",
      normalization_version: "normalize-v1",
    },
    revision: {
      revision_id: "revision-1",
      status: "draft",
      draft_version: 1,
      approved_content_hash: null,
      model_version: "gemini-test",
      prompt_version: "prompt-v1",
    },
    experiences: [
      {
        type: "project",
        title: {
          value: "Project Atlas",
          source_refs: [{ block_id: "block-1", start: 0, end: 13 }],
        },
        organization: { value: null, source_refs: [] },
        role: { value: null, source_refs: [] },
        period: {
          start: { value: null, source_refs: [] },
          end: { value: null, source_refs: [] },
          precision: "unknown",
        },
        technologies: {
          value: ["API"],
          source_refs: [{ block_id: "block-1", start: 49, end: 52 }],
        },
        context_refs: [{ block_id: "block-1", start: 0, end: 42 }],
        evidence_items: [
          {
            kind: "contribution",
            summary: "Led the API integration.",
            source_refs: [{ block_id: "block-1", start: 45, end: 67 }],
            attribution: "individual",
            activity_status: "completed",
          },
        ],
      },
    ],
    review_acknowledgements: {
      warnings: true,
      unassigned_blocks: true,
    },
    ...overrides,
  });
}

describe("structured experience contracts", () => {
  it("declares supported enums for runtime validation", () => {
    assert.equal(ExperienceTypeSchema.parse("project"), "project");
    assert.equal(ExperienceTypeSchema.parse("general-experience"), "general-experience");
    assert.equal(EvidenceKindSchema.parse("outcome"), "outcome");
    assert.equal(AttributionSchema.parse("team"), "team");
    assert.equal(ActivityStatusSchema.parse("planned"), "planned");
    assert.equal(RevisionStatusSchema.parse("indexed"), "indexed");
    assert.equal(SourceWorkflowStatusSchema.parse("cleanup-pending"), "cleanup-pending");
    assert.throws(() => EvidenceKindSchema.parse("achievement"));
  });

  it("accepts valid project and general-experience revisions", () => {
    const project = projectRevision();
    assert.equal(project.experiences[0].type, "project");

    const general = projectRevision({
      experiences: [
        {
          type: "general-experience",
          title: { value: null, source_refs: [] },
          organization: { value: null, source_refs: [] },
          role: {
            value: "Mentor",
            source_refs: [{ block_id: "block-2", start: 24, end: 39 }],
          },
          period: {
            start: { value: null, source_refs: [] },
            end: { value: null, source_refs: [] },
            precision: "unknown",
          },
          technologies: { value: [], source_refs: [] },
          context_refs: [{ block_id: "block-2", start: 0, end: 68 }],
          evidence_items: [
            {
              kind: "responsibility",
              summary: "Mentored team members.",
              source_refs: [{ block_id: "block-2", start: 24, end: 45 }],
              attribution: "individual",
              activity_status: "ongoing",
            },
          ],
        },
      ],
    });
    assert.equal(general.experiences[0].type, "general-experience");
  });

  it("rejects invalid enum values and populated fields without source references", () => {
    assert.throws(() =>
      parseCanonicalExperienceRevision({
        ...projectRevision(),
        experiences: [{ ...projectRevision().experiences[0], type: "portfolio" }],
      }),
    );
    assert.throws(() =>
      parseCanonicalExperienceRevision({
        ...projectRevision(),
        experiences: [
          {
            ...projectRevision().experiences[0],
            title: { value: "Unsupported project title", source_refs: [] },
          },
        ],
      }),
    );
  });
});

describe("source quote and span resolution", () => {
  it("resolves exact unique quotes using UTF-16 offsets", () => {
    const [span] = resolveQuoteReferences(snapshot, [
      {
        source_id: "source-1",
        extraction_snapshot_id: "snapshot-1",
        block_id: "block-2",
        quote: "👩‍💻",
      },
    ]);
    assert.deepEqual(span, {
      block_id: "block-2",
      start: snapshot.blocks[1].text.indexOf("👩‍💻"),
      end: snapshot.blocks[1].text.indexOf("👩‍💻") + "👩‍💻".length,
    });
    assert.equal(assertSpanInSnapshot(snapshot, span), "👩‍💻");
  });

  it("rejects wrong snapshot ownership, unknown blocks, nonmatches, repeated quotes, and out-of-range spans", () => {
    assert.throws(() =>
      resolveQuoteReferences(snapshot, [{ source_id: "source-2", block_id: "block-1", quote: "Project Atlas" }]),
    );
    assert.throws(() => resolveQuoteReferences(snapshot, [{ block_id: "missing", quote: "Project Atlas" }]));
    assert.throws(() => resolveQuoteReferences(snapshot, [{ block_id: "block-1", quote: "not in block" }]));
    assert.throws(() =>
      resolveQuoteReferences(
        {
          ...snapshot,
          blocks: [
            {
              block_id: "repeat",
              order: 0,
              text: "repeat repeat",
              text_start: 0,
              text_end: 13,
            },
          ],
        },
        [{ block_id: "repeat", quote: "repeat" }],
      ),
    );
    assert.throws(() => assertSpanInSnapshot(snapshot, { block_id: "block-1", start: 0, end: 999 }));
  });
});

describe("canonical hashing, IDs, coverage, and immutability", () => {
  it("hashes canonical JSON independent of object key order", () => {
    assert.equal(canonicalStringify({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  });

  it("assigns stable logical IDs within a revision and different IDs for independent parses", () => {
    const first = assignRevisionLogicalIds(projectRevision());
    const retry = assignRevisionLogicalIds(projectRevision());
    const independent = assignRevisionLogicalIds(
      projectRevision({
        revision: { ...projectRevision().revision, revision_id: "revision-2" },
      }),
    );

    assert.equal(first.experiences[0].logical_id, retry.experiences[0].logical_id);
    assert.equal(first.experiences[0].evidence_items[0].logical_id, retry.experiences[0].evidence_items[0].logical_id);
    assert.notEqual(first.experiences[0].logical_id, independent.experiences[0].logical_id);
    assert.equal(hashCanonicalRevisionContent(first), hashCanonicalRevisionContent(retry));
  });

  it("reports coverage and protects approved revision content", () => {
    const draft = assignRevisionLogicalIds(projectRevision());
    const coverage = buildCoverageReport(snapshot, draft);
    assert.equal(coverage.totalBlocks, 2);
    assert.equal(coverage.referencedBlocks, 1);
    assert.deepEqual(coverage.unreferencedBlocks, ["block-2"]);
    assert.ok(coverage.referencedUtf16Units > 0);

    const approved = parseCanonicalExperienceRevision({
      ...draft,
      revision: {
        ...draft.revision,
        status: "approved",
        approved_content_hash: hashCanonicalRevisionContent(draft),
      },
    });
    const edited = parseCanonicalExperienceRevision({
      ...approved,
      experiences: [
        {
          ...approved.experiences[0],
          evidence_items: [
            {
              ...approved.experiences[0].evidence_items[0],
              summary: "Edited unsupported summary.",
            },
          ],
        },
      ],
    });

    assert.throws(() => assertApprovedRevisionImmutable(approved, edited));
    assert.doesNotThrow(() => assertApprovedRevisionImmutable(draft, edited));
  });

  it("validates the documented canonical fixture and export contract", () => {
    const fixtureSnapshot = parseExtractionSnapshot(documentedExtractionSnapshotFixture);
    const fixtureRevision = parseCanonicalExperienceRevision(documentedCanonicalProjectFixture);
    const assigned = assignRevisionLogicalIds(fixtureRevision);
    const contentHash = hashCanonicalRevisionContent(assigned);

    assert.equal(
      assertSpanInSnapshot(fixtureSnapshot, assigned.experiences[0].evidence_items[0].source_refs[0]),
      "I led the API integration",
    );
    assert.doesNotThrow(() =>
      StructuredExperienceExportSchema.parse({
        revision: assigned,
        source_blocks: fixtureSnapshot.blocks,
        content_hash: contentHash,
        exported_at: "2026-10-28T00:00:00.000Z",
        resolved_source_refs: resolveRevisionSourceReferences(fixtureSnapshot, assigned),
        configuration_versions: {
          schema: "1",
          parser: fixtureSnapshot.parser_version,
          prompt: assigned.revision.prompt_version,
          model: assigned.revision.model_version,
          chunking: null,
          embedding: null,
        },
      }),
    );
    const resolvedRefs = resolveRevisionSourceReferences(fixtureSnapshot, assigned);
    const resolvedEvidence = resolvedRefs.find(
      (entry) => entry.logical_evidence_id === assigned.experiences[0].evidence_items[0].logical_id,
    );
    assert.equal(resolvedEvidence?.source_refs[0].text, "I led the API integration");
  });
});
