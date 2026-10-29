import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createDraftFromApprovedRevision,
  getExperienceRevisionExport,
  type ExperienceServiceClient,
} from "./apiService";
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

const SOURCE_ID = "30000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "30000000-0000-4000-8000-000000000002";
const LATEST_APPROVED_REVISION_ID = "30000000-0000-4000-8000-000000000003";
const SUPERSEDED_INDEXED_REVISION_ID = "30000000-0000-4000-8000-000000000004";

interface QueryFilter {
  key: string;
  value: unknown;
}

interface RevisionRow {
  id: string;
  source_id: string;
  extraction_id: string;
  status: string;
  draft_json: unknown;
  draft_version: number;
  approved_json: CanonicalExperienceRevision | null;
  approved_content_hash: string | null;
  model_version: string | null;
  prompt_version: string | null;
  parse_error: unknown;
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

class MockRetainedRevisionClient {
  readonly snapshot = snapshotFixture();
  readonly source = {
    id: SOURCE_ID,
    original_byte_sha256: "byte-hash",
    original_file_name: "experience.docx",
    original_file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    original_file_size: 123,
    storage_bucket: "experience-sources",
    storage_path: "sources/test/original.docx",
    status: "indexed",
    latest_extraction_id: SNAPSHOT_ID,
    latest_draft_revision_id: null as string | null,
    latest_approved_revision_id: LATEST_APPROVED_REVISION_ID,
    active_revision_id: SUPERSEDED_INDEXED_REVISION_ID,
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
  readonly revisions = new Map<string, RevisionRow>();

  constructor() {
    this.addApprovedRevision(LATEST_APPROVED_REVISION_ID, "approved");
    this.addApprovedRevision(SUPERSEDED_INDEXED_REVISION_ID, "indexed");
  }

  addApprovedRevision(revisionId: string, status: "approved" | "indexed") {
    const approvedJson = approvedRevision(revisionId, status);
    this.revisions.set(revisionId, {
      id: revisionId,
      source_id: SOURCE_ID,
      extraction_id: SNAPSHOT_ID,
      status,
      draft_json: { canonical_revision: approvedJson },
      draft_version: approvedJson.revision.draft_version,
      approved_json: approvedJson,
      approved_content_hash: approvedJson.revision.approved_content_hash,
      model_version: approvedJson.revision.model_version,
      prompt_version: approvedJson.revision.prompt_version,
      parse_error: null,
    });
  }

  from(table: string) {
    if (table === "experience_sources") {
      return new MockSelectBuilder([this.source]);
    }
    if (table === "experience_extractions") {
      return new MockSelectBuilder([this.extraction]);
    }
    if (table === "experience_revisions") {
      return new MockSelectBuilder([...this.revisions.values()] as unknown as Record<string, unknown>[]);
    }
    return new MockSelectBuilder([]);
  }

  async rpc(functionName: string, args: Record<string, unknown>) {
    assert.equal(functionName, "create_experience_draft_from_approved");
    const approvedRow = this.revisions.get(String(args.p_approved_revision_id));
    if (!approvedRow?.approved_json || approvedRow.source_id !== args.p_source_id) {
      return { data: null, error: { message: "approved revision not found" } };
    }

    const draftRow: RevisionRow = {
      id: String(args.p_new_revision_id),
      source_id: SOURCE_ID,
      extraction_id: approvedRow.extraction_id,
      status: "draft",
      draft_json: structuredClone(args.p_draft_json),
      draft_version: Number(args.p_draft_version),
      approved_json: null,
      approved_content_hash: null,
      model_version: approvedRow.model_version,
      prompt_version: approvedRow.prompt_version,
      parse_error: null,
    };
    this.revisions.set(draftRow.id, draftRow);
    this.source.status = "draft";
    this.source.latest_draft_revision_id = draftRow.id;
    return { data: draftRow, error: null };
  }
}

function snapshotFixture() {
  return buildExperienceExtractionSnapshot({
    sourceId: SOURCE_ID,
    extractionSnapshotId: SNAPSHOT_ID,
    originalFileName: "experience.docx",
    originalFileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    byteSha256: "byte-hash",
    warnings: [],
    segments: [
      { text: "Project Atlas shipped. I led API integration." },
      { text: "Follow-up source text retained for exports." },
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

function approvedRevision(revisionId: string, status: "approved" | "indexed") {
  const draft = buildStructuredExperienceDraft({
    snapshot: snapshotFixture(),
    proposal: proposalFixture(),
    revisionId,
    modelVersion: "gemini-test",
    promptVersion: EXPERIENCE_STRUCTURED_PROMPT_VERSION,
  });
  const acknowledged = parseCanonicalExperienceRevision({
    ...draft,
    review_acknowledgements: {
      warnings: true,
      unassigned_blocks: true,
    },
  });
  const approvedHash = hashCanonicalRevisionContent(acknowledged);
  return parseCanonicalExperienceRevision({
    ...acknowledged,
    revision: {
      ...acknowledged.revision,
      status,
      draft_version: 2,
      approved_content_hash: approvedHash,
    },
  });
}

describe("retained experience revisions", () => {
  it("creates an editable draft from approved JSON without changing active evidence", async () => {
    const client = new MockRetainedRevisionClient();
    const approvedBefore = structuredClone(client.revisions.get(LATEST_APPROVED_REVISION_ID)?.approved_json);
    const result = await createDraftFromApprovedRevision(
      SOURCE_ID,
      { approved_revision_id: LATEST_APPROVED_REVISION_ID },
      client as unknown as ExperienceServiceClient,
    );

    assert.equal(result.cloned_from_revision_id, LATEST_APPROVED_REVISION_ID);
    assert.notEqual(result.revision_id, LATEST_APPROVED_REVISION_ID);
    assert.equal(client.source.latest_approved_revision_id, LATEST_APPROVED_REVISION_ID);
    assert.equal(client.source.active_revision_id, SUPERSEDED_INDEXED_REVISION_ID);
    assert.equal(client.source.latest_draft_revision_id, result.revision_id);

    const draftRow = client.revisions.get(result.revision_id);
    assert.ok(draftRow);
    const draftJson = draftRow.draft_json as { canonical_revision: CanonicalExperienceRevision };
    assert.equal(draftJson.canonical_revision.revision.status, "draft");
    assert.equal(draftJson.canonical_revision.revision.approved_content_hash, null);
    assert.equal(
      draftJson.canonical_revision.experiences[0].logical_id,
      approvedBefore?.experiences[0].logical_id,
    );
    assert.deepEqual(client.revisions.get(LATEST_APPROVED_REVISION_ID)?.approved_json, approvedBefore);
  });

  it("exports superseded accepted revisions with logical IDs resolving to exact source text", async () => {
    const client = new MockRetainedRevisionClient();
    const exported = await getExperienceRevisionExport(
      SOURCE_ID,
      SUPERSEDED_INDEXED_REVISION_ID,
      client as unknown as ExperienceServiceClient,
    );
    const logicalEvidenceId = exported.revision.experiences[0].evidence_items[0].logical_id;
    const resolvedEvidence = exported.resolved_source_refs.find((entry) => entry.logical_evidence_id === logicalEvidenceId);

    assert.equal(exported.revision.revision.revision_id, SUPERSEDED_INDEXED_REVISION_ID);
    assert.equal(exported.content_hash, hashCanonicalRevisionContent(exported.revision));
    assert.ok(resolvedEvidence);
    assert.equal(resolvedEvidence.source_refs[0].text, "I led API integration");
  });
});
