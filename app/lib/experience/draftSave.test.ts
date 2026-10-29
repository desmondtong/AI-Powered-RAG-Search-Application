import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExperienceApiError } from "./apiRoutes";
import { saveExperienceDraft, type ExperienceServiceClient } from "./apiService";
import { parseCanonicalExperienceRevision } from "./contracts";
import { buildExperienceExtractionSnapshot } from "./extractionSnapshot";
import {
  EXPERIENCE_STRUCTURED_PROMPT_VERSION,
  buildStructuredExperienceDraft,
  type StructuredExperienceModelProposal,
} from "./structuredGeneration";

const SOURCE_ID = "10000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "10000000-0000-4000-8000-000000000002";
const REVISION_ID = "10000000-0000-4000-8000-000000000003";

interface QueryFilter {
  key: string;
  value: unknown;
}

class MockSelectBuilder {
  private filters: QueryFilter[] = [];
  private maxRows: number | null = null;

  constructor(private readonly rows: Record<string, unknown>[]) {}

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push({ key, value });
    return this;
  }

  is(key: string, value: unknown) {
    this.filters.push({ key, value });
    return this;
  }

  order() {
    return this;
  }

  limit(value: number) {
    this.maxRows = value;
    return this;
  }

  then(resolve: (value: { data: Record<string, unknown>[]; error: null }) => void) {
    let rows = this.rows.filter((row) => this.filters.every((filter) => row[filter.key] === filter.value));
    if (this.maxRows !== null) {
      rows = rows.slice(0, this.maxRows);
    }
    return Promise.resolve({ data: rows, error: null }).then(resolve);
  }
}

class MockDraftSaveClient {
  readonly source = {
    id: SOURCE_ID,
    original_byte_sha256: "byte-hash",
    original_file_name: "experience.docx",
    original_file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    original_file_size: 123,
    storage_bucket: "experience-sources",
    storage_path: "sources/test/original.docx",
    status: "draft",
    latest_extraction_id: SNAPSHOT_ID,
    latest_draft_revision_id: REVISION_ID,
    latest_approved_revision_id: null,
    active_revision_id: "active-revision",
    failure: null,
    cleanup_error: null,
    deleted_at: null,
    created_at: "2026-10-29T00:00:00.000Z",
    updated_at: "2026-10-29T00:00:00.000Z",
  };
  readonly snapshot = snapshotFixture();
  readonly extraction = {
    id: SNAPSHOT_ID,
    source_id: SOURCE_ID,
    text_sha256: this.snapshot.text_sha256,
    parser_version: this.snapshot.parser_version,
    normalization_version: this.snapshot.normalization_version,
    blocks: this.snapshot.blocks,
    warnings: this.snapshot.warnings,
    created_at: "2026-10-29T00:00:00.000Z",
  };
  readonly revision = {
    id: REVISION_ID,
    source_id: SOURCE_ID,
    extraction_id: SNAPSHOT_ID,
    status: "draft",
    draft_json: {},
    draft_version: 1,
    approved_json: null,
    approved_content_hash: null,
    model_version: "gemini-test",
    prompt_version: EXPERIENCE_STRUCTURED_PROMPT_VERSION,
    parse_error: null,
    created_at: "2026-10-29T00:00:00.000Z",
    updated_at: "2026-10-29T00:00:00.000Z",
  };

  from(table: string) {
    if (table === "experience_sources") {
      return new MockSelectBuilder([this.source]);
    }
    if (table === "experience_extractions") {
      return new MockSelectBuilder([this.extraction]);
    }
    if (table === "experience_revisions") {
      return new MockSelectBuilder([this.revision]);
    }
    return new MockSelectBuilder([]);
  }

  async rpc(functionName: string, args: Record<string, unknown>) {
    assert.equal(functionName, "update_experience_revision_draft");
    if (args.p_revision_id !== REVISION_ID || args.p_expected_draft_version !== this.revision.draft_version) {
      return { data: null, error: { code: "40001", message: "Experience revision draft version conflict" } };
    }
    this.revision.draft_json = args.p_draft_json as Record<string, unknown>;
    this.revision.draft_version += 1;
    return { data: this.revision, error: null };
  }
}

function snapshotFixture() {
  return buildExperienceExtractionSnapshot({
    sourceId: SOURCE_ID,
    extractionSnapshotId: SNAPSHOT_ID,
    originalFileName: "experience.docx",
    originalFileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    byteSha256: "byte-hash",
    warnings: ["Extraction warning"],
    segments: [
      { text: "Project Atlas shipped. I led API integration." },
      { text: "Omitted source block remains visible for review." },
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
        context_refs: [{ block_id: "block-0001", quote: "Project Atlas shipped." }],
        evidence_items: [
          {
            kind: "contribution",
            summary: "Led API integration.",
            source_refs: [{ block_id: "block-0001", quote: "I led API integration" }],
            attribution: "individual",
            activity_status: "completed",
          },
        ],
      },
    ],
  };
}

