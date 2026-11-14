import { hashFixtureCorpusContent, type RagEvalFixture } from "./fixtureSchema";
import { RAG_EVAL_FIXTURE_SCHEMA_VERSION } from "./versions";
import type { ApprovedExperienceSearchResult } from "../experience/approvedSearch";
import { searchApprovedExperienceEvidence } from "../experience/approvedSearch";
import type { StructuredExperienceExport } from "../experience/contracts";
import type { JdFitSearch } from "../jdFit/retrieval";
import { FixtureScriptedModelClient, offlineHitForPassage } from "./adapters";
import { buildOfflineCorpusIndex } from "./corpusIndex";
import { newManifest, type CorpusManifest } from "./manifest";
import { synthesizeOfflineCorpusEntry } from "./offlineExport";
import type { FixtureCorpus } from "./types";
export const OFFLINE_THRESHOLDS_EXACT = {
  requirement_recall: 1,
  unsupported_requirements: 0,
  retrieval_recall: 1,
  distractor_precision: 1,
  ingestion_coverage: 1,
  citation_validity: 1,
  unsupported_positive_claims: 0,
  gap_visibility: 1,
};

export const LIVE_THRESHOLDS_PERMISSIVE = {
  requirement_recall: 0.6,
  unsupported_requirements: 2,
  retrieval_recall: 0.6,
  distractor_precision: 0.7,
  ingestion_coverage: 0.6,
  citation_validity: 0.6,
  unsupported_positive_claims: 0,
  gap_visibility: 0.6,
};

/** Small valid fixture for unit tests. Returns a fresh object so tests can mutate it. */
export function sampleFixtureInput(): RagEvalFixture {
  return {
    schema_version: RAG_EVAL_FIXTURE_SCHEMA_VERSION,
    fixture_id: "unit-sample",
    title: "Unit sample",
    experience: {
      file_stem: "unit-sample",
      paragraphs: [
        "Harbor Ledger, synthetic billing platform, 2023.",
        "Designed TypeScript REST APIs for invoice reconciliation across four regional ledgers.",
        "Wrote a short internal blog post about TypeScript tips.",
      ],
    },
    jd_text: "Required: design TypeScript REST APIs. Preferred: Kafka streaming.",
    expected_requirements: [
      { id: "ts-apis", text: "Design TypeScript REST APIs", importance: "required", match_any: ["typescript rest", "rest api"] },
      { id: "kafka", text: "Kafka streaming", importance: "preferred", match_any: ["kafka"] },
    ],
    expected_evidence: { "ts-apis": ["Designed TypeScript REST APIs for invoice reconciliation"] },
    expected_gaps: ["kafka"],
    distractors: { "ts-apis": ["blog post about TypeScript tips"] },
    tolerated_requirements: [],
    revision_plan: { kind: "single" },
    thresholds: { offline: { ...OFFLINE_THRESHOLDS_EXACT }, live: { ...LIVE_THRESHOLDS_PERMISSIVE } },
    offline: {
      requirements: [
        { text: "Design TypeScript REST APIs", importance: "required", retrieval_query: "designed TypeScript REST APIs" },
        { text: "Kafka streaming", importance: "preferred", retrieval_query: "Kafka streaming pipelines" },
      ],
      search: {
        "designed TypeScript REST APIs": ["Designed TypeScript REST APIs for invoice reconciliation"],
        "Kafka streaming pipelines": [],
      },
      report: [
        { requirement: 1, fit: "strong", rationale: "E1 shows TypeScript REST API design.", cite: ["Designed TypeScript REST APIs for invoice reconciliation"] },
        { requirement: 2, fit: "missing", rationale: "No evidence of Kafka.", cite: [] },
      ],
    },
  };
}

type Row = Record<string, unknown>;

export interface RecordedClientCall {
  kind: "select" | "insert" | "update" | "upsert" | "delete" | "rpc" | "storage";
  target: string;
  detail?: string;
}

class MockQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private filters: Array<[string, unknown]> = [];
  private maxRows: number | null = null;

  constructor(private readonly rows: Row[]) {}

  select() {
    return this;
  }
  eq(key: string, value: unknown) {
    this.filters.push([key, value]);
    return this;
  }
  is(key: string, value: unknown) {
    this.filters.push([key, value]);
    return this;
  }
  order() {
    return this;
  }
  limit(value: number) {
    this.maxRows = value;
    return this;
  }
  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let rows = this.rows.filter((row) => this.filters.every(([key, value]) => row[key] === value));
    if (this.maxRows !== null) rows = rows.slice(0, this.maxRows);
    return Promise.resolve({ data: rows, error: null as null }).then(onfulfilled, onrejected);
  }
}

/**
 * In-memory Supabase stand-in for read paths (`from(...).select().eq().is().order().limit()`). Every mutation,
 * RPC, and Storage call is recorded and rejected, so tests can assert that read-only code never reaches them.
 */
export class RecordingSupabaseClient {
  readonly calls: RecordedClientCall[] = [];

  constructor(private readonly tables: Record<string, Row[]> = {}) {}

  from(table: string) {
    const record = (kind: RecordedClientCall["kind"]) => {
      this.calls.push({ kind, target: table });
      throw new Error(`Read-only test client: ${kind} on ${table} is not allowed.`);
    };
    return {
      select: () => {
        this.calls.push({ kind: "select", target: table });
        return new MockQuery(this.tables[table] ?? []).select();
      },
      insert: () => record("insert"),
      update: () => record("update"),
      upsert: () => record("upsert"),
      delete: () => record("delete"),
    };
  }

  async rpc(name: string) {
    this.calls.push({ kind: "rpc", target: name });
    throw new Error(`Read-only test client: rpc ${name} is not allowed.`);
  }

