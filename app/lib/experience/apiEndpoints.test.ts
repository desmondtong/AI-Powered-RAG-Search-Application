import assert from "node:assert/strict";
import Module from "node:module";
import { describe, it } from "node:test";
import { ExperienceApiError } from "./apiRoutes";
import { uploadExperienceSourceFromFile, type ExperienceServiceClient } from "./apiService";
import { EXPERIENCE_SOURCES_BUCKET } from "./sourceStorage";

interface MockServiceExports {
  listExperienceSources?: () => Promise<unknown>;
  uploadExperienceSourceFromFile?: (file: File) => Promise<unknown>;
  getExperienceSourceDetail?: (sourceId: string) => Promise<unknown>;
  extractExperienceSource?: (sourceId: string) => Promise<unknown>;
  parseExperienceSource?: (sourceId: string) => Promise<unknown>;
  saveExperienceDraft?: (sourceId: string, body: unknown) => Promise<unknown>;
  approveExperienceRevision?: (sourceId: string, body: unknown) => Promise<unknown>;
  indexExperienceRevision?: (sourceId: string, body: unknown) => Promise<unknown>;
  createDraftFromApprovedRevision?: (sourceId: string, body: unknown) => Promise<unknown>;
  getExperienceRevisionExport?: (sourceId: string, revisionId: string) => Promise<unknown>;
  getExperienceSourceFile?: (sourceId: string) => Promise<unknown>;
}

interface MockStoredSourceRow {
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

function mockCompiledModule(resolvedPath: string, exports: Record<string, unknown>) {
  const mockModule = new Module(resolvedPath);
  mockModule.filename = resolvedPath;
  mockModule.loaded = true;
  mockModule.exports = exports;
  require.cache[resolvedPath] = mockModule;
}

async function withMockedExperienceService<T>(routePath: string, serviceExports: MockServiceExports, run: (route: Record<string, unknown>) => Promise<T>) {
  const servicePath = require.resolve("./apiService");
  const resolvedRoutePath = require.resolve(routePath);
  const previousService = require.cache[servicePath];
  const previousRoute = require.cache[resolvedRoutePath];
  delete require.cache[resolvedRoutePath];
  mockCompiledModule(servicePath, {
    listExperienceSources: async () => ({ sources: [] }),
    uploadExperienceSourceFromFile: async () => ({ source: { id: "source-default" } }),
    getExperienceSourceDetail: async (sourceId: string) => ({ source: { id: sourceId } }),
    extractExperienceSource: async (sourceId: string) => ({ source_id: sourceId, status: "extracted" }),
    parseExperienceSource: async (sourceId: string) => ({ source_id: sourceId, status: "draft" }),
    saveExperienceDraft: async (sourceId: string, body: unknown) => ({ source_id: sourceId, body }),
    approveExperienceRevision: async (sourceId: string, body: unknown) => ({ source_id: sourceId, body }),
    indexExperienceRevision: async (sourceId: string, body: unknown) => ({ source_id: sourceId, body }),
    createDraftFromApprovedRevision: async (sourceId: string, body: unknown) => ({ source_id: sourceId, body }),
    getExperienceRevisionExport: async (sourceId: string, revisionId: string) => ({ source_id: sourceId, revision_id: revisionId }),
    getExperienceSourceFile: async (sourceId: string) => ({
      source_id: sourceId,
      file_name: "experience.docx",
      file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      file_size: 4,
      bytes: Buffer.from("docx"),
    }),
    ...serviceExports,
  });

  try {
    return await run(require(resolvedRoutePath));
  } finally {
    delete require.cache[resolvedRoutePath];
    if (previousRoute) {
      require.cache[resolvedRoutePath] = previousRoute;
    }
    delete require.cache[servicePath];
    if (previousService) {
      require.cache[servicePath] = previousService;
    }
  }
}

function sameOriginRequest(url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: {
      origin: new URL(url).origin,
      ...(init.headers || {}),
    },
  });
}

function pdfFile() {
  return new File([Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF")], "experience.pdf", {
    type: "application/pdf",
  });
}