function acknowledgedDraft(overrides: Record<string, unknown> = {}) {
  const draft = buildStructuredExperienceDraft({
    snapshot: snapshotFixture(),
    proposal: proposalFixture(),
    revisionId: REVISION_ID,
    modelVersion: "gemini-test",
    promptVersion: EXPERIENCE_STRUCTURED_PROMPT_VERSION,
  });
  return parseCanonicalExperienceRevision({
    ...draft,
    ...overrides,
    review_acknowledgements: {
      warnings: true,
      unassigned_blocks: true,
      ...(overrides.review_acknowledgements as Record<string, unknown> | undefined),
    },
  });
}

function editableAcknowledgedDraft() {
  return structuredClone(acknowledgedDraft());
}

async function assertDraftValidationError(action: () => Promise<unknown>) {
  await assert.rejects(
    action,
    (error) =>
      error instanceof ExperienceApiError &&
      error.code === "draft-validation-failed" &&
      Array.isArray(error.details.field_errors),
  );
}

describe("experience draft save", () => {
  it("saves a valid source-grounded draft with optimistic version increment", async () => {
    const client = new MockDraftSaveClient();
    const draft = acknowledgedDraft();
    const result = await saveExperienceDraft(
      SOURCE_ID,
      {
        revision_id: REVISION_ID,
        expected_draft_version: 1,
        draft,
      },
      client as unknown as ExperienceServiceClient,
    );

    assert.equal(result.revision_id, REVISION_ID);
    assert.equal(result.draft_version, 2);
    assert.equal(result.next_action, "review");
    assert.equal(client.revision.draft_version, 2);
    const savedJson = client.revision.draft_json as {
      canonical_revision: { revision: { revision_id: string; draft_version: number } };
      omitted_block_coverage: { unreferencedBlocks: string[] };
    };
    assert.equal(savedJson.canonical_revision.revision.revision_id, REVISION_ID);
    assert.equal(savedJson.canonical_revision.revision.draft_version, 2);
    assert.deepEqual(savedJson.omitted_block_coverage.unreferencedBlocks, ["block-0002"]);
  });

  it("rejects stale saves through the optimistic concurrency RPC", async () => {
    const client = new MockDraftSaveClient();
    await assert.rejects(
      () =>
        saveExperienceDraft(
          SOURCE_ID,
          {
            revision_id: REVISION_ID,
            expected_draft_version: 99,
            draft: acknowledgedDraft({ revision: { ...acknowledgedDraft().revision, draft_version: 99 } }),
          },
          client as unknown as ExperienceServiceClient,
        ),
      (error) => error instanceof ExperienceApiError && error.code === "draft-version-conflict" && error.status === 409,
    );
  });

  it("returns field-level errors for unsupported claims without source references", async () => {
    const client = new MockDraftSaveClient();
    const draft = editableAcknowledgedDraft();
    draft.experiences[0].title = { value: "Unsupported Title", source_refs: [] };

    await assertDraftValidationError(() =>
      saveExperienceDraft(
        SOURCE_ID,
        {
          revision_id: REVISION_ID,
          expected_draft_version: 1,
          draft,
        },
        client as unknown as ExperienceServiceClient,
      ),
    );
  });

  it("rejects invalid source selections and missing acknowledgements", async () => {
    const client = new MockDraftSaveClient();
    const invalidSpanDraft = acknowledgedDraft({
      experiences: [
        {
          ...acknowledgedDraft().experiences[0],
          evidence_items: [
            {
              ...acknowledgedDraft().experiences[0].evidence_items[0],
              source_refs: [{ block_id: "missing-block", start: 0, end: 4 }],
            },
          ],
        },
      ],
    });

    await assertDraftValidationError(() =>
      saveExperienceDraft(
        SOURCE_ID,
        {
          revision_id: REVISION_ID,
          expected_draft_version: 1,
          draft: invalidSpanDraft,
        },
        client as unknown as ExperienceServiceClient,
      ),
    );

    await assertDraftValidationError(() =>
      saveExperienceDraft(
        SOURCE_ID,
        {
          revision_id: REVISION_ID,
          expected_draft_version: 1,
          draft: acknowledgedDraft({
            review_acknowledgements: { warnings: false, unassigned_blocks: false },
          }),
        },
        client as unknown as ExperienceServiceClient,
      ),
    );
  });

  it("rejects drafts with no usable evidence", async () => {
    const client = new MockDraftSaveClient();
    await assertDraftValidationError(() =>
      saveExperienceDraft(
        SOURCE_ID,
        {
          revision_id: REVISION_ID,
          expected_draft_version: 1,
          draft: acknowledgedDraft({
            experiences: [{ ...acknowledgedDraft().experiences[0], evidence_items: [] }],
          }),
        },
        client as unknown as ExperienceServiceClient,
      ),
    );
  });
});
