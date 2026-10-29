import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExperienceApiError } from "./apiRoutes";
import { deleteExperienceSource, getExperienceSourceDetail, type ExperienceServiceClient } from "./apiService";

interface QueryFilter {
  key: string;
  value: unknown;
  kind: "eq" | "is";
}

class MockSelectBuilder {
  private filters: QueryFilter[] = [];
  private maxRows: number | null = null;

  constructor(private readonly rows: Record<string, unknown>[]) {}

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push({ key, value, kind: "eq" });
    return this;
  }

  is(key: string, value: unknown) {
    this.filters.push({ key, value, kind: "is" });
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

class MockDeleteClient {
  readonly rpcCalls: Array<{ functionName: string; args: Record<string, unknown> }> = [];
  readonly removals: Array<{ bucket: string; paths: string[] }> = [];
  readonly statusUpdates: Array<{ payload: Record<string, unknown>; sourceId: string }> = [];
  removeError: { message: string; code?: string } | null = null;
  rpcError: { message: string; code?: string } | null = null;

  async rpc(functionName: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ functionName, args });
    if (this.rpcError) {
      return { data: null, error: this.rpcError };
    }
    return {
      data: {
        source_id: args.p_source_id,
        status: "deleted",
        storage_bucket: "experience-sources",
        storage_path: "sources/delete-test/original.docx",
        deleted_parent_count: 2,
        deleted_child_count: 2,
        deleted_revision_count: 1,
        deleted_extraction_count: 1,
        deleted_staging_count: 3,
      },
      error: null,
    };
  }

  storage = {
    from: (bucket: string) => ({
      remove: async (paths: string[]) => {
        this.removals.push({ bucket, paths });
        return { data: this.removeError ? null : paths, error: this.removeError };
      },
    }),
  };

  from(table: string) {
    assert.equal(table, "experience_sources");
    return {
      update: (payload: Record<string, unknown>) => ({
        eq: async (key: string, sourceId: string) => {
          assert.equal(key, "id");
          this.statusUpdates.push({ payload, sourceId });
          return { data: null, error: null };
        },
      }),
    };
  }
}

class MockDeletedDetailClient {
  readonly source = {
    id: "source-delete",
    original_byte_sha256: "byte-hash",
    original_file_name: "experience.docx",
    original_file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    original_file_size: 4,
    storage_bucket: "experience-sources",
    storage_path: "sources/delete-test/original.docx",
    status: "deleted",
    latest_extraction_id: null,
    latest_draft_revision_id: null,
    latest_approved_revision_id: null,
    active_revision_id: null,
    failure: null,
    cleanup_error: null,
    deleted_at: "2026-10-29T00:00:00.000Z",
    created_at: "2026-10-29T00:00:00.000Z",
    updated_at: "2026-10-29T00:00:00.000Z",
  };

  from(table: string) {
    assert.equal(table, "experience_sources");
    return new MockSelectBuilder([this.source]);
  }
}

describe("experience source deletion", () => {
  it("deletes database evidence and private storage with an idempotent response", async () => {
    const client = new MockDeleteClient();
    const result = await deleteExperienceSource("source-delete", client as unknown as ExperienceServiceClient);

    assert.equal(result.status, "deleted");
    assert.equal(result.deleted, true);
    assert.equal(result.cleanup_pending, false);
    assert.equal(client.rpcCalls[0].functionName, "delete_experience_source");
    assert.deepEqual(client.removals[0], {
      bucket: "experience-sources",
      paths: ["sources/delete-test/original.docx"],
    });
    assert.equal(client.statusUpdates[0].payload.status, "deleted");
    assert.equal(client.statusUpdates[0].payload.cleanup_error, null);
  });

  it("keeps deleted sources cleanup-pending when storage removal fails", async () => {
    const client = new MockDeleteClient();
    client.removeError = { code: "StorageError", message: "object is temporarily locked" };

    const result = await deleteExperienceSource("source-delete", client as unknown as ExperienceServiceClient);

    assert.equal(result.status, "cleanup-pending");
    assert.equal(result.deleted, false);
    assert.equal(result.cleanup_pending, true);
    assert.equal(result.next_action, "retry-delete");
    assert.equal(client.statusUpdates[0].payload.status, "cleanup-pending");
    assert.deepEqual((client.statusUpdates[0].payload.cleanup_error as { recoverable_action: string }).recoverable_action, "retry-delete");
  });

  it("maps deletion conflicts to a safe source-not-found error", async () => {
    const client = new MockDeleteClient();
    client.rpcError = { code: "40001", message: "Experience source is unavailable for deletion" };

    await assert.rejects(
      () => deleteExperienceSource("missing-source", client as unknown as ExperienceServiceClient),
      (error) => error instanceof ExperienceApiError && error.code === "source-not-found" && error.status === 404,
    );
  });

  it("does not resolve deleted sources through the normal detail service", async () => {
    const client = new MockDeletedDetailClient();

    await assert.rejects(
      () => getExperienceSourceDetail("source-delete", client as unknown as ExperienceServiceClient),
      (error) => error instanceof ExperienceApiError && error.code === "source-not-found" && error.status === 404,
    );
  });
});
