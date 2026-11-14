import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FixtureScriptedModelClient,
  OFFLINE_CLOCK_MS,
  RagEvalConfigurationError,
  createOfflineDependencies,
  deterministicEnvironment,
  recordingSearch,
} from "./adapters";
import { identityKey, sameRevision } from "./anchors";
import { buildOfflineCorpusIndex } from "./corpusIndex";
import { loadRagEvalFixtures } from "./fixtures";
import { runRagEval } from "./runner";

describe("rag-eval offline adapters", () => {
  it("records every search call with a copy of its options and the hits returned", async () => {
    const index = buildOfflineCorpusIndex(loadRagEvalFixtures());
    const corpus = index.fixtures.find((entry) => entry.fixture.fixture_id === "distractor-heavy")!;
    const deps = createOfflineDependencies(corpus, index.revisions.get(identityKey(corpus.active))!.export);
    const recorder = recordingSearch(deps.search);
    const options = { matchCount: 8, matchThreshold: -1 };
    const hits = await recorder.search("WCAG accessibility audits", options);
    options.matchCount = 99;
    await recorder.search("unscripted query", { matchCount: 8, matchThreshold: -1 });

    assert.equal(recorder.calls.length, 2);
    assert.deepEqual(recorder.calls[0].options, { matchCount: 8, matchThreshold: -1 });
    assert.equal(recorder.calls[0].hits, hits);
    assert.equal(hits.length, 2);
    assert.ok(hits.every((hit) => sameRevision(hit, corpus.active)), "scripted hits carry the active revision identity");
    assert.deepEqual(recorder.calls[1].hits, [], "an unscripted query returns no hits");
  });

  it("uses a fixed clock and a scripted model that maps cited passages to the handles JD-fit assigned", async () => {
    const index = buildOfflineCorpusIndex(loadRagEvalFixtures());
    const corpus = index.fixtures.find((entry) => entry.fixture.fixture_id === "strong-match")!;
    const deps = createOfflineDependencies(corpus, index.revisions.get(identityKey(corpus.active))!.export);
    assert.equal(deps.now(), OFFLINE_CLOCK_MS);
    assert.ok(deps.client instanceof FixtureScriptedModelClient);
    const prompt = [
      "TASK_VERSION: jd-fit-report-v1",
      "BEGIN_EVIDENCE_JSON",
      JSON.stringify([{ handle: "E7", source_file_name: "x", text: "Tuned PostgreSQL queries and added composite indexes" }]),
      "END_EVIDENCE_JSON",
    ].join("\n");
    const response = await deps.client.models.generateContent({ model: "m", contents: prompt, config: {} });
    const assessments = JSON.parse(response.text!).assessments as Array<{ requirement_id: string; evidence_handles: string[] }>;
    assert.deepEqual(assessments.find((entry) => entry.requirement_id === "R2")!.evidence_handles, ["E7"]);
    assert.deepEqual(assessments.find((entry) => entry.requirement_id === "R1")!.evidence_handles, [], "passages not in the prompt are not cited");
    assert.deepEqual(deps.client.calls.map((call) => call.phase), ["report"]);
  });

  it("throws a configuration error instead of constructing a real model, Supabase, or Storage client", async () => {
    for (const factory of [deterministicEnvironment.modelClient, deterministicEnvironment.supabaseClient, deterministicEnvironment.storageClient]) {
      assert.throws(() => factory(), RagEvalConfigurationError);
    }
    const index = buildOfflineCorpusIndex(loadRagEvalFixtures());
    await assert.rejects(
      runRagEval({
        mode: "offline",
        index,
        clock: () => OFFLINE_CLOCK_MS,
        runId: "x",
        dependenciesFor: () => ({ client: undefined as never, search: async () => [] }),
      }),
      RagEvalConfigurationError,
    );
  });
});
