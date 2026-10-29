import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExperienceApiError } from "./apiRoutes";
import { approveExperienceRevision, type ExperienceServiceClient } from "./apiService";
import {
  hashCanonicalRevisionContent,
  parseCanonicalExperienceRevision,
  type CanonicalExperienceRevision,
} from "./contracts";
import { buildExperienceExtractionSnapshot } from "./extractionSnapshot";
import {
  EXPERIENCE_STRUCTURED_PROMPT_VERSION,
  buildStructuredExperienceDraft,
  type StructuredExperienceModelProposal,
} from "./structuredGeneration";

const SOURCE_ID = "20000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "20000000-0000-4000-8000-000000000002";
const REVISION_ID = "20000000-0000-4000-8000-000000000003";
const ACTIVE_REVISION_ID = "20000000-0000-4000-8000-000000000099";

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

class MockApprovalClient {
  readonly snapshot = snapshotFixture();
  readonly publicationParents: unknown[] = [];
  readonly stagingRows: unknown[] = [];
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
    latest_draft_revision_id: REVISION_ID as string | null,
    latest_approved_revision_id: null as string | null,
    active_revision_id: ACTIVE_REVISION_ID as string | null,
    failure: null,
    cleanup_error: null,
    deleted_at: null,
    created_at: "2026-10-29T00:00:00.000Z",
    updated_at: "2026-10-29T00:00:00.000Z",
  };
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
    status: "draft" as "draft" | "approved",
    draft_json: {
      canonical_revision: acknowledgedDraft(2),
      parsing_checkpoints: [],
      source_warnings: this.snapshot.warnings,
      omitted_block_coverage: {},
    },
    draft_version: 2,
    approved_json: null as CanonicalExperienceRevision | null,
    approved_content_hash: null as string | null,
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
    assert.equal(functionName, "approve_experience_revision");
    if (args.p_revision_id !== REVISION_ID || args.p_expected_draft_version !== this.revision.draft_version) {
      return { data: null, error: { code: "40001", message: "Experience revision approval version conflict" } };
    }
    if (this.source.latest_draft_revision_id !== REVISION_ID || this.revision.status !== "draft") {
      return { data: null, error: { code: "40001", message: "Experience approval candidate is stale" } };
    }

    this.revision.status = "approved";
    this.revision.approved_json = structuredClone(args.p_approved_json) as CanonicalExperienceRevision;
    this.revision.approved_content_hash = String(args.p_approved_content_hash);
    this.source.status = "approved";
    this.source.latest_draft_revision_id = null;
    this.source.latest_approved_revision_id = REVISION_ID;
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

function acknowledgedDraft(draftVersion: number) {
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
      draft_version: draftVersion,
    },
    review_acknowledgements: {
      warnings: true,
      unassigned_blocks: true,
    },
  });
}

describe("experience approval", () => {
  it("approves the current draft version and freezes approved JSON without publishing evidence", async () => {
    const client = new MockApprovalClient();
    const result = await approveExperienceRevision(
      SOURCE_ID,
      {
        revision_id: REVISION_ID,
        expected_draft_version: 2,
      },
      client as unknown as ExperienceServiceClient,
    );

    assert.equal(result.status, "approved");
    assert.equal(result.next_action, "index");
    assert.equal(client.source.status, "approved");
    assert.equal(client.source.latest_draft_revision_id, null);
    assert.equal(client.source.latest_approved_revision_id, REVISION_ID);
    assert.equal(client.source.active_revision_id, ACTIVE_REVISION_ID);
    assert.equal(client.publicationParents.length, 0);
    assert.equal(client.stagingRows.length, 0);

    const approvedJson = client.revision.approved_json;
    assert.ok(approvedJson);
    assert.equal(approvedJson.revision.status, "approved");
    assert.equal(approvedJson.revision.draft_version, 2);
    assert.equal(approvedJson.revision.approved_content_hash, result.approved_content_hash);
    assert.equal(result.approved_content_hash, hashCanonicalRevisionContent(approvedJson));

    const draftJson = client.revision.draft_json as { canonical_revision: CanonicalExperienceRevision };
    draftJson.canonical_revision.experiences[0].evidence_items[0].summary = "Mutated after approval.";
    assert.equal(approvedJson.experiences[0].evidence_items[0].summary, "Led API integration.");
  });

  it("rejects stale approval versions and stale draft candidates", async () => {
    const staleVersionClient = new MockApprovalClient();
    await assert.rejects(
      () =>
        approveExperienceRevision(
          SOURCE_ID,
          {
            revision_id: REVISION_ID,
            expected_draft_version: 1,
          },
          staleVersionClient as unknown as ExperienceServiceClient,
        ),
      (error) => error instanceof ExperienceApiError && error.code === "approval-version-conflict" && error.status === 409,
    );

    const staleCandidateClient = new MockApprovalClient();
    staleCandidateClient.source.latest_draft_revision_id = "20000000-0000-4000-8000-000000000004";
    await assert.rejects(
      () =>
        approveExperienceRevision(
          SOURCE_ID,
          {
            revision_id: REVISION_ID,
            expected_draft_version: 2,
          },
          staleCandidateClient as unknown as ExperienceServiceClient,
        ),
      (error) => error instanceof ExperienceApiError && error.code === "approval-candidate-stale" && error.status === 409,
    );
  });
});
