import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gunzipSync } from "node:zlib";
import {
  approveExperienceRevision,
  extractExperienceSource,
  getExperienceRevisionExport,
  getExperienceSourceFile,
  indexExperienceRevision,
  saveExperienceDraft,
  uploadExperienceSourceFromFile,
  type ExperienceServiceClient,
} from "./apiService";
import { searchApprovedExperienceEvidence, type ApprovedExperienceSearchClient } from "./approvedSearch";
import {
  assertSpanInSnapshot,
  hashCanonicalRevisionContent,
  parseCanonicalExperienceRevision,
  type ExtractionSnapshot,
} from "./contracts";
import { persistExperienceDraft, type ExperienceDraftPersistenceClient } from "./draftPersistence";
import { snapshotFromExperienceExtractionRow, type ExperienceExtractionInsertRow } from "./extractionSnapshot";
import {
  freezeApprovedExperienceIndexPlan,
  type ExperienceChildPlanEntry,
  type ExperienceParentPlanEntry,
} from "./parentPlanning";
import {
  EXPERIENCE_STRUCTURED_PROMPT_VERSION,
  generateValidatedStructuredExperienceDraft,
  type StructuredExperienceModelProposal,
} from "./structuredGeneration";

type SourceRow = {
  id: string;
  original_byte_sha256: string;
  original_file_name: string;
  original_file_type: string;
  original_file_size: number;
  storage_bucket: string;
  storage_path: string;
  status: string;
  latest_extraction_id: string | null;
  latest_draft_revision_id: string | null;
  latest_approved_revision_id: string | null;
  active_revision_id: string | null;
  failure: unknown;
  cleanup_error: unknown;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  storage_uploaded_at: string | null;
  execution_token: string | null;
  execution_stage: string | null;
  execution_token_expires_at: string | null;
};

type RevisionRow = {
  id: string;
  source_id: string;
  extraction_id: string;
  status: string;
  draft_json: unknown;
  draft_version: number;
  approved_json: unknown;
  approved_content_hash: string | null;
  model_version: string | null;
  prompt_version: string | null;
  parse_error: unknown;
  created_at: string;
  updated_at: string;
};

type StagingRow = {
  revision_id: string;
  logical_chunk_key: string;
  plan_hash: string;
  approved_content_hash: string;
  chunking_version: string;
  embedding_model: string;
  embedding_task_type: string;
  embedding_dimensions: number;
  parent_payload: {
    source_document_id: string;
    source_file_name: string;
    source_file_type: string;
    parent_text: string;
    metadata: ExperienceParentPlanEntry["metadata"];
  };
  child_payload: {
    child_text: string;
    embedding_text: string;
    metadata: ExperienceChildPlanEntry["metadata"];
    logical_chunk_id: string;
    chunk_index: number;
  };
  embedding: number[];
  prepared_at: string | null;
};

type ParentRow = {
  id: string;
  source_document_id: string;
  source_file_name: string;
  source_file_type: string;
  parent_text: string;
  metadata: ExperienceParentPlanEntry["metadata"];
  created_at: string;
  updated_at: string;
};

type ChunkRow = {
  id: string;
  parent_id: string;
  child_text: string;
  embedding_text: string;
  metadata: ExperienceChildPlanEntry["metadata"];
  chunk_index: number;
  embedding: number[];
};

type RevisionParentRow = {
  revision_id: string;
  parent_id: string;
  source_id: string;
  logical_experience_id: string;
  logical_parent_id: string;
};

type QueryFilter = {
  key: string;
  value: unknown;
  kind: "eq" | "is";
};

const NOW = "2026-10-29T12:00:00.000Z";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint16(value: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function uint32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function zipStored(entries: Array<[string, string]>) {
  const localFiles: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;

  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const checksum = crc32(data);
    const localHeader = Buffer.concat([
      uint32(0x04034b50),
      uint16(20),
      uint16(0),
      uint16(0),
      uint16(0),
      uint16(0),
      uint32(checksum),
      uint32(data.length),
      uint32(data.length),
      uint16(nameBytes.length),
      uint16(0),
      nameBytes,
      data,
    ]);
    localFiles.push(localHeader);
    centralDirectory.push(
      Buffer.concat([
        uint32(0x02014b50),
        uint16(20),
        uint16(20),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(checksum),
        uint32(data.length),
        uint32(data.length),
        uint16(nameBytes.length),
        uint16(0),
        uint16(0),
        uint16(0),
        uint16(0),
        uint32(0),
        uint32(offset),
        nameBytes,
      ]),
    );
    offset += localHeader.length;
  }

  const localBuffer = Buffer.concat(localFiles);
  const centralBuffer = Buffer.concat(centralDirectory);
  return Buffer.concat([
    localBuffer,
    centralBuffer,
    uint32(0x06054b50),
    uint16(0),
    uint16(0),
    uint16(entries.length),
    uint16(entries.length),
    uint32(centralBuffer.length),
    uint32(localBuffer.length),
    uint16(0),
  ]);
}

