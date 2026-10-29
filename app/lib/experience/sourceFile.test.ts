import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExperienceApiError } from "./apiRoutes";
import { getExperienceSourceFile, type ExperienceServiceClient } from "./apiService";

const SOURCE_ID = "40000000-0000-4000-8000-000000000001";

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

class MockSourceFileClient {
  readonly source = {
    id: SOURCE_ID,
    original_byte_sha256: "byte-hash",
    original_file_name: "experience.docx",
    original_file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    original_file_size: 4,
    storage_bucket: "experience-sources",
    storage_path: "sources/test/original.docx",
    status: "approved",
    latest_extraction_id: null,
    latest_draft_revision_id: null,
    latest_approved_revision_id: null,
    active_revision_id: null,
    failure: null,
    cleanup_error: null,
    deleted_at: null as string | null,
    created_at: "2026-10-29T00:00:00.000Z",
    updated_at: "2026-10-29T00:00:00.000Z",
  };
  readonly downloads: Array<{ bucket: string; path: string }> = [];
  missingObject = false;

  storage = {
    from: (bucket: string) => ({
      download: async (path: string) => {
        this.downloads.push({ bucket, path });
        if (this.missingObject) {
          return { data: null, error: { message: "Object not found" } };
        }
        return { data: new Blob([Buffer.from("docx")]), error: null };
      },
    }),
  };

  from(table: string) {
    if (table === "experience_sources") {
      return new MockSelectBuilder([this.source]);
    }
    return new MockSelectBuilder([]);
  }
}

describe("experience source file serving", () => {
  it("downloads the private original file without creating public URLs", async () => {
    const client = new MockSourceFileClient();
    const file = await getExperienceSourceFile(SOURCE_ID, client as unknown as ExperienceServiceClient);

    assert.equal(file.file_name, "experience.docx");
    assert.equal(file.file_type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.equal(file.bytes.toString("utf8"), "docx");
    assert.deepEqual(client.downloads, [
      {
        bucket: "experience-sources",
        path: "sources/test/original.docx",
      },
    ]);
  });

  it("rejects deleted sources and missing private storage objects", async () => {
    const deletedClient = new MockSourceFileClient();
    deletedClient.source.deleted_at = "2026-10-29T00:00:00.000Z";
    await assert.rejects(
      () => getExperienceSourceFile(SOURCE_ID, deletedClient as unknown as ExperienceServiceClient),
      (error) => error instanceof ExperienceApiError && error.code === "source-not-found" && error.status === 404,
    );

    const missingClient = new MockSourceFileClient();
    missingClient.missingObject = true;
    await assert.rejects(
      () => getExperienceSourceFile(SOURCE_ID, missingClient as unknown as ExperienceServiceClient),
      (error) =>
        error instanceof ExperienceApiError &&
        error.code === "source-file-unavailable" &&
        error.status === 404,
    );
  });
});
