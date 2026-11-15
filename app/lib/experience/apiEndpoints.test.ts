/* eslint-disable @typescript-eslint/no-require-imports */
import assert from "node:assert/strict";
import Module from "node:module";
import { describe, it } from "node:test";
import { ExperienceApiError } from "./apiRoutes";
import {
  getExperienceSourceDetail,
  listExperienceSources,
  uploadExperienceSourceFromFile,
  type ExperienceServiceClient,
} from "./apiService";
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
  deleteExperienceSource?: (sourceId: string) => Promise<unknown>;
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
    deleteExperienceSource: async (sourceId: string) => ({ source_id: sourceId, status: "deleted" }),
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

type SourceRouteContext = { params: Promise<{ id: string }> };
type RevisionRouteContext = { params: Promise<{ id: string; revisionId: string }> };

function routeContext<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
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

type TableRow = Record<string, unknown>;

class MockReadBuilder {
  private readonly predicates: Array<(row: TableRow) => boolean> = [];
  private orderBy: { key: string; ascending: boolean } | null = null;
  private maxRows: number | null = null;

  constructor(private readonly rows: TableRow[]) {}

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.predicates.push((row) => row[key] === value);
    return this;
  }

  is(key: string, value: unknown) {
    this.predicates.push((row) => (row[key] ?? null) === value);
    return this;
  }

  not(key: string, operator: string, value: unknown) {
    assert.equal(operator, "is");
    this.predicates.push((row) => (row[key] ?? null) !== value);
    return this;
  }

  in(key: string, values: unknown[]) {
    this.predicates.push((row) => values.includes(row[key]));
    return this;
  }

  order(key: string, options: { ascending?: boolean } = {}) {
    this.orderBy = { key, ascending: options.ascending ?? true };
    return this;
  }

  limit(value: number) {
    this.maxRows = value;
    return this;
  }

  then(resolve: (value: { data: TableRow[]; error: null }) => void) {
    let rows = this.rows.filter((row) => this.predicates.every((predicate) => predicate(row)));
    if (this.orderBy) {
      const { key, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1) * (ascending ? 1 : -1));
    }
    if (this.maxRows !== null) {
      rows = rows.slice(0, this.maxRows);
    }
    return Promise.resolve({ data: structuredClone(rows), error: null }).then(resolve);
  }
}

class MockVersionReadClient {
  readonly queries: string[] = [];

  constructor(private readonly tables: Record<string, TableRow[]>) {}

  from(table: string) {
    this.queries.push(table);
    return new MockReadBuilder(this.tables[table] ?? []);
  }
}

function sourceRow(id: string, overrides: TableRow = {}): TableRow {
  return {
    id,
    original_byte_sha256: `hash-${id}`,
    original_file_name: `${id}.docx`,
    original_file_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    original_file_size: 10,
    storage_bucket: EXPERIENCE_SOURCES_BUCKET,
    storage_path: `sources/${id}.docx`,
    status: "draft",
    latest_extraction_id: null,
    latest_draft_revision_id: null,
    latest_approved_revision_id: null,
    active_revision_id: null,
    failure: null,
    cleanup_error: null,
    deleted_at: null,
    created_at: "2026-11-01T00:00:00+00:00",
    updated_at: "2026-11-01T00:00:00+00:00",
    ...overrides,
  };
}

function revisionRow(id: string, sourceId: string, day: number, approved: boolean): TableRow {
  const stamp = `2026-11-${String(day).padStart(2, "0")}T00:00:00+00:00`;
  return {
    id,
    source_id: sourceId,
    extraction_id: "extraction-1",
    status: approved ? "approved" : "draft",
    draft_json: {},
    draft_version: 1,
    approved_json: approved ? {} : null,
    approved_content_hash: approved ? `hash-${id}` : null,
    approved_at: approved ? stamp : null,
    created_at: stamp,
  };
}