function xmlText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fileFromBuffer(bytes: Buffer, name: string, type: string) {
  return new File([new Uint8Array(bytes)], name, { type });
}

function structuredDocxFile() {
  const paragraphs = [
    "Project Atlas delivered a source-grounded review workflow. I led the API integration and reviewers approved the indexed release.",
    "Project Beacon reduced onboarding review time by about 30 percent for the team. I built the retry dashboard and the next rollout remains planned.",
  ];
  const body = paragraphs.map((paragraph) => `<w:p><w:r><w:t>${xmlText(paragraph)}</w:t></w:r></w:p>`).join("");
  const bytes = zipStored([
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
    [
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    ],
  ]);
  return fileFromBuffer(bytes, "structured-experience.docx", DOCX_MIME);
}

function genericPdfFile() {
  const source = readFileSync(join(process.cwd(), "app/lib/experience/documentExtraction.test.ts"), "utf8");
  const match = source.match(/const PDF_FIXTURE_GZIP_BASE64 = `([\s\S]*?)`;/);
  assert.ok(match, "generic selectable-PDF fixture should remain available");
  const bytes = gunzipSync(Buffer.from(match[1].replace(/\s/g, ""), "base64"));
  return fileFromBuffer(bytes, "structured-experience.pdf", "application/pdf");
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function storagePathFor(hash: string, fileName: string) {
  const extension = fileName.toLowerCase().endsWith(".pdf") ? "pdf" : "docx";
  return `sources/sha256/${hash.slice(0, 2)}/${hash}/original.${extension}`;
}

function vectorForText(input: string) {
  const vector = Array.from({ length: 1536 }, () => 0);
  if (/i built the retry dashboard/i.test(input)) {
    vector[3] = 1;
  } else if (/beacon/i.test(input)) {
    vector[1] = 1;
  } else if (/generic pdf|second pdf/i.test(input)) {
    vector[2] = 1;
  } else {
    vector[0] = 1;
  }
  return vector;
}

function dotProduct(left: number[], right: number[]) {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

class SelectBuilder {
  private filters: QueryFilter[] = [];
  private maxRows: number | null = null;
  private orderKey: string | null = null;
  private orderAscending = true;

  constructor(private readonly rows: () => Record<string, unknown>[]) {}

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

  order(key: string, options?: { ascending?: boolean }) {
    this.orderKey = key;
    this.orderAscending = options?.ascending ?? true;
    return this;
  }

  limit(value: number) {
    this.maxRows = value;
    return this;
  }

  resultRows() {
    let rows = this.rows().filter((row) =>
      this.filters.every((filter) => {
        if (filter.kind === "is") {
          return row[filter.key] === filter.value;
        }
        return row[filter.key] === filter.value;
      }),
    );
    if (this.orderKey) {
      const key = this.orderKey;
      rows = rows.sort((left, right) => {
        const leftValue = String(left[key] ?? "");
        const rightValue = String(right[key] ?? "");
        return this.orderAscending ? leftValue.localeCompare(rightValue) : rightValue.localeCompare(leftValue);
      });
    }
    if (this.maxRows !== null) {
      rows = rows.slice(0, this.maxRows);
    }
    return rows;
  }

  then(resolve: (value: { data: Record<string, unknown>[]; error: null }) => void) {
    return Promise.resolve({ data: this.resultRows(), error: null }).then(resolve);
  }
}

class UpdateBuilder extends SelectBuilder {
  constructor(
    rows: () => Record<string, unknown>[],
    private readonly applyUpdate: (rows: Record<string, unknown>[]) => void,
  ) {
    super(rows);
  }

  then(resolve: (value: { data: Record<string, unknown>[]; error: null }) => void) {
    const rows = this.resultRows();
    this.applyUpdate(rows);
    return Promise.resolve({ data: rows, error: null }).then(resolve);
  }
}

class InMemoryExperienceClient implements ApprovedExperienceSearchClient {
  readonly sources = new Map<string, SourceRow>();
  readonly extractions = new Map<string, ExperienceExtractionInsertRow & { created_at: string }>();
  readonly revisions = new Map<string, RevisionRow>();
  readonly stagingRows: StagingRow[] = [];
  readonly storageObjects = new Map<string, Buffer>();
  readonly parents = new Map<string, ParentRow>();
  readonly chunks = new Map<string, ChunkRow>();
  readonly revisionParents: RevisionParentRow[] = [];
  private sourceCounter = 0;
  private tokenCounter = 0;
  private parentCounter = 0;
  private childCounter = 0;

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body: Buffer) => {
        const key = `${bucket}/${path}`;
        if (this.storageObjects.has(key)) {
          return { data: null, error: { statusCode: 409, message: "already exists" } };
        }
        this.storageObjects.set(key, Buffer.from(body));
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const bytes = this.storageObjects.get(`${bucket}/${path}`);
        if (!bytes) {
          return { data: null, error: { message: "not found" } };
        }
        return { data: new Blob([new Uint8Array(bytes)]), error: null };
      },
      remove: async (paths: string[]) => {
        for (const path of paths) {
          this.storageObjects.delete(`${bucket}/${path}`);
        }
        return { data: paths, error: null };
      },
    }),
  };

  from(table: string) {
    if (table === "experience_sources") {
      return {
        select: () => new SelectBuilder(() => [...this.sources.values()] as unknown as Record<string, unknown>[]),
        update: (patch: Record<string, unknown>) =>
          new UpdateBuilder(
            () => [...this.sources.values()] as unknown as Record<string, unknown>[],
            (rows) => {
              for (const row of rows) {
                const source = this.sources.get(String(row.id));
                if (source) {
                  Object.assign(source, patch, { updated_at: NOW });
                }
              }
            },
          ),
      };
    }
    if (table === "experience_extractions") {
      return {
        select: () => new SelectBuilder(() => [...this.extractions.values()] as unknown as Record<string, unknown>[]),
        insert: async (row: ExperienceExtractionInsertRow) => {
          this.extractions.set(row.id, { ...row, created_at: NOW });
          return { data: row, error: null };
        },
      };
    }
    if (table === "experience_revisions") {
      return {
        select: () => new SelectBuilder(() => [...this.revisions.values()] as unknown as Record<string, unknown>[]),
        insert: (row: Omit<RevisionRow, "created_at" | "updated_at" | "approved_json" | "approved_content_hash">) => ({
          select: () => ({
            single: async () => {
              const stored: RevisionRow = {
                ...row,
                approved_json: null,
                approved_content_hash: null,
                created_at: NOW,
                updated_at: NOW,
              };
              this.revisions.set(stored.id, stored);
              return { data: stored, error: null };
            },
          }),
        }),
      };
    }
    if (table === "experience_index_staging") {
      return {
        select: () => new SelectBuilder(() => this.stagingRows as unknown as Record<string, unknown>[]),
        upsert: async (rows: StagingRow[]) => {
          for (const row of rows) {
            const index = this.stagingRows.findIndex(
              (candidate) =>
                candidate.revision_id === row.revision_id &&
                candidate.logical_chunk_key === row.logical_chunk_key,
            );
            if (index >= 0) {
              this.stagingRows[index] = row;
            } else {
              this.stagingRows.push(row);
            }
          }
          return { data: rows, error: null };
        },
      };
    }
    return {
      select: () => new SelectBuilder(() => []),
    };
  }

  async rpc(functionName: string, args: Record<string, unknown>) {
    switch (functionName) {
      case "reserve_experience_source":
        return this.reserveSource(args);
      case "reconcile_experience_source_storage":
        return this.reconcileSource(args);
      case "acquire_experience_source_execution":
        return this.acquireExecution(args);
      case "complete_experience_source_execution":
        return this.completeExecution(args);
      case "update_experience_revision_draft":
        return this.updateDraft(args);
      case "approve_experience_revision":
        return this.approveRevision(args);
      case "stage_experience_embeddings": {
        const source = this.sources.get(String(args.p_source_id));
        if (!source || source.execution_token !== args.p_execution_token || source.execution_stage !== "indexing") {
          return { data: null, error: { code: "40001", message: "stale execution token" } };
        }
        return this.from("experience_index_staging").upsert!(args.p_rows as StagingRow[]);
      }
      case "publish_experience_revision":
        return this.publishRevision(args);
      case "match_approved_experience_chunks":
        return this.searchApproved(args);
      default:
        return { data: null, error: { message: `Unexpected RPC ${functionName}` } };
    }
  }

  private reserveSource(args: Record<string, unknown>) {
    const hash = String(args.p_original_byte_sha256);
    const existing = [...this.sources.values()].find(
      (source) => source.original_byte_sha256 === hash && source.deleted_at === null,
    );
    if (existing) {
      return { data: existing, error: null };
    }

    this.sourceCounter += 1;
    const id = `source-${String(this.sourceCounter).padStart(4, "0")}`;
    const fileName = String(args.p_original_file_name);
    const source: SourceRow = {
      id,
      original_byte_sha256: hash,
      original_file_name: fileName,
      original_file_type: String(args.p_original_file_type),
      original_file_size: Number(args.p_original_file_size),
      storage_bucket: "experience-sources",
      storage_path: String(args.p_storage_path || storagePathFor(hash, fileName)),
      status: "uploaded",
      latest_extraction_id: null,
      latest_draft_revision_id: null,
      latest_approved_revision_id: null,
      active_revision_id: null,
      failure: null,
      cleanup_error: null,
      deleted_at: null,
      created_at: NOW,
      updated_at: NOW,
      storage_uploaded_at: null,
      execution_token: null,
      execution_stage: null,
      execution_token_expires_at: null,
    };
    this.sources.set(id, source);
    return { data: source, error: null };
  }

  private reconcileSource(args: Record<string, unknown>) {
    const source = this.sources.get(String(args.p_source_id));
    if (!source) {
      return { data: null, error: { message: "source not found" } };
    }
    source.storage_uploaded_at = NOW;
    source.updated_at = NOW;
    return { data: source, error: null };
  }

  private acquireExecution(args: Record<string, unknown>) {
    const source = this.sources.get(String(args.p_source_id));
    if (!source) {
      return { data: null, error: { message: "source not found" } };
    }
    if (source.execution_token) {
      return { data: null, error: { code: "55P03", message: "source is leased" } };
    }
    this.tokenCounter += 1;
    source.execution_token = `execution-token-${this.tokenCounter}`;
    source.execution_stage = String(args.p_stage);
    source.execution_token_expires_at = "2026-10-29T12:05:00.000Z";
    source.status = String(args.p_stage);
    source.updated_at = NOW;
    return {
      data: {
        source_id: source.id,
        execution_token: source.execution_token,
        execution_stage: source.execution_stage,
        execution_token_expires_at: source.execution_token_expires_at,
        status: source.status,
      },
      error: null,
    };
  }

  private completeExecution(args: Record<string, unknown>) {
    const source = this.sources.get(String(args.p_source_id));
    if (!source || source.execution_token !== args.p_execution_token || source.execution_stage !== args.p_stage) {
      return { data: null, error: { code: "40001", message: "stale execution token" } };
    }
    source.status = String(args.p_next_status);
    if (args.p_latest_extraction_id) {
      source.latest_extraction_id = String(args.p_latest_extraction_id);
    }
    if (args.p_latest_draft_revision_id) {
      source.latest_draft_revision_id = String(args.p_latest_draft_revision_id);
    }
    source.failure = args.p_failure ?? null;
    source.execution_token = null;
    source.execution_stage = null;
    source.execution_token_expires_at = null;
    source.updated_at = NOW;
    return { data: source, error: null };
  }

  private updateDraft(args: Record<string, unknown>) {
    const revision = this.revisions.get(String(args.p_revision_id));
    if (!revision || revision.draft_version !== Number(args.p_expected_draft_version)) {
      return { data: null, error: { code: "40001", message: "draft version conflict" } };
    }
    revision.draft_json = args.p_draft_json;
    revision.draft_version += 1;
    revision.updated_at = NOW;
    const source = this.sources.get(revision.source_id);
    if (source) {
      source.status = "draft";
      source.latest_draft_revision_id = revision.id;
      source.updated_at = NOW;
    }
    return { data: revision, error: null };
  }

  private approveRevision(args: Record<string, unknown>) {
    const source = this.sources.get(String(args.p_source_id));
    const revision = this.revisions.get(String(args.p_revision_id));
    if (!source || !revision || source.latest_draft_revision_id !== revision.id) {
      return { data: null, error: { code: "40001", message: "approval candidate is stale" } };
    }
    if (revision.draft_version !== Number(args.p_expected_draft_version)) {
      return { data: null, error: { code: "40001", message: "approval version conflict" } };
    }
    revision.status = "approved";
    revision.approved_json = structuredClone(args.p_approved_json);
    revision.approved_content_hash = String(args.p_approved_content_hash);
    revision.updated_at = NOW;
    source.status = "approved";
    source.latest_draft_revision_id = null;
    source.latest_approved_revision_id = revision.id;
    source.updated_at = NOW;
    return { data: revision, error: null };
  }

  private publishRevision(args: Record<string, unknown>) {
    const source = this.sources.get(String(args.p_source_id));
    const revision = this.revisions.get(String(args.p_revision_id));
    if (!source || !revision || source.latest_approved_revision_id !== revision.id) {
      return { data: null, error: { code: "40001", message: "approved candidate is stale" } };
    }
    if (source.execution_token !== args.p_execution_token || source.execution_stage !== "indexing") {
      return { data: null, error: { code: "40001", message: "stale execution token" } };
    }
    const planHash = String(args.p_plan_hash);
    const stagingRows = this.stagingRows.filter(
      (row) => row.revision_id === revision.id && row.plan_hash === planHash && row.prepared_at,
    );
    if (stagingRows.length !== Number(args.p_expected_child_count)) {
      return { data: null, error: { code: "40001", message: "staging is incomplete" } };
    }

    const previousActiveRevisionId = source.active_revision_id;
    if (previousActiveRevisionId && previousActiveRevisionId !== revision.id) {
      const staleMappings = this.revisionParents.filter((mapping) => mapping.revision_id === previousActiveRevisionId);
      for (const mapping of staleMappings) {
        this.parents.delete(mapping.parent_id);
        for (const [chunkId, chunk] of this.chunks) {
          if (chunk.parent_id === mapping.parent_id) {
            this.chunks.delete(chunkId);
          }
        }
      }
      for (let index = this.revisionParents.length - 1; index >= 0; index -= 1) {
        if (this.revisionParents[index].revision_id === previousActiveRevisionId) {
          this.revisionParents.splice(index, 1);
        }
      }
    }

    const parentIdByLogicalId = new Map<string, string>();
    for (const row of stagingRows) {
      const logicalParentId = row.parent_payload.metadata.logical_parent_id;
      let parentId = parentIdByLogicalId.get(logicalParentId);
      if (!parentId) {
        this.parentCounter += 1;
        parentId = `parent-${this.parentCounter}`;
        parentIdByLogicalId.set(logicalParentId, parentId);
        this.parents.set(parentId, {
          id: parentId,
          source_document_id: row.parent_payload.source_document_id,
          source_file_name: row.parent_payload.source_file_name,
          source_file_type: row.parent_payload.source_file_type,
          parent_text: row.parent_payload.parent_text,
          metadata: row.parent_payload.metadata,
          created_at: NOW,
          updated_at: NOW,
        });
        this.revisionParents.push({
          revision_id: revision.id,
          parent_id: parentId,
          source_id: source.id,
          logical_experience_id: row.parent_payload.metadata.logical_experience_id,
          logical_parent_id: logicalParentId,
        });
      }

      this.childCounter += 1;
      this.chunks.set(`chunk-${this.childCounter}`, {
        id: `chunk-${this.childCounter}`,
        parent_id: parentId,
        child_text: row.child_payload.child_text,
        embedding_text: row.child_payload.embedding_text,
        metadata: row.child_payload.metadata,
        chunk_index: row.child_payload.chunk_index,
        embedding: row.embedding,
      });
    }

    revision.status = "indexed";
    source.status = "indexed";
    source.active_revision_id = revision.id;
    source.execution_token = null;
    source.execution_stage = null;
    source.execution_token_expires_at = null;
    for (let index = this.stagingRows.length - 1; index >= 0; index -= 1) {
      if (this.stagingRows[index].revision_id === revision.id) {
        this.stagingRows.splice(index, 1);
      }
    }

    return {
      data: {
        status: "indexed",
        already_published: false,
        revision_id: revision.id,
        active_revision_id: revision.id,
        previous_active_revision_id: previousActiveRevisionId,
        parent_count: Number(args.p_expected_parent_count),
        child_count: Number(args.p_expected_child_count),
        plan_hash: planHash,
      },
      error: null,
    };
  }

  private searchApproved(args: Record<string, unknown>) {
    const selectedSources = args.source_ids as string[] | null;
    const eligibleSources = [...this.sources.values()].filter(
      (source) => source.deleted_at === null && source.active_revision_id && source.status === "indexed",
    );
    if (selectedSources) {
      const eligibleIds = new Set(eligibleSources.map((source) => source.id));
      if (selectedSources.some((sourceId) => !eligibleIds.has(sourceId))) {
        return { data: null, error: { code: "40001", message: "Selected experience source is not eligible" } };
      }
    }

    const sourceFilter = selectedSources ? new Set(selectedSources) : null;
    const queryVector = JSON.parse(String(args.query_embedding)) as number[];
    const matchCount = Number(args.match_count);
    const rows = [...this.chunks.values()]
      .flatMap((chunk) => {
        const parent = this.parents.get(chunk.parent_id);
        const mapping = this.revisionParents.find((candidate) => candidate.parent_id === chunk.parent_id);
        if (!parent || !mapping) {
          return [];
        }
        const source = this.sources.get(mapping.source_id);
        const revision = this.revisions.get(mapping.revision_id);
        if (
          !source ||
          !revision ||
          source.active_revision_id !== revision.id ||
          sourceFilter?.has(source.id) === false
        ) {
          return [];
        }
        return [
          {
            id: chunk.id,
            parent_id: chunk.parent_id,
            child_text: chunk.child_text,
            embedding_text: chunk.embedding_text,
            metadata: chunk.metadata,
            chunk_index: chunk.chunk_index,
            similarity: dotProduct(queryVector, chunk.embedding),
            source_id: source.id,
            revision_id: revision.id,
            approved_content_hash: revision.approved_content_hash,
            logical_experience_id: chunk.metadata.logical_experience_id,
            logical_parent_id: chunk.metadata.logical_parent_id,
            logical_chunk_id: chunk.metadata.logical_chunk_id,
            parent_source_document_id: parent.source_document_id,
            parent_source_file_name: parent.source_file_name,
            parent_source_file_type: parent.source_file_type,
            parent_text: parent.parent_text,
            parent_metadata: parent.metadata,
            parent_created_at: parent.created_at,
            parent_updated_at: parent.updated_at,
          },
        ];
      })
      .filter((row) => row.similarity >= Number(args.match_threshold))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, matchCount);

    return { data: rows, error: null };
  }
}

