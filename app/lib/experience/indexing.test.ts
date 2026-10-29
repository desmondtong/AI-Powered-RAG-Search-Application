import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExperienceApiError } from "./apiRoutes";
import {
  indexExperienceRevision,
  type ExperienceServiceClient,
} from "./apiService";
import {
  assignRevisionLogicalIds,
  hashCanonicalRevisionContent,
  parseCanonicalExperienceRevision,
  parseExtractionSnapshot,
  type CanonicalExperienceRevision,
  type ExtractionSnapshot,
} from "./contracts";
import {
  documentedCanonicalProjectFixture,
  documentedExtractionSnapshotFixture,
} from "./fixtures";

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

class MockStagingBuilder extends MockSelectBuilder {
  constructor(
    rows: Record<string, unknown>[],
    private readonly client: MockIndexingClient,
  ) {
    super(rows);
  }

  async upsert(rows: Record<string, unknown>[]) {
    this.client.upsertCalls.push(rows);
    for (const row of rows) {
      const index = this.client.stagingRows.findIndex(
        (candidate) =>
          candidate.revision_id === row.revision_id &&
          candidate.logical_chunk_key === row.logical_chunk_key,
      );
      if (index >= 0) {
        this.client.stagingRows[index] = row;
      } else {
        this.client.stagingRows.push(row);
      }
    }
    return { data: rows, error: null };
  }
}

class MockIndexingClient {
  readonly snapshot: ExtractionSnapshot;
  readonly revision: CanonicalExperienceRevision;
  readonly source: Record<string, unknown>;
  readonly extraction: Record<string, unknown>;
  readonly revisionRow: Record<string, unknown>;
  readonly stagingRows: Record<string, unknown>[] = [];
  readonly upsertCalls: Record<string, unknown>[][] = [];
  readonly publishCalls: Record<string, unknown>[] = [];
  readonly completeCalls: Record<string, unknown>[] = [];
  readonly previousLiveParents = ["previous-parent"];
  acquireCalls = 0;

  constructor() {
    this.snapshot = parseExtractionSnapshot(documentedExtractionSnapshotFixture);
    const assigned = assignRevisionLogicalIds(parseCanonicalExperienceRevision(documentedCanonicalProjectFixture));
    const approvedContentHash = hashCanonicalRevisionContent(assigned);
    this.revision = parseCanonicalExperienceRevision({
      ...assigned,
      revision: {
        ...assigned.revision,
        status: "approved",
        approved_content_hash: approvedContentHash,
      },
    });
    this.source = {
      id: this.revision.source.source_id,
      original_byte_sha256: this.revision.source.byte_sha256,
      original_file_name: this.revision.source.original_file_name,
      original_file_type: this.revision.source.original_file_type,
      original_file_size: 128,
      storage_bucket: "experience-sources",
      storage_path: "sources/test/original.docx",
      status: "approved",
      latest_extraction_id: this.revision.extraction.extraction_snapshot_id,
      latest_draft_revision_id: null,
      latest_approved_revision_id: this.revision.revision.revision_id,
      active_revision_id: "previous-revision",
      failure: null,
      cleanup_error: null,
      deleted_at: null,
      created_at: "2026-10-29T00:00:00.000Z",
      updated_at: "2026-10-29T00:00:00.000Z",
      execution_token: null,
      execution_stage: null,
      execution_token_expires_at: null,
    };
    this.extraction = {
      id: this.snapshot.extraction_snapshot_id,
      source_id: this.snapshot.source_id,
      text_sha256: this.snapshot.text_sha256,
      parser_version: this.snapshot.parser_version,
      normalization_version: this.snapshot.normalization_version,
      blocks: this.snapshot.blocks,
      warnings: this.snapshot.warnings,
      created_at: "2026-10-29T00:00:00.000Z",
    };
    this.revisionRow = {
      id: this.revision.revision.revision_id,
      source_id: this.revision.source.source_id,
      extraction_id: this.revision.extraction.extraction_snapshot_id,
      status: "approved",
      draft_json: {},
      draft_version: this.revision.revision.draft_version,
      approved_json: this.revision,
      approved_content_hash: this.revision.revision.approved_content_hash,
      model_version: this.revision.revision.model_version,
      prompt_version: this.revision.revision.prompt_version,
      parse_error: null,
      created_at: "2026-10-29T00:00:00.000Z",
      updated_at: "2026-10-29T00:00:00.000Z",
    };
  }

  from(table: string) {
    if (table === "experience_sources") {
      return new MockSelectBuilder([this.source]);
    }
    if (table === "experience_extractions") {
      return new MockSelectBuilder([this.extraction]);
    }
    if (table === "experience_revisions") {
      return new MockSelectBuilder([this.revisionRow]);
    }
    if (table === "experience_index_staging") {
      return new MockStagingBuilder(this.stagingRows, this);
    }
    return new MockSelectBuilder([]);
  }