class MockDuplicateUploadClient {
  readonly rowsByHash = new Map<string, MockStoredSourceRow>();
  readonly objects = new Set<string>();
  readonly uploads: Array<{ bucket: string; path: string }> = [];

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string) => {
        this.uploads.push({ bucket, path });
        const key = `${bucket}/${path}`;
        if (this.objects.has(key)) {
          return { data: null, error: { statusCode: 409, message: "The resource already exists" } };
        }
        this.objects.add(key);
        return { data: { path }, error: null };
      },
    }),
  };

  async rpc(functionName: string, args?: Record<string, unknown>) {
    if (functionName === "reserve_experience_source") {
      const hash = String(args?.p_original_byte_sha256);
      const existing = this.rowsByHash.get(hash);
      if (existing) {
        return { data: existing, error: null };
      }
      const row: MockStoredSourceRow = {
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
      const row = [...this.rowsByHash.values()].find((candidate) => candidate.id === args?.p_source_id);
      if (!row) {
        return { data: null, error: { message: "not found" } };
      }
      row.storage_uploaded_at ??= "2026-10-29T00:00:00.000Z";
      return { data: row, error: null };
    }

    return { data: null, error: { message: `Unexpected RPC ${functionName}` } };
  }
}

describe("experience API endpoints", () => {
  it("uploads through the route and returns durable next action metadata", async () => {
    await withMockedExperienceService("../../api/experiences/route", {
      uploadExperienceSourceFromFile: async (file: File) => ({
        source: {
          id: "source-1",
          file_name: file.name,
          status: "uploaded",
          actions: ["extract"],
        },
        upload_state: "already-uploaded",
        next_action: "extract",
      }),
    }, async (route) => {
      const formData = new FormData();
      formData.set("file", pdfFile());
      const response = await (route.POST as (req: Request) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences", {
          method: "POST",
          body: formData,
        }),
      );
      const body = await response.json();

      assert.equal(response.status, 201);
      assert.equal(body.source.id, "source-1");
      assert.equal(body.upload_state, "already-uploaded");
      assert.equal(body.next_action, "extract");
    });
  });

  it("rejects missing files and cross-origin mutations before service work", async () => {
    let serviceCalls = 0;
    await withMockedExperienceService("../../api/experiences/route", {
      uploadExperienceSourceFromFile: async () => {
        serviceCalls += 1;
        return {};
      },
    }, async (route) => {
      const emptyForm = new FormData();
      const missingResponse = await (route.POST as (req: Request) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences", {
          method: "POST",
          body: emptyForm,
        }),
      );
      assert.equal(missingResponse.status, 400);

      const formData = new FormData();
      formData.set("file", pdfFile());
      const crossOriginResponse = await (route.POST as (req: Request) => Promise<Response>)(
        new Request("http://localhost/api/experiences", {
          method: "POST",
          headers: { origin: "https://example.invalid" },
          body: formData,
        }),
      );
      const body = await crossOriginResponse.json();
      assert.equal(crossOriginResponse.status, 403);
      assert.equal(body.error.code, "cross-origin-rejected");
      assert.equal(serviceCalls, 0);
    });
  });

  it("lists and reads details with recoverable source status actions", async () => {
    await withMockedExperienceService("../../api/experiences/route", {
      listExperienceSources: async () => ({
        sources: [{ id: "source-1", status: "failed", actions: ["retry"] }],
      }),
    }, async (route) => {
      const response = await (route.GET as () => Promise<Response>)();
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(body.sources[0].actions, ["retry"]);
    });

    await withMockedExperienceService("../../api/experiences/[id]/route", {
      getExperienceSourceDetail: async (sourceId: string) => ({
        source: { id: sourceId, status: "draft", actions: ["review", "parse"] },
        latest_extraction: { id: "snapshot-1" },
        latest_revision: { id: "revision-1" },
        revisions: [{ id: "revision-1" }],
      }),
    }, async (route) => {
      const response = await (route.GET as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1"),
        { params: { id: "source-1" } },
      );
      const body = await response.json();
      assert.equal(body.source.id, "source-1");
      assert.deepEqual(body.source.actions, ["review", "parse"]);
      assert.equal(body.latest_revision.id, "revision-1");
    });
  });

  it("returns safe not-found errors for inaccessible sources", async () => {
    await withMockedExperienceService("../../api/experiences/[id]/route", {
      getExperienceSourceDetail: async () => {
        throw new ExperienceApiError("source-not-found", "Experience source was not found.", 404);
      },
    }, async (route) => {
      const response = await (route.GET as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        new Request("http://localhost/api/experiences/missing"),
        { params: { id: "missing" } },
      );
      const body = await response.json();
      assert.equal(response.status, 404);
      assert.equal(body.error.code, "source-not-found");
    });
  });

  it("runs extract and parse actions only for same-origin mutations", async () => {
    await withMockedExperienceService("../../api/experiences/[id]/extract/route", {
      extractExperienceSource: async (sourceId: string) => ({
        source_id: sourceId,
        status: "extracted",
        next_action: "parse",
      }),
    }, async (route) => {
      const response = await (route.POST as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences/source-1/extract", { method: "POST" }),
        { params: { id: "source-1" } },
      );
      const body = await response.json();
      assert.equal(body.status, "extracted");
      assert.equal(body.next_action, "parse");
    });

    await withMockedExperienceService("../../api/experiences/[id]/parse/route", {
      parseExperienceSource: async (sourceId: string) => ({
        source_id: sourceId,
        status: "draft",
        next_action: "review",
      }),
    }, async (route) => {
      const crossOriginResponse = await (route.POST as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/parse", {
          method: "POST",
          headers: { origin: "https://example.invalid" },
        }),
        { params: { id: "source-1" } },
      );
      assert.equal(crossOriginResponse.status, 403);

      const response = await (route.POST as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences/source-1/parse", { method: "POST" }),
        { params: { id: "source-1" } },
      );
      const body = await response.json();
      assert.equal(body.status, "draft");
      assert.equal(body.next_action, "review");
    });
  });

  it("runs draft save and approval actions through same-origin review endpoints", async () => {
    await withMockedExperienceService("../../api/experiences/[id]/draft/route", {
      saveExperienceDraft: async (sourceId: string, body: unknown) => ({
        source_id: sourceId,
        revision_id: (body as { revision_id: string }).revision_id,
        draft_version: 2,
        next_action: "review",
      }),
    }, async (route) => {
      const response = await (route.PATCH as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences/source-1/draft", {
          method: "PATCH",
          body: JSON.stringify({
            revision_id: "revision-1",
            expected_draft_version: 1,
            draft: {},
          }),
        }),
        { params: { id: "source-1" } },
      );
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.revision_id, "revision-1");
      assert.equal(body.next_action, "review");
    });

    await withMockedExperienceService("../../api/experiences/[id]/approve/route", {
      approveExperienceRevision: async (sourceId: string, body: unknown) => ({
        source_id: sourceId,
        revision_id: (body as { revision_id: string }).revision_id,
        status: "approved",
        next_action: "index",
      }),
    }, async (route) => {
      const crossOriginResponse = await (route.POST as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/approve", {
          method: "POST",
          headers: { origin: "https://example.invalid" },
          body: JSON.stringify({
            revision_id: "revision-1",
            expected_draft_version: 2,
          }),
        }),
        { params: { id: "source-1" } },
      );
      assert.equal(crossOriginResponse.status, 403);

      const response = await (route.POST as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences/source-1/approve", {
          method: "POST",
          body: JSON.stringify({
            revision_id: "revision-1",
            expected_draft_version: 2,
          }),
        }),
        { params: { id: "source-1" } },
      );
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.status, "approved");
      assert.equal(body.next_action, "index");
    });
  });

  it("runs indexing through a same-origin mutation and returns progress without early success", async () => {
    await withMockedExperienceService("../../api/experiences/[id]/index/route", {
      indexExperienceRevision: async (sourceId: string, body: unknown) => ({
        source_id: sourceId,
        revision_id: (body as { revision_id?: string }).revision_id ?? "latest-approved",
        status: "indexing",
        stage: "embedding-preparation",
        progress: {
          total_chunks: 3,
          prepared_chunks: 1,
          remaining_chunks: 2,
        },
        publication: null,
        next_action: "index",
      }),
    }, async (route) => {
      const crossOriginResponse = await (route.POST as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/index", {
          method: "POST",
          headers: { origin: "https://example.invalid" },
          body: JSON.stringify({ revision_id: "revision-1" }),
        }),
        { params: { id: "source-1" } },
      );
      assert.equal(crossOriginResponse.status, 403);

      const response = await (route.POST as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences/source-1/index", {
          method: "POST",
          body: JSON.stringify({ revision_id: "revision-1" }),
        }),
        { params: { id: "source-1" } },
      );
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.status, "indexing");
      assert.equal(body.publication, null);
      assert.equal(body.progress.remaining_chunks, 2);
      assert.equal(body.next_action, "index");
    });
  });

  it("creates edit drafts from approved revisions and exports retained approved revisions", async () => {
    await withMockedExperienceService("../../api/experiences/[id]/draft-from-approved/route", {
      createDraftFromApprovedRevision: async (sourceId: string, body: unknown) => ({
        source_id: sourceId,
        revision_id: "draft-2",
        cloned_from_revision_id: (body as { approved_revision_id: string }).approved_revision_id,
        next_action: "review",
      }),
    }, async (route) => {
      const crossOriginResponse = await (route.POST as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/draft-from-approved", {
          method: "POST",
          headers: { origin: "https://example.invalid" },
          body: JSON.stringify({ approved_revision_id: "approved-1" }),
        }),
        { params: { id: "source-1" } },
      );
      assert.equal(crossOriginResponse.status, 403);

      const response = await (route.POST as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences/source-1/draft-from-approved", {
          method: "POST",
          body: JSON.stringify({ approved_revision_id: "approved-1" }),
        }),
        { params: { id: "source-1" } },
      );
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.revision_id, "draft-2");
      assert.equal(body.cloned_from_revision_id, "approved-1");
      assert.equal(body.next_action, "review");
    });

    await withMockedExperienceService("../../api/experiences/[id]/revisions/[revisionId]/export/route", {
      getExperienceRevisionExport: async (sourceId: string, revisionId: string) => ({
        source_id: sourceId,
        revision_id: revisionId,
        resolved_source_refs: [],
      }),
    }, async (route) => {
      const response = await (route.GET as (
        req: Request,
        context: { params: { id: string; revisionId: string } },
      ) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/revisions/approved-1/export"),
        { params: { id: "source-1", revisionId: "approved-1" } },
      );
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.revision_id, "approved-1");
    });
  });

  it("serves private source files through trusted read boundaries", async () => {
    let serviceCalls = 0;
    await withMockedExperienceService("../../api/experiences/[id]/file/route", {
      getExperienceSourceFile: async (sourceId: string) => {
        serviceCalls += 1;
        return {
          source_id: sourceId,
          file_name: "experience.docx",
          file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          file_size: 4,
          bytes: Buffer.from("docx"),
        };
      },
    }, async (route) => {
      const crossOriginResponse = await (route.GET as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/file", {
          headers: { origin: "https://example.invalid" },
        }),
        { params: { id: "source-1" } },
      );
      const crossOriginBody = await crossOriginResponse.json();
      assert.equal(crossOriginResponse.status, 403);
      assert.equal(crossOriginBody.error.code, "cross-origin-rejected");
      assert.equal(serviceCalls, 0);

      const response = await (route.GET as (req: Request, context: { params: { id: string } }) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/file", {
          headers: {
            origin: "http://localhost",
            "sec-fetch-site": "same-origin",
          },
        }),
        { params: { id: "source-1" } },
      );
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "docx");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match(response.headers.get("content-disposition") ?? "", /attachment; filename="experience\.docx"/);
      assert.equal(serviceCalls, 1);
    });
  });

  it("reconciles duplicate source uploads through the real upload service helper", async () => {
    const client = new MockDuplicateUploadClient();
    const first = await uploadExperienceSourceFromFile(pdfFile(), client as unknown as ExperienceServiceClient);
    const retry = await uploadExperienceSourceFromFile(pdfFile(), client as unknown as ExperienceServiceClient);

    assert.equal(first.source.id, retry.source.id);
    assert.equal(first.upload_state, "uploaded");
    assert.equal(retry.upload_state, "already-uploaded");
    assert.equal(first.source.status, "uploaded");
    assert.equal(first.source.actions[0], "extract");
    assert.equal(client.uploads[0].bucket, EXPERIENCE_SOURCES_BUCKET);
    assert.equal(client.rowsByHash.size, 1);
  });
});
