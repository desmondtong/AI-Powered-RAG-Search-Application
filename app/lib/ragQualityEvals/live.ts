import { getExperienceRevisionExport, getExperienceSourceDetail, type ExperienceServiceClient } from "../experience/apiService";
import type { StructuredExperienceExport } from "../experience/contracts";
import { getJdFitModelClient, type JdFitModelClient } from "../jdFit/generation";
import { approvedEvidenceSearch, type JdFitSearch } from "../jdFit/retrieval";
import { RagEvalConfigurationError } from "./adapters";
import { buildCorpusIndex, type FixtureCorpusInput } from "./corpusIndex";
import { hashFixtureCorpusContent, type RagEvalFixture } from "./fixtureSchema";
import type { CorpusManifest } from "./manifest";
import type { RagEvalReport } from "./report";
import { runRagEval, type FixtureRunDependencies } from "./runner";
import type { CorpusIndex, FixtureCorpus } from "./types";
import { RAG_EVAL_FIXTURE_SCHEMA_VERSION } from "./versions";

export const SEED_COMMAND = "npm run rag-eval:corpus -- seed";

/** Read-only access live evaluation needs. The default uses the accepted ingestion read functions. */
export interface LiveReadPort {
  getSourceDetail(sourceId: string): Promise<{
    source: { id: string; status: string; active_revision_id: string | null; latest_approved_revision_id: string | null };
    revisions: Array<{ id: string; status: string; approved_content_hash: string | null }>;
  }>;
  getRevisionExport(sourceId: string, revisionId: string): Promise<StructuredExperienceExport>;
}

export function defaultLiveReadPort(client?: ExperienceServiceClient): LiveReadPort {
  return {
    getSourceDetail: async (sourceId) => {
      const detail = await getExperienceSourceDetail(sourceId, client);
      return { source: detail.source, revisions: detail.revisions.map((row) => ({ id: row.id, status: row.status, approved_content_hash: row.approved_content_hash })) };
    },
    getRevisionExport: (sourceId, revisionId) => getExperienceRevisionExport(sourceId, revisionId, client),
  };
}

function stale(message: string): never {
  throw new RagEvalConfigurationError(`Live corpus is missing or stale: ${message} Run \`${SEED_COMMAND}\` (add --replace to reseed over an existing manifest).`);
}

/**
 * Verifies the resident corpus before any model call: the manifest exists, matches the current fixtures and
 * project, every source's active revision is the manifest's and is indexed, and every planned R2 is approved but not
 * indexed. Then resolves ground truth from the retained exports. Reads only.
 */