function quote(snapshot: ExtractionSnapshot, text: string) {
  const block = snapshot.blocks.find((candidate) => candidate.text.includes(text));
  assert.ok(block, `expected source quote: ${text}`);
  return { block_id: block.block_id, quote: text };
}

function docxProposal(snapshot: ExtractionSnapshot): StructuredExperienceModelProposal {
  return {
    schema_version: "1",
    warnings: [],
    experiences: [
      {
        type: "project",
        title: { value: "Project Atlas", source_refs: [quote(snapshot, "Project Atlas")] },
        organization: { value: null, source_refs: [] },
        role: { value: "API integration lead", source_refs: [quote(snapshot, "I led the API integration")] },
        period: {
          start: { value: null, source_refs: [] },
          end: { value: null, source_refs: [] },
          precision: "unknown",
        },
        technologies: { value: ["API"], source_refs: [quote(snapshot, "API")] },
        context_refs: [quote(snapshot, "Project Atlas delivered a source-grounded review workflow.")],
        evidence_items: [
          {
            kind: "contribution",
            summary: "Led the API integration.",
            source_refs: [quote(snapshot, "I led the API integration")],
            attribution: "individual",
            activity_status: "completed",
          },
          {
            kind: "outcome",
            summary: "Reviewers approved the indexed release.",
            source_refs: [quote(snapshot, "reviewers approved the indexed release")],
            attribution: "team",
            activity_status: "completed",
          },
        ],
      },
      {
        type: "project",
        title: { value: "Project Beacon", source_refs: [quote(snapshot, "Project Beacon")] },
        organization: { value: null, source_refs: [] },
        role: { value: "retry dashboard builder", source_refs: [quote(snapshot, "I built the retry dashboard")] },
        period: {
          start: { value: null, source_refs: [] },
          end: { value: null, source_refs: [] },
          precision: "unknown",
        },
        technologies: { value: ["retry dashboard"], source_refs: [quote(snapshot, "retry dashboard")] },
        context_refs: [quote(snapshot, "Project Beacon reduced onboarding review time by about 30 percent for the team.")],
        evidence_items: [
          {
            kind: "outcome",
            summary: "Reduced onboarding review time by about 30 percent for the team.",
            source_refs: [quote(snapshot, "about 30 percent for the team")],
            attribution: "team",
            activity_status: "completed",
          },
          {
            kind: "contribution",
            summary: "Built the retry dashboard.",
            source_refs: [quote(snapshot, "I built the retry dashboard")],
            attribution: "individual",
            activity_status: "completed",
          },
          {
            kind: "responsibility",
            summary: "Next rollout remains planned.",
            source_refs: [quote(snapshot, "next rollout remains planned")],
            attribution: "team",
            activity_status: "planned",
          },
        ],
      },
    ],
  };
}

