import type { ApprovedExperienceSearchResult } from "../experience/approvedSearch";
import type { StructuredExperienceExport } from "../experience/contracts";
import type { JdFitModelClient, JdFitModelResponse } from "../jdFit/generation";
import type { JdFitSearch } from "../jdFit/retrieval";
import { jsonResponse, makeHit, scriptedSearch } from "../jdFit/testFixtures";
import { resolvePassageAnchor } from "./anchors";
import type { FixtureCorpus, RecordedSearchCall } from "./types";

/** A run would need something the selected mode does not allow, such as a live client in deterministic mode. */
export class RagEvalConfigurationError extends Error {
  readonly code = "rag-eval-configuration";

  constructor(message: string) {
    super(message);
    this.name = "RagEvalConfigurationError";
  }
}

/** Fixed clock for deterministic runs: JD-fit's deadline never moves and report timestamps never change. */
export const OFFLINE_CLOCK_MS = Date.UTC(2026, 0, 1);
export const OFFLINE_MODEL = "offline-scripted-model";

/**
 * Factories the deterministic mode hands out instead of real clients. Asking for any of them is a configuration
 * error, so a deterministic run can never fall through to Gemini, Supabase, or Storage.
 */
export const deterministicEnvironment = {
  modelClient(): never {
    throw new RagEvalConfigurationError("Deterministic evaluation cannot construct a live model client; inject a scripted client.");
  },
  supabaseClient(): never {
    throw new RagEvalConfigurationError("Deterministic evaluation cannot construct a Supabase client.");
  },
  storageClient(): never {
    throw new RagEvalConfigurationError("Deterministic evaluation cannot construct a Storage client.");
  },
};

/** Wraps any JD-fit search and records every call with a copy of its options and the hits it returned. */
export function recordingSearch(inner: JdFitSearch) {
  const calls: RecordedSearchCall[] = [];
  const search: JdFitSearch = async (query, options) => {
    const call: RecordedSearchCall = { query, options: { ...(options as unknown as Record<string, unknown>) }, hits: [] };
    calls.push(call);
    call.hits = await inner(query, options);
    return call.hits;
  };
  return { search, calls };
}

/** Wraps a model client and counts generate calls, so the runner can prove a rejected request made none. */
export function countingModelClient(inner: JdFitModelClient) {
  let count = 0;
  const client: JdFitModelClient = {
    models: {
      generateContent: (request) => {
        count += 1;
        return inner.models.generateContent(request);
      },
    },
  };
  return {
    client,
    get count() {
      return count;
    },
  };
}

function evidenceHandlesByText(prompt: string) {
  const start = prompt.indexOf("BEGIN_EVIDENCE_JSON\n");
  const end = prompt.indexOf("\nEND_EVIDENCE_JSON");
  if (start < 0 || end < 0) return new Map<string, string>();
  const evidence = JSON.parse(prompt.slice(start + "BEGIN_EVIDENCE_JSON\n".length, end)) as Array<{ handle: string; text: string }>;
  return new Map(evidence.map((item) => [item.text, item.handle]));
}

/**
 * Scripted model for one fixture. Requirement extraction returns the fixture's scripted requirements; the report
 * phase maps each scripted cited passage to the handle JD-fit assigned it in the prompt, so scripts never hard-code
 * handles. Every call is recorded. A repair request gets the same scripted answer.
 */
export class FixtureScriptedModelClient implements JdFitModelClient {
  readonly calls: Array<{ phase: "requirements" | "report"; model: string }> = [];

  constructor(private readonly script: FixtureCorpus["fixture"]["offline"]) {}

  models = {
    generateContent: async (request: { model: string; contents: string; config: Record<string, unknown> }): Promise<JdFitModelResponse> => {
      const phase = request.contents.includes("TASK_VERSION: jd-fit-report") ? "report" : "requirements";
      this.calls.push({ phase, model: request.model });
      if (phase === "requirements") {
        return jsonResponse({ requirements: this.script.requirements });
      }
      const handles = evidenceHandlesByText(request.contents);
      return jsonResponse({
        assessments: this.script.report.map((entry) => ({
          requirement_id: `R${entry.requirement}`,
          fit: entry.fit,
          rationale: entry.rationale,
          evidence_handles: entry.cite.map((passage) => handles.get(passage)).filter((handle): handle is string => Boolean(handle)),
        })),
      });
    },
  };
}

/** Builds an approved-search hit for a fixture passage, anchored to the fixture's active revision export. */
export function offlineHitForPassage(corpus: FixtureCorpus, activeExport: StructuredExperienceExport, passage: string): ApprovedExperienceSearchResult {
  const anchor = resolvePassageAnchor(activeExport, { passage }, corpus.active);
  const experience =
    activeExport.revision.experiences.find((candidate) =>
      candidate.evidence_items.some((item) => item.logical_id && anchor.evidence_logical_ids.includes(item.logical_id)),
    ) ?? activeExport.revision.experiences[0];
  return makeHit({
    chunkRowId: `offline-row-${corpus.fixture.fixture_id}-${anchor.block_id}-${anchor.start}`,
    text: passage,
    sourceId: anchor.source_id,
    revisionId: anchor.revision_id,
    approvedContentHash: anchor.approved_content_hash,
    logicalExperienceId: experience.logical_id ?? "experience",
    evidenceLogicalIds: anchor.evidence_logical_ids,
    blockId: anchor.block_id,
    start: anchor.start,
    fileName: corpus.file_name,
  });
}

export interface OfflineFixtureDependencies {
  client: FixtureScriptedModelClient;
  search: JdFitSearch;
  now: () => number;
  model: string;
}

/**
 * Deterministic dependencies for one fixture: scripted model, scripted search keyed by retrieval query (built on
 * the JD-fit test helpers), a fixed clock, and a fixed model label.
 */
export function createOfflineDependencies(corpus: FixtureCorpus, activeExport: StructuredExperienceExport): OfflineFixtureDependencies {
  const resultsByQuery = Object.fromEntries(
    Object.entries(corpus.fixture.offline.search).map(([query, passages]) => [
      query,
      passages.map((passage) => offlineHitForPassage(corpus, activeExport, passage)),
    ]),
  );
  return {
    client: new FixtureScriptedModelClient(corpus.fixture.offline),
    search: scriptedSearch(resultsByQuery).search,
    now: () => OFFLINE_CLOCK_MS,
    model: OFFLINE_MODEL,
  };
}