export async function preflightLiveCorpus(input: {
  manifest: CorpusManifest | null;
  fixtures: RagEvalFixture[];
  projectRef: string;
  port: LiveReadPort;
}): Promise<CorpusIndex> {
  const { manifest, fixtures, port } = input;
  if (!manifest) stale("no corpus manifest was found.");
  if (manifest.project_ref !== input.projectRef) stale(`the manifest was seeded into project ${manifest.project_ref}, not ${input.projectRef}.`);
  if (manifest.fixture_schema_version !== RAG_EVAL_FIXTURE_SCHEMA_VERSION) {
    stale(`the manifest records fixture schema ${manifest.fixture_schema_version}, but the fixtures are ${RAG_EVAL_FIXTURE_SCHEMA_VERSION}.`);
  }
  const seeded = new Map(manifest.fixtures.map((entry) => [entry.fixture_id, entry]));
  const missing = fixtures.filter((fixture) => !seeded.has(fixture.fixture_id)).map((fixture) => fixture.fixture_id);
  const extra = manifest.fixtures.filter((entry) => !fixtures.some((fixture) => fixture.fixture_id === entry.fixture_id)).map((entry) => entry.fixture_id);
  if (missing.length > 0 || extra.length > 0) {
    stale(`fixture set differs from the manifest (not seeded: ${missing.join(", ") || "none"}; no longer defined: ${extra.join(", ") || "none"}).`);
  }

  const inputs: FixtureCorpusInput[] = [];
  for (const fixture of fixtures) {
    const entry = seeded.get(fixture.fixture_id)!;
    if (entry.fixture_hash !== hashFixtureCorpusContent(fixture)) {
      stale(`fixture ${fixture.fixture_id} changed since it was seeded.`);
    }
    const active = entry.revisions.find((revision) => revision.role === "active");
    const latest = entry.revisions.find((revision) => revision.role === "latest-unindexed") ?? null;
    if (!active) stale(`fixture ${fixture.fixture_id} has no active revision in the manifest.`);
    if ((fixture.revision_plan.kind === "active-r1-latest-r2-unindexed") !== Boolean(latest)) {
      stale(`fixture ${fixture.fixture_id} revision plan does not match the seeded revisions.`);
    }

    let detail: Awaited<ReturnType<LiveReadPort["getSourceDetail"]>>;
    try {
      detail = await port.getSourceDetail(entry.source_id);
    } catch (error) {
      stale(`source ${entry.source_id} for ${fixture.fixture_id} could not be read (${error instanceof Error ? error.message : String(error)}).`);
    }
    if (detail.source.active_revision_id !== active.revision_id) {
      stale(`source ${entry.source_id} for ${fixture.fixture_id} is not active on revision ${active.revision_id}.`);
    }
    const activeRow = detail.revisions.find((row) => row.id === active.revision_id);
    if (activeRow?.status !== "indexed") {
      stale(`active revision ${active.revision_id} of ${fixture.fixture_id} is not indexed.`);
    }
    if (latest) {
      const latestRow = detail.revisions.find((row) => row.id === latest.revision_id);
      if (!latestRow || latestRow.status !== "approved" || detail.source.latest_approved_revision_id !== latest.revision_id) {
        stale(`revision ${latest.revision_id} of ${fixture.fixture_id} is no longer the latest approved, unindexed revision.`);
      }
    }

    try {
      const activeExport = await port.getRevisionExport(entry.source_id, active.revision_id);
      const latestExport = latest ? await port.getRevisionExport(entry.source_id, latest.revision_id) : null;
      inputs.push({
        fixture,
        file_name: entry.file_name,
        active: activeExport,
        latest_unindexed: latestExport,
        expected: {
          active: { source_id: entry.source_id, revision_id: active.revision_id, approved_content_hash: active.approved_content_hash },
          latest_unindexed: latest ? { source_id: entry.source_id, revision_id: latest.revision_id, approved_content_hash: latest.approved_content_hash } : null,
        },
      });
    } catch (error) {
      stale(`ground truth for ${fixture.fixture_id} could not be resolved from its retained exports (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
  try {
    return buildCorpusIndex(inputs);
  } catch (error) {
    stale(`ground truth could not be resolved against the seeded revisions (${error instanceof Error ? error.message : String(error)}).`);
  }
}

export interface RunLiveRagEvalInput {
  fixtures: RagEvalFixture[];
  manifest: CorpusManifest | null;
  projectRef: string;
  port?: LiveReadPort;
  /** Defaults to the real JD-fit Gemini client. */
  client?: JdFitModelClient;
  /** Defaults to JD-fit's approved-evidence search. */
  search?: JdFitSearch;
  /** Per-fixture overrides, for tests that drive live mode with scripted dependencies. */
  dependenciesFor?: (corpus: FixtureCorpus) => Partial<FixtureRunDependencies>;
  clock?: () => number;
}

/** Live evaluation over the resident corpus. Real JD-fit by default; reads only. */
export async function runLiveRagEval(input: RunLiveRagEvalInput): Promise<RagEvalReport> {
  const index = await preflightLiveCorpus({ manifest: input.manifest, fixtures: input.fixtures, projectRef: input.projectRef, port: input.port ?? defaultLiveReadPort() });
  const clock = input.clock ?? Date.now;
  const overrides = input.dependenciesFor;
  const client = overrides ? input.client : (input.client ?? getJdFitModelClient());
  const search = input.search ?? approvedEvidenceSearch;
  const startedAt = clock();
  return runRagEval({
    mode: "live",
    index,
    clock,
    runId: `live-${new Date(startedAt).toISOString().replace(/[-:.]/g, "")}`,
    dependenciesFor: (corpus) => {
      const override = overrides?.(corpus) ?? {};
      return { client: override.client ?? client ?? getJdFitModelClient(), search: override.search ?? search, now: override.now, model: override.model };
    },
  });
}