function pdfProposal(snapshot: ExtractionSnapshot): StructuredExperienceModelProposal {
  return {
    schema_version: "1",
    warnings: [],
    experiences: [
      {
        type: "general-experience",
        title: { value: "Generic PDF extraction", source_refs: [quote(snapshot, "Generic PDF extraction")] },
        organization: { value: null, source_refs: [] },
        role: { value: null, source_refs: [] },
        period: {
          start: { value: null, source_refs: [] },
          end: { value: null, source_refs: [] },
          precision: "unknown",
        },
        technologies: { value: [], source_refs: [] },
        context_refs: [quote(snapshot, "Generic PDF extraction works.")],
        evidence_items: [
          {
            kind: "outcome",
            summary: "Generic PDF extraction works.",
            source_refs: [quote(snapshot, "Generic PDF extraction works.")],
            attribution: "unspecified",
            activity_status: "completed",
          },
          {
            kind: "responsibility",
            summary: "Second PDF line remains selectable.",
            source_refs: [quote(snapshot, "Second PDF line.")],
            attribution: "unspecified",
            activity_status: "completed",
          },
        ],
      },
    ],
  };
}

async function parseWithDeterministicProposal(input: {
  client: InMemoryExperienceClient;
  sourceId: string;
  revisionId: string;
  proposal: (snapshot: ExtractionSnapshot) => StructuredExperienceModelProposal;
}) {
  const lease = await input.client.rpc("acquire_experience_source_execution", {
    p_source_id: input.sourceId,
    p_stage: "parsing",
    p_lease_seconds: 180,
  });
  assert.ifError(lease.error);
  const source = input.client.sources.get(input.sourceId);
  assert.ok(source);
  const extraction = [...input.client.extractions.values()]
    .filter((row) => row.source_id === input.sourceId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
  assert.ok(extraction);
  const snapshot = snapshotFromExperienceExtractionRow(extraction, {
    sourceId: source.id,
    originalFileName: source.original_file_name,
    originalFileType: source.original_file_type,
    byteSha256: source.original_byte_sha256,
  });
  const proposal = input.proposal(snapshot);
  const generated = await generateValidatedStructuredExperienceDraft(
    {
      snapshot,
      revisionId: input.revisionId,
      model: "gemini-acceptance-test",
      promptVersion: EXPERIENCE_STRUCTURED_PROMPT_VERSION,
      timeoutMs: 10000,
    },
    {
      models: {
        generateContent: async () => ({
          text: JSON.stringify(proposal),
          candidates: [{ finishReason: "STOP" }],
        }),
      },
    },
  );

  await persistExperienceDraft(
    {
      sourceId: input.sourceId,
      executionToken: String((lease.data as { execution_token: string }).execution_token),
      snapshot,
      draft: generated.draft,
      generation: generated.generation,
      repairAttempted: generated.repairAttempted,
    },
    input.client as unknown as ExperienceDraftPersistenceClient,
  );
  return { snapshot, draft: generated.draft };
}

async function runAcceptanceFlow(input: {
  client: InMemoryExperienceClient;
  file: File;
  revisionId: string;
  proposal: (snapshot: ExtractionSnapshot) => StructuredExperienceModelProposal;
}) {
  const originalBytes = Buffer.from(await input.file.arrayBuffer());
  const upload = await uploadExperienceSourceFromFile(input.file, input.client as unknown as ExperienceServiceClient);
  assert.equal(upload.source.byte_sha256, sha256(originalBytes));
  assert.equal("file_url" in upload.source, false);
  assert.equal(upload.next_action, "extract");

  const extractionResult = await extractExperienceSource(
    upload.source.id,
    input.client as unknown as ExperienceServiceClient,
  );
  assert.equal(extractionResult.status, "extracted");
  assert.equal(extractionResult.next_action, "parse");

  const privateFile = await getExperienceSourceFile(upload.source.id, input.client as unknown as ExperienceServiceClient);
  assert.equal(privateFile.bytes.equals(originalBytes), true);
  assert.equal(privateFile.file_size, originalBytes.length);

  const parsed = await parseWithDeterministicProposal({
    client: input.client,
    sourceId: upload.source.id,
    revisionId: input.revisionId,
    proposal: input.proposal,
  });
  const reviewedDraft = parseCanonicalExperienceRevision({
    ...parsed.draft,
    review_acknowledgements: {
      warnings: true,
      unassigned_blocks: true,
    },
  });
  const saved = await saveExperienceDraft(
    upload.source.id,
    {
      revision_id: input.revisionId,
      expected_draft_version: 1,
      draft: reviewedDraft,
    },
    input.client as unknown as ExperienceServiceClient,
  );
  assert.equal(saved.draft_version, 2);

  const approved = await approveExperienceRevision(
    upload.source.id,
    {
      revision_id: input.revisionId,
      expected_draft_version: 2,
    },
    input.client as unknown as ExperienceServiceClient,
  );
  assert.equal(approved.status, "approved");
  assert.equal(approved.next_action, "index");

  let indexed = await indexExperienceRevision(
    upload.source.id,
    { revision_id: input.revisionId },
    input.client as unknown as ExperienceServiceClient,
    { embed: async (text) => vectorForText(text), batchSize: 3, maxDurationMs: 10000 },
  );
  while (indexed.status !== "indexed") {
    indexed = await indexExperienceRevision(
      upload.source.id,
      { revision_id: input.revisionId },
      input.client as unknown as ExperienceServiceClient,
      { embed: async (text) => vectorForText(text), batchSize: 3, maxDurationMs: 10000 },
    );
  }

  const revisionRow = input.client.revisions.get(input.revisionId);
  assert.ok(revisionRow?.approved_json);
  const approvedRevision = parseCanonicalExperienceRevision(revisionRow.approved_json);
  assert.equal(approvedRevision.revision.status, "approved");
  assert.equal(approvedRevision.revision.approved_content_hash, hashCanonicalRevisionContent(approvedRevision));
  assert.equal(input.client.sources.get(upload.source.id)?.active_revision_id, input.revisionId);

  const exported = await getExperienceRevisionExport(
    upload.source.id,
    input.revisionId,
    input.client as unknown as ExperienceServiceClient,
  );
  assert.equal(exported.content_hash, hashCanonicalRevisionContent(approvedRevision));
  assert.ok(exported.resolved_source_refs.length > 0);

  return {
    sourceId: upload.source.id,
    revisionId: input.revisionId,
    snapshot: parsed.snapshot,
    approvedRevision,
    indexed,
    exported,
  };
}

describe("cross-workflow acceptance", () => {
  it("runs DOCX and selectable-PDF upload through approval, indexing, export, private file access, and approved search", async () => {
    const client = new InMemoryExperienceClient();
    const docx = await runAcceptanceFlow({
      client,
      file: structuredDocxFile(),
      revisionId: "revision-acceptance-docx",
      proposal: docxProposal,
    });
    const pdf = await runAcceptanceFlow({
      client,
      file: genericPdfFile(),
      revisionId: "revision-acceptance-pdf",
      proposal: pdfProposal,
    });

    const docxPlan = freezeApprovedExperienceIndexPlan({
      snapshot: docx.snapshot,
      revision: docx.approvedRevision,
    });
    assert.equal(docx.approvedRevision.experiences.length, 2);
    assert.equal(docxPlan.expected_parent_count, 2);
    assert.equal(docxPlan.expected_child_count, 5);
    assert.equal(new Set(docx.approvedRevision.experiences.map((experience) => experience.logical_id)).size, 2);
    assert.ok(docx.approvedRevision.experiences.every((experience) => experience.logical_id));
    assert.ok(
      docx.approvedRevision.experiences.every((experience) =>
        experience.evidence_items.every((item) => item.logical_id),
      ),
    );

    const atlasParent = docxPlan.parent_plan.parents.find((parent) => /Atlas/.test(parent.parent_text));
    const beaconParent = docxPlan.parent_plan.parents.find((parent) => /Beacon/.test(parent.parent_text));
    assert.ok(atlasParent);
    assert.ok(beaconParent);
    assert.match(atlasParent.parent_text, /Project Atlas/);
    assert.doesNotMatch(atlasParent.parent_text, /Project Beacon/);
    assert.match(beaconParent.parent_text, /Project Beacon/);
    assert.doesNotMatch(beaconParent.parent_text, /Project Atlas/);

    for (const child of docxPlan.child_plan.children) {
      assert.equal(assertSpanInSnapshot(docx.snapshot, child.source_span), child.child_text);
      assert.equal(child.source_span.text, child.child_text);
      assert.ok(child.embedding_text.endsWith(child.child_text));
    }

    const beaconResults = await searchApprovedExperienceEvidence("I built the retry dashboard", {
      client,
      sourceIds: [docx.sourceId],
      matchCount: 1,
      embed: async (query) => vectorForText(query),
    });
    assert.equal(beaconResults.length, 1);
    assert.equal(beaconResults[0].source_id, docx.sourceId);
    assert.equal(beaconResults[0].revision_id, docx.revisionId);
    assert.match(beaconResults[0].child_text, /retry dashboard/);
    assert.match(beaconResults[0].parent.parent_text, /Project Beacon/);
    assert.equal(
      beaconResults[0].logical_chunk_id,
      docxPlan.child_plan.children.find((child) => /retry dashboard/.test(child.child_text))?.logical_chunk_id,
    );

    const pdfResults = await searchApprovedExperienceEvidence("Generic PDF extraction", {
      client,
      sourceIds: [pdf.sourceId],
      matchCount: 1,
      embed: async (query) => vectorForText(query),
    });
    assert.equal(pdfResults.length, 1);
    assert.equal(pdfResults[0].source_id, pdf.sourceId);
    assert.equal(pdfResults[0].revision_id, pdf.revisionId);
    assert.match(pdfResults[0].child_text, /Generic PDF extraction works/);
    assert.ok(pdf.exported.source_blocks.some((block) => /Generic PDF extraction works/.test(block.text)));
  });
});
