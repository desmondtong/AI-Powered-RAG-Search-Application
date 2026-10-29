export const documentedExtractionSnapshotFixture = {
  source_id: "source-doc-fixture",
  extraction_snapshot_id: "snapshot-doc-fixture",
  original_file_name: "structured-experience-fixture.docx",
  original_file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  byte_sha256: "fixture-byte-hash",
  text_sha256: "fixture-text-hash",
  parser_version: "parser-v1",
  normalization_version: "normalize-v1",
  blocks: [
    {
      block_id: "fixture-block-1",
      order: 0,
      text: "Project Atlas shipped a source-grounded review workflow. I led the API integration and reviewers approved the indexed release.",
      text_start: 0,
      text_end: 126,
      locator: {
        kind: "docx-paragraph",
        paragraph: 1,
      },
    },
    {
      block_id: "fixture-block-2",
      order: 1,
      text: "The next quarter rollout was planned by the team and not yet completed.",
      text_start: 126,
      text_end: 197,
      locator: {
        kind: "docx-paragraph",
        paragraph: 2,
      },
    },
  ],
  warnings: ["Fixture warning acknowledged during review."],
};

export const documentedCanonicalProjectFixture = {
  schema_version: "1",
  source: {
    source_id: "source-doc-fixture",
    original_file_name: "structured-experience-fixture.docx",
    original_file_type: "docx",
    byte_sha256: "fixture-byte-hash",
  },
  extraction: {
    extraction_snapshot_id: "snapshot-doc-fixture",
    text_sha256: "fixture-text-hash",
    parser_version: "parser-v1",
    normalization_version: "normalize-v1",
  },
  revision: {
    revision_id: "revision-doc-fixture",
    status: "draft",
    draft_version: 1,
    approved_content_hash: null,
    model_version: "gemini-fixture",
    prompt_version: "structured-experience-v1",
  },
  experiences: [
    {
      type: "project",
      title: {
        value: "Project Atlas",
        source_refs: [{ block_id: "fixture-block-1", start: 0, end: 13 }],
      },
      organization: { value: null, source_refs: [] },
      role: {
        value: "API integration lead",
        source_refs: [{ block_id: "fixture-block-1", start: 57, end: 82 }],
      },
      period: {
        start: { value: null, source_refs: [] },
        end: { value: null, source_refs: [] },
        precision: "unknown",
      },
      technologies: {
        value: ["API"],
        source_refs: [{ block_id: "fixture-block-1", start: 67, end: 70 }],
      },
      context_refs: [{ block_id: "fixture-block-1", start: 0, end: 55 }],
      evidence_items: [
        {
          kind: "contribution",
          summary: "Led the API integration.",
          source_refs: [{ block_id: "fixture-block-1", start: 57, end: 82 }],
          attribution: "individual",
          activity_status: "completed",
        },
        {
          kind: "outcome",
          summary: "Reviewers approved the indexed release.",
          source_refs: [{ block_id: "fixture-block-1", start: 87, end: 125 }],
          attribution: "team",
          activity_status: "completed",
        },
        {
          kind: "responsibility",
          summary: "Team planned a next-quarter rollout that was not complete.",
          source_refs: [{ block_id: "fixture-block-2", start: 4, end: 70 }],
          attribution: "team",
          activity_status: "planned",
        },
      ],
    },
  ],
  review_acknowledgements: {
    warnings: true,
    unassigned_blocks: true,
  },
};