describe("approved version numbers in source responses", () => {
  it("numbers every approved revision in detail, beyond the recent revision list", async () => {
    // Seven revisions: approvals on days 1, 2, 4, 5 and 6; abandoned draft on day 3; open draft on day 7.
    const revisions = [
      revisionRow("rev-a", "source-1", 1, true),
      revisionRow("rev-b", "source-1", 2, true),
      revisionRow("rev-abandoned", "source-1", 3, false),
      revisionRow("rev-c", "source-1", 4, true),
      revisionRow("rev-d", "source-1", 5, true),
      revisionRow("rev-e", "source-1", 6, true),
      revisionRow("rev-draft", "source-1", 7, false),
    ];
    const client = new MockVersionReadClient({
      experience_sources: [sourceRow("source-1", {
        status: "draft",
        latest_draft_revision_id: "rev-draft",
        latest_approved_revision_id: "rev-e",
        active_revision_id: "rev-d",
      })],
      experience_extractions: [],
      experience_revisions: revisions,
    });

    const detail = await getExperienceSourceDetail("source-1", client as unknown as ExperienceServiceClient);

    assert.equal(detail.revisions.length, 5);
    assert.deepEqual(
      detail.approved_versions.map((version) => [version.revision_id, version.version_number]),
      [["rev-a", 1], ["rev-b", 2], ["rev-c", 3], ["rev-d", 4], ["rev-e", 5]],
    );
    assert.equal(detail.approved_versions[0].approved_at, "2026-11-01T00:00:00+00:00");
    assert.equal(detail.source.active_version_number, 4);
    assert.equal(detail.source.latest_approved_version_number, 5);
    assert.ok(!detail.approved_versions.some((version) => version.revision_id === "rev-draft"));
    assert.ok(!detail.approved_versions.some((version) => version.revision_id === "rev-abandoned"));
    assert.equal(client.queries.filter((table) => table === "experience_revisions").length, 2);
  });

  it("reports null version numbers for a source that was never approved", async () => {
    const client = new MockVersionReadClient({
      experience_sources: [sourceRow("source-1", { latest_draft_revision_id: "rev-draft" })],
      experience_revisions: [revisionRow("rev-draft", "source-1", 1, false)],
    });

    const detail = await getExperienceSourceDetail("source-1", client as unknown as ExperienceServiceClient);

    assert.deepEqual(detail.approved_versions, []);
    assert.equal(detail.source.active_version_number, null);
    assert.equal(detail.source.latest_approved_version_number, null);
  });

  it("fills list summaries from one revision read across all sources", async () => {
    const client = new MockVersionReadClient({
      experience_sources: [
        sourceRow("source-1", { status: "indexed", latest_approved_revision_id: "s1-v2", active_revision_id: "s1-v1" }),
        sourceRow("source-2", { status: "approved", latest_approved_revision_id: "s2-v1" }),
        sourceRow("source-3", { status: "draft", latest_draft_revision_id: "s3-draft" }),
      ],
      experience_revisions: [
        revisionRow("s1-v1", "source-1", 1, true),
        revisionRow("s2-v1", "source-2", 2, true),
        revisionRow("s1-v2", "source-1", 3, true),
        revisionRow("s3-draft", "source-3", 4, false),
      ],
    });

    const { sources } = await listExperienceSources(client as unknown as ExperienceServiceClient);
    const byId = new Map(sources.map((source) => [source.id, source]));

    assert.equal(byId.get("source-1")?.active_version_number, 1);
    assert.equal(byId.get("source-1")?.latest_approved_version_number, 2);
    assert.equal(byId.get("source-2")?.latest_approved_version_number, 1);
    assert.equal(byId.get("source-2")?.active_version_number, null);
    assert.equal(byId.get("source-3")?.latest_approved_version_number, null);
    assert.equal(client.queries.filter((table) => table === "experience_revisions").length, 1);
  });

  it("skips the revision read when there are no sources", async () => {
    const client = new MockVersionReadClient({ experience_sources: [] });
    const { sources } = await listExperienceSources(client as unknown as ExperienceServiceClient);
    assert.deepEqual(sources, []);
    assert.deepEqual(client.queries, ["experience_sources"]);
  });
});

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
      const response = await (route.GET as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1"),
        routeContext({ id: "source-1" }),
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
      const response = await (route.GET as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        new Request("http://localhost/api/experiences/missing"),
        routeContext({ id: "missing" }),
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
      const response = await (route.POST as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences/source-1/extract", { method: "POST" }),
        routeContext({ id: "source-1" }),
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
      const crossOriginResponse = await (route.POST as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/parse", {
          method: "POST",
          headers: { origin: "https://example.invalid" },
        }),
        routeContext({ id: "source-1" }),
      );
      assert.equal(crossOriginResponse.status, 403);

      const response = await (route.POST as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences/source-1/parse", { method: "POST" }),
        routeContext({ id: "source-1" }),
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
      const response = await (route.PATCH as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences/source-1/draft", {
          method: "PATCH",
          body: JSON.stringify({
            revision_id: "revision-1",
            expected_draft_version: 1,
            draft: {},
          }),
        }),
        routeContext({ id: "source-1" }),
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
      const crossOriginResponse = await (route.POST as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/approve", {
          method: "POST",
          headers: { origin: "https://example.invalid" },
          body: JSON.stringify({
            revision_id: "revision-1",
            expected_draft_version: 2,
          }),
        }),
        routeContext({ id: "source-1" }),
      );
      assert.equal(crossOriginResponse.status, 403);

      const response = await (route.POST as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences/source-1/approve", {
          method: "POST",
          body: JSON.stringify({
            revision_id: "revision-1",
            expected_draft_version: 2,
          }),
        }),
        routeContext({ id: "source-1" }),
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
      const crossOriginResponse = await (route.POST as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/index", {
          method: "POST",
          headers: { origin: "https://example.invalid" },
          body: JSON.stringify({ revision_id: "revision-1" }),
        }),
        routeContext({ id: "source-1" }),
      );
      assert.equal(crossOriginResponse.status, 403);

      const response = await (route.POST as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences/source-1/index", {
          method: "POST",
          body: JSON.stringify({ revision_id: "revision-1" }),
        }),
        routeContext({ id: "source-1" }),
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
      const crossOriginResponse = await (route.POST as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/draft-from-approved", {
          method: "POST",
          headers: { origin: "https://example.invalid" },
          body: JSON.stringify({ approved_revision_id: "approved-1" }),
        }),
        routeContext({ id: "source-1" }),
      );
      assert.equal(crossOriginResponse.status, 403);

      const response = await (route.POST as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences/source-1/draft-from-approved", {
          method: "POST",
          body: JSON.stringify({ approved_revision_id: "approved-1" }),
        }),
        routeContext({ id: "source-1" }),
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
        context: RevisionRouteContext,
      ) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/revisions/approved-1/export"),
        routeContext({ id: "source-1", revisionId: "approved-1" }),
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
      const crossOriginResponse = await (route.GET as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/file", {
          headers: { origin: "https://example.invalid" },
        }),
        routeContext({ id: "source-1" }),
      );
      const crossOriginBody = await crossOriginResponse.json();
      assert.equal(crossOriginResponse.status, 403);
      assert.equal(crossOriginBody.error.code, "cross-origin-rejected");
      assert.equal(serviceCalls, 0);

      const response = await (route.GET as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1/file", {
          headers: {
            origin: "http://localhost",
            "sec-fetch-site": "same-origin",
          },
        }),
        routeContext({ id: "source-1" }),
      );
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "docx");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match(response.headers.get("content-disposition") ?? "", /attachment; filename="experience\.docx"/);
      assert.equal(serviceCalls, 1);
    });
  });

  it("deletes experience sources through same-origin mutations", async () => {
    let serviceCalls = 0;
    await withMockedExperienceService("../../api/experiences/[id]/route", {
      deleteExperienceSource: async (sourceId: string) => {
        serviceCalls += 1;
        return {
          source_id: sourceId,
          status: "deleted",
          cleanup_pending: false,
          next_action: null,
        };
      },
    }, async (route) => {
      const crossOriginResponse = await (route.DELETE as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        new Request("http://localhost/api/experiences/source-1", {
          method: "DELETE",
          headers: { origin: "https://example.invalid" },
        }),
        routeContext({ id: "source-1" }),
      );
      const crossOriginBody = await crossOriginResponse.json();
      assert.equal(crossOriginResponse.status, 403);
      assert.equal(crossOriginBody.error.code, "cross-origin-rejected");
      assert.equal(serviceCalls, 0);

      const response = await (route.DELETE as (req: Request, context: SourceRouteContext) => Promise<Response>)(
        sameOriginRequest("http://localhost/api/experiences/source-1", { method: "DELETE" }),
        routeContext({ id: "source-1" }),
      );
      const body = await response.json();
      assert.equal(response.status, 200);
      assert.equal(body.source_id, "source-1");
      assert.equal(body.status, "deleted");
      assert.equal(body.cleanup_pending, false);
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