  get storage() {
    return {
      from: (bucket: string) => {
        const record = (detail: string) => {
          this.calls.push({ kind: "storage", target: bucket, detail });
          throw new Error(`Read-only test client: storage ${detail} is not allowed.`);
        };
        return {
          upload: () => record("upload"),
          remove: () => record("remove"),
          download: () => record("download"),
          move: () => record("move"),
          copy: () => record("copy"),
        };
      },
    };
  }

  mutations() {
    return this.calls.filter((call) => call.kind !== "select");
  }
}


export const TEST_PROJECT_REF = "abcdefghijklmnopqrst";

function revisionRow(exportDoc: StructuredExperienceExport, status: string) {
  const revision = exportDoc.revision;
  return {
    id: revision.revision.revision_id,
    source_id: revision.source.source_id,
    extraction_id: revision.extraction.extraction_snapshot_id,
    status,
    draft_json: null,
    draft_version: revision.revision.draft_version,
    approved_json: revision,
    approved_content_hash: exportDoc.content_hash,
    model_version: revision.revision.model_version,
    prompt_version: revision.revision.prompt_version,
    parse_error: null,
    created_at: status === "approved" ? "2026-01-02T00:00:00.000Z" : "2026-01-01T00:00:00.000Z",
  };
}

/**
 * A seeded corpus as the remote project would hold it, backed by an in-memory read-only client: source rows,
 * retained extractions, and approved revision rows built from synthesized exports, plus the matching manifest.
 */
export function liveCorpusHarness(fixtures: RagEvalFixture[]) {
  const sources: Row[] = [];
  const revisions: Row[] = [];
  const extractions: Row[] = [];
  const manifest: CorpusManifest = newManifest(TEST_PROJECT_REF, "2026-01-01T00:00:00.000Z");
  for (const fixture of fixtures) {
    const entry = synthesizeOfflineCorpusEntry(fixture);
    const active = entry.active;
    const latest = entry.latest_unindexed;
    const source = active.revision.source;
    sources.push({
      id: source.source_id,
      original_byte_sha256: source.byte_sha256,
      original_file_name: source.original_file_name,
      original_file_type: source.original_file_type,
      original_file_size: 1000,
      status: latest ? "approved" : "indexed",
      latest_extraction_id: active.revision.extraction.extraction_snapshot_id,
      latest_draft_revision_id: (latest ?? active).revision.revision.revision_id,
      latest_approved_revision_id: (latest ?? active).revision.revision.revision_id,
      active_revision_id: active.revision.revision.revision_id,
      deleted_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    revisions.push(revisionRow(active, "indexed"));
    if (latest) revisions.push(revisionRow(latest, "approved"));
    extractions.push({
      id: active.revision.extraction.extraction_snapshot_id,
      source_id: source.source_id,
      text_sha256: active.revision.extraction.text_sha256,
      parser_version: active.revision.extraction.parser_version,
      normalization_version: active.revision.extraction.normalization_version,
      blocks: active.source_blocks,
      warnings: [],
      created_at: "2026-01-01T00:00:00.000Z",
    });
    manifest.fixtures.push({
      fixture_id: fixture.fixture_id,
      fixture_hash: hashFixtureCorpusContent(fixture),
      file_name: entry.file_name,
      source_id: source.source_id,
      revisions: [
        { revision_id: active.revision.revision.revision_id, approved_content_hash: active.content_hash, role: "active", active: true, indexed: true },
        ...(latest ? [{ revision_id: latest.revision.revision.revision_id, approved_content_hash: latest.content_hash, role: "latest-unindexed" as const, active: false, indexed: false }] : []),
      ],
    });
  }
  const client = new RecordingSupabaseClient({ experience_sources: sources, experience_revisions: revisions, experience_extractions: extractions });
  return { client, manifest, sources, revisions };
}

/**
 * Per-fixture scripted dependencies that still go through the real approved-search helper: the RPC client answers
 * `match_approved_experience_chunks` with the scripted hits for the query and records every RPC name.
 */
export function scriptedLiveDependencies(fixtures: RagEvalFixture[]) {
  const index = buildOfflineCorpusIndex(fixtures);
  const rpcCalls: string[] = [];
  const dependenciesFor = (corpus: FixtureCorpus) => {
    const offlineCorpus = index.bySource.get(corpus.source_id)!;
    const activeExport = [...index.revisions.values()].find((revision) => revision.fixture_id === corpus.fixture.fixture_id && revision.role === "active")!.export;
    const hitsFor = (query: string): ApprovedExperienceSearchResult[] =>
      (corpus.fixture.offline.search[query] ?? []).map((passage) => offlineHitForPassage(offlineCorpus, activeExport, passage));
    const search: JdFitSearch = (query, options) =>
      searchApprovedExperienceEvidence(query, {
        ...options,
        embed: async () => Array.from({ length: 1536 }, () => 0.01),
        client: {
          rpc: async (name: string) => {
            rpcCalls.push(name);
            return {
              data: hitsFor(query).map((hit) => ({
                ...hit,
                parent_source_document_id: hit.parent.source_document_id,
                parent_source_file_name: hit.parent.source_file_name,
                parent_source_file_type: hit.parent.source_file_type,
                parent_text: hit.parent.parent_text,
                parent_metadata: hit.parent.metadata,
                parent_created_at: hit.parent.created_at,
                parent_updated_at: hit.parent.updated_at,
              })),
              error: null,
            };
          },
        },
      });
    return { client: new FixtureScriptedModelClient(corpus.fixture.offline), search };
  };
  return { dependenciesFor, rpcCalls };
}