  async rpc(functionName: string, args: Record<string, unknown>) {
    if (functionName === "acquire_experience_source_execution") {
      this.acquireCalls += 1;
      if (this.source.execution_token) {
        return { data: null, error: { code: "55P03", message: "leased" } };
      }
      this.source.execution_token = "30000000-0000-4000-8000-000000000001";
      this.source.execution_stage = args.p_stage;
      this.source.execution_token_expires_at = "2026-10-29T00:05:00.000Z";
      this.source.status = args.p_stage;
      return {
        data: {
          source_id: this.source.id,
          execution_token: this.source.execution_token,
          execution_stage: this.source.execution_stage,
          execution_token_expires_at: this.source.execution_token_expires_at,
          status: this.source.status,
        },
        error: null,
      };
    }

    if (functionName === "complete_experience_source_execution") {
      this.completeCalls.push(args);
      if (args.p_execution_token !== this.source.execution_token || args.p_stage !== this.source.execution_stage) {
        return { data: null, error: { code: "40001", message: "stale token" } };
      }
      this.source.status = args.p_next_status;
      this.source.failure = args.p_failure;
      this.source.execution_token = null;
      this.source.execution_stage = null;
      this.source.execution_token_expires_at = null;
      return { data: this.source, error: null };
    }

    if (functionName === "publish_experience_revision") {
      this.publishCalls.push(args);
      this.revisionRow.status = "indexed";
      this.source.status = "indexed";
      this.source.active_revision_id = args.p_revision_id;
      this.previousLiveParents.length = 0;
      this.stagingRows.length = 0;
      return {
        data: {
          status: "indexed",
          already_published: false,
          revision_id: args.p_revision_id,
          active_revision_id: args.p_revision_id,
          previous_active_revision_id: "previous-revision",
          parent_count: args.p_expected_parent_count,
          child_count: args.p_expected_child_count,
          plan_hash: args.p_plan_hash,
        },
        error: null,
      };
    }

    return { data: null, error: { message: `Unexpected RPC ${functionName}` } };
  }

  markAlreadyIndexed() {
    this.revisionRow.status = "indexed";
    this.source.status = "indexed";
    this.source.active_revision_id = this.revision.revision.revision_id;
    this.previousLiveParents.length = 0;
  }
}

function vector(fill: number) {
  return Array.from({ length: 1536 }, () => fill);
}

describe("experience indexing", () => {
  it("prepares a bounded batch without replacing the previous active revision early", async () => {
    const client = new MockIndexingClient();
    const result = await indexExperienceRevision(
      String(client.source.id),
      {},
      client as unknown as ExperienceServiceClient,
      {
        batchSize: 1,
        embed: async () => vector(0.25),
      },
    );

    assert.equal(result.status, "indexing");
    assert.equal(result.next_action, "index");
    assert.equal(result.progress.prepared_chunks, 1);
    assert.equal(result.progress.remaining_chunks, 2);
    assert.equal(client.publishCalls.length, 0);
    assert.equal(client.stagingRows.length, 1);
    assert.equal(client.source.active_revision_id, "previous-revision");
    assert.deepEqual(client.previousLiveParents, ["previous-parent"]);
  });

  it("publishes once all embeddings are prepared and replaces previous live rows atomically at publish time", async () => {
    const client = new MockIndexingClient();
    await indexExperienceRevision(
      String(client.source.id),
      {},
      client as unknown as ExperienceServiceClient,
      {
        batchSize: 1,
        embed: async () => vector(0.25),
      },
    );

    const result = await indexExperienceRevision(
      String(client.source.id),
      {},
      client as unknown as ExperienceServiceClient,
      {
        batchSize: 3,
        embed: async () => vector(0.5),
      },
    );

    assert.equal(result.status, "indexed");
    assert.equal(result.next_action, null);
    assert.equal(result.progress.prepared_chunks, 3);
    assert.equal(result.progress.remaining_chunks, 0);
    assert.equal(client.publishCalls.length, 1);
    assert.equal(client.stagingRows.length, 0);
    assert.equal(client.source.active_revision_id, client.revision.revision.revision_id);
    assert.deepEqual(client.previousLiveParents, []);
  });

  it("returns an idempotent indexed response after publication without staging duplicate chunks", async () => {
    const client = new MockIndexingClient();
    client.markAlreadyIndexed();
    const result = await indexExperienceRevision(
      String(client.source.id),
      { revision_id: client.revision.revision.revision_id },
      client as unknown as ExperienceServiceClient,
      { embed: async () => vector(0.75) },
    );

    assert.equal(result.status, "indexed");
    assert.equal(result.already_published, true);
    assert.equal(result.progress.remaining_chunks, 0);
    assert.equal(client.acquireCalls, 0);
    assert.equal(client.upsertCalls.length, 0);
    assert.equal(client.publishCalls.length, 0);
  });

  it("records failed embedding preparation without publishing partial evidence", async () => {
    const client = new MockIndexingClient();
    await assert.rejects(
      () =>
        indexExperienceRevision(
          String(client.source.id),
          {},
          client as unknown as ExperienceServiceClient,
          {
            batchSize: 1,
            embed: async () => [1, 2, 3],
          },
        ),
      /invalid dimensions: 3\/1536/,
    );

    assert.equal(client.source.status, "failed");
    assert.equal((client.source.failure as { stage: string }).stage, "indexing");
    assert.equal((client.source.failure as { recoverable_action: string }).recoverable_action, "retry-index");
    assert.equal(client.stagingRows.length, 0);
    assert.equal(client.publishCalls.length, 0);
    assert.equal(client.source.active_revision_id, "previous-revision");
  });

  it("rejects stale approved candidates before acquiring an indexing lease", async () => {
    const client = new MockIndexingClient();
    client.source.latest_approved_revision_id = "newer-revision";
    await assert.rejects(
      () =>
        indexExperienceRevision(
          String(client.source.id),
          { revision_id: client.revision.revision.revision_id },
          client as unknown as ExperienceServiceClient,
        ),
      (error) => error instanceof ExperienceApiError && error.code === "index-candidate-stale" && error.status === 409,
    );
    assert.equal(client.acquireCalls, 0);
  });
});
