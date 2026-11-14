import { createHash } from "node:crypto";
import { canonicalStringify } from "../experience/contracts";
import { JdFitError } from "../jdFit/contracts";
import { evaluateJobDescription } from "../jdFit/evaluate";
import type { JdFitModelClient } from "../jdFit/generation";
import type { JdFitSearch } from "../jdFit/retrieval";
import { OFFLINE_CLOCK_MS, RagEvalConfigurationError, countingModelClient, createOfflineDependencies, recordingSearch } from "./adapters";
import { identityKey } from "./anchors";
import { buildOfflineCorpusIndex } from "./corpusIndex";
import type { RagEvalFixture } from "./fixtureSchema";
import { scoreFixture } from "./metrics";
import { buildRagEvalReport, type FixtureRunResult, type RagEvalReport } from "./report";
import type { CorpusIndex, FixtureCorpus, FixtureObservation, RagEvalMode, SourceSelectionProbe } from "./types";
import { RAG_EVAL_RUNNER_VERSION } from "./versions";

export interface FixtureRunDependencies {
  client: JdFitModelClient;
  search: JdFitSearch;
  now?: () => number;
  model?: string;
}

export interface RunRagEvalInput {
  mode: RagEvalMode;
  index: CorpusIndex;
  /** Supplies JD-fit dependencies per fixture. Offline runs must inject both a client and a search. */
  dependenciesFor: (corpus: FixtureCorpus) => FixtureRunDependencies;
  /** Clock for report timestamps. */
  clock: () => number;
  runId: string;
}

function errorSummary(error: unknown) {
  if (error instanceof JdFitError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: error.name || "Error", message: error.message };
  return { code: "unknown-error", message: String(error) };
}

async function probeSourceSelection(corpus: FixtureCorpus, dependencies: FixtureRunDependencies): Promise<SourceSelectionProbe> {
  const recorder = recordingSearch(dependencies.search);
  const counter = countingModelClient(dependencies.client);
  try {
    await evaluateJobDescription(
      { jdText: corpus.fixture.jd_text, sourceIds: [corpus.source_id] },
      { client: counter.client, search: recorder.search, now: dependencies.now, model: dependencies.model },
    );
    return { rejected: false, error_code: null, search_calls: recorder.calls.length, model_calls: counter.count };
  } catch (error) {
    return {
      rejected: true,
      error_code: error instanceof JdFitError ? error.code : errorSummary(error).code,
      search_calls: recorder.calls.length,
      model_calls: counter.count,
    };
  }
}

/** Runs one fixture through `evaluateJobDescription` with injected, recorded dependencies. Never writes anything. */
export async function observeFixture(corpus: FixtureCorpus, dependencies: FixtureRunDependencies): Promise<FixtureObservation> {
  const probe = await probeSourceSelection(corpus, dependencies);
  const recorder = recordingSearch(dependencies.search);
  try {
    const response = await evaluateJobDescription(
      { jdText: corpus.fixture.jd_text },
      { client: dependencies.client, search: recorder.search, now: dependencies.now, model: dependencies.model },
    );
    return {
      fixture_id: corpus.fixture.fixture_id,
      probe,
      response,
      raw_response: JSON.parse(JSON.stringify(response)),
      error: null,
      search_calls: recorder.calls,
    };
  } catch (error) {
    return { fixture_id: corpus.fixture.fixture_id, probe, response: null, raw_response: null, error: errorSummary(error), search_calls: recorder.calls };
  }
}

/** Runs every fixture in stable (fixture ID) order and returns the report object. */
export async function runRagEval(input: RunRagEvalInput): Promise<RagEvalReport> {
  const startedAt = input.clock();
  const corpora = [...input.index.fixtures].sort((left, right) => left.fixture.fixture_id.localeCompare(right.fixture.fixture_id));
  const results: FixtureRunResult[] = [];
  for (const corpus of corpora) {
    const dependencies = input.dependenciesFor(corpus);
    if (input.mode === "offline" && (!dependencies.client || !dependencies.search)) {
      throw new RagEvalConfigurationError(
        `${corpus.fixture.fixture_id}: deterministic evaluation requires an injected model client and search; it never falls back to live services.`,
      );
    }
    const observation = await observeFixture(corpus, dependencies);
    results.push({ corpus, observation, score: scoreFixture(corpus, input.index, observation, input.mode) });
  }
  return buildRagEvalReport({ mode: input.mode, runId: input.runId, startedAt, finishedAt: input.clock(), index: input.index, results });
}

/** Deterministic run over synthesized exports with scripted model and search. No network, keys, Supabase, or Storage. */
export async function runOfflineRagEval(fixtures: RagEvalFixture[], options: { runId?: string } = {}) {
  const index = buildOfflineCorpusIndex(fixtures);
  return runRagEval({
    mode: "offline",
    index,
    clock: () => OFFLINE_CLOCK_MS,
    runId: options.runId ?? offlineRunId(index),
    dependenciesFor: (corpus) => createOfflineDependencies(corpus, index.revisions.get(identityKey(corpus.active))!.export),
  });
}

/** Offline run ID derives from the runner version and full fixture content, so identical inputs give identical IDs. */
function offlineRunId(index: CorpusIndex) {
  const seed = canonicalStringify({ runner: RAG_EVAL_RUNNER_VERSION, fixtures: [...index.fixtures].sort((left, right) => left.fixture.fixture_id.localeCompare(right.fixture.fixture_id)).map((corpus) => corpus.fixture) });
  return `offline-${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}
