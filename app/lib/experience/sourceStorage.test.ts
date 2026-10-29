import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPERIENCE_SOURCES_BUCKET,
  buildExperienceSourceStoragePath,
  hashExperienceSourceBytes,
  storeExperienceSourceFile,
  type ExperienceSourceStorageClient,
} from "./sourceStorage";

interface MockRow {
  id: string;
  original_byte_sha256: string;
  original_file_name: string;
  original_file_type: string;
  original_file_size: number;
  storage_bucket: string;
  storage_path: string;
  status: string;
  storage_uploaded_at: string | null;
}

class MockSourceStorageClient implements ExperienceSourceStorageClient {
  readonly rowsByHash = new Map<string, MockRow>();
  readonly objects = new Set<string>();
  readonly rpcCalls: string[] = [];
  readonly uploads: Array<{ bucket: string; path: string; upsert: false; contentType: string }> = [];

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, _body: Buffer, options: { contentType: string; upsert: false }) => {
        this.uploads.push({ bucket, path, upsert: options.upsert, contentType: options.contentType });
        const key = `${bucket}/${path}`;
        if (this.objects.has(key)) {
          return {
            data: null,
            error: { statusCode: 409, message: "The resource already exists" },
          };
        }
        this.objects.add(key);
        return { data: { path }, error: null };
      },
    }),
  };

  async rpc(functionName: string, args?: Record<string, unknown>) {
    this.rpcCalls.push(functionName);
    if (functionName === "reserve_experience_source") {
      const hash = String(args?.p_original_byte_sha256);
      const existing = this.rowsByHash.get(hash);
      if (existing) {
        return { data: existing, error: null };
      }

      const row: MockRow = {
        id: `source-${this.rowsByHash.size + 1}`,
        original_byte_sha256: hash,
        original_file_name: String(args?.p_original_file_name),
        original_file_type: String(args?.p_original_file_type),
        original_file_size: Number(args?.p_original_file_size),
        storage_bucket: String(args?.p_storage_bucket),
        storage_path: String(args?.p_storage_path),
        status: "uploaded",
        storage_uploaded_at: null,
      };
      this.rowsByHash.set(hash, row);
      return { data: row, error: null };
    }

    if (functionName === "reconcile_experience_source_storage") {
      const row = [...this.rowsByHash.values()].find(
        (candidate) =>
          candidate.id === args?.p_source_id &&
          candidate.original_byte_sha256 === args?.p_original_byte_sha256 &&
          candidate.storage_bucket === args?.p_storage_bucket &&
          candidate.storage_path === args?.p_storage_path,
      );
      if (!row) {
        return { data: null, error: { message: "not found" } };
      }
      row.storage_uploaded_at ??= "2026-10-29T00:00:00.000Z";
      return { data: row, error: null };
    }

    return { data: null, error: { message: `Unexpected RPC ${functionName}` } };
  }
}

describe("experience source storage", () => {
  it("hashes bytes and builds deterministic private storage paths", () => {
    const hash = hashExperienceSourceBytes(Buffer.from("experience"));
    const path = buildExperienceSourceStoragePath(hash, "My Experience.DOCX");

    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(path, `sources/sha256/${hash.slice(0, 2)}/${hash}/original.docx`);
  });

  it("uploads to the private bucket and never returns a public URL", async () => {
    const client = new MockSourceStorageClient();
    const stored = await storeExperienceSourceFile(
      {
        bytes: Buffer.from("private source bytes"),
        fileName: "experience.pdf",
        fileType: "application/pdf",
      },
      client,
    );

    assert.equal(stored.uploadState, "uploaded");
    assert.equal(stored.storage.bucket, EXPERIENCE_SOURCES_BUCKET);
    assert.ok(stored.storage.uploadedAt);
    assert.equal("publicUrl" in stored, false);
    assert.equal("fileUrl" in stored, false);
    assert.equal(client.uploads[0].upsert, false);
    assert.equal(client.uploads[0].contentType, "application/pdf");
  });

  it("reconciles duplicate uploads and response-loss retries to one source", async () => {
    const client = new MockSourceStorageClient();
    const bytes = Buffer.from("same bytes");
    const first = await storeExperienceSourceFile(
      {
        bytes,
        fileName: "first.docx",
        fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      client,
    );
    const retry = await storeExperienceSourceFile(
      {
        bytes,
        fileName: "renamed.docx",
        fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
      client,
    );

    assert.equal(first.id, retry.id);
    assert.equal(first.storage.path, retry.storage.path);
    assert.equal(retry.uploadState, "already-uploaded");
    assert.equal(client.rowsByHash.size, 1);
    assert.deepEqual(client.rpcCalls, [
      "reserve_experience_source",
      "reconcile_experience_source_storage",
      "reserve_experience_source",
      "reconcile_experience_source_storage",
    ]);
  });

  it("rejects empty files before reserving source identity", async () => {
    const client = new MockSourceStorageClient();
    await assert.rejects(
      () => storeExperienceSourceFile({ bytes: Buffer.alloc(0), fileName: "empty.pdf", fileType: "application/pdf" }, client),
      /must not be empty/,
    );
    assert.equal(client.rpcCalls.length, 0);
  });
});
