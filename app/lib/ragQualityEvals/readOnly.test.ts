import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as apiService from "../experience/apiService";
import * as draftPersistence from "../experience/draftPersistence";
import * as embeddingPreparation from "../experience/embeddingPreparation";
import * as extractionSnapshot from "../experience/extractionSnapshot";
import * as sourceStorage from "../experience/sourceStorage";
import * as evidenceServer from "../evidenceServer";
import * as gemini from "../gemini";
import * as jdFitGeneration from "../jdFit/generation";
import * as jdFitHttp from "../jdFit/http";
import * as supabaseServer from "../supabaseServer";
import { loadRagEvalFixtures } from "./fixtures";
import { defaultLiveReadPort, runLiveRagEval } from "./live";
import { runOfflineRagEval } from "./runner";
import { TEST_PROJECT_REF, liveCorpusHarness, scriptedLiveDependencies } from "./testSupport";

/** Every seam that could write experience, evidence-index, database, or Storage state, or build a live client. */
const SPIED: Array<[string, Record<string, unknown>, string[]]> = [
  [
    "ingestion service",
    apiService as unknown as Record<string, unknown>,
    [
      "uploadExperienceSourceFromFile",
      "extractExperienceSource",
      "parseExperienceSource",
      "saveExperienceDraft",
      "approveExperienceRevision",
      "indexExperienceRevision",
      "createDraftFromApprovedRevision",
      "deleteExperienceSource",
    ],
  ],
  ["source storage", sourceStorage as unknown as Record<string, unknown>, ["reserveExperienceSource", "storeExperienceSourceFile"]],
  ["draft persistence", draftPersistence as unknown as Record<string, unknown>, ["persistExperienceDraft", "recordExperienceParseFailure"]],
  ["embedding preparation", embeddingPreparation as unknown as Record<string, unknown>, ["prepareExperienceEmbeddingBatch"]],
  ["extraction snapshot", extractionSnapshot as unknown as Record<string, unknown>, ["persistExperienceExtractionSnapshot"]],
  ["evidence index", evidenceServer as unknown as Record<string, unknown>, ["insertProjectEvidence", "deleteProjectEvidence"]],
  ["embedding", gemini as unknown as Record<string, unknown>, ["createEmbedding"]],
  ["JD-fit route", jdFitHttp as unknown as Record<string, unknown>, ["handleJdFitRequest"]],
  ["JD-fit live client", jdFitGeneration as unknown as Record<string, unknown>, ["getJdFitModelClient"]],
  ["database and Storage client", supabaseServer as unknown as Record<string, unknown>, ["getSupabaseAdminClient"]],
];

let calls: string[] = [];
const originals: Array<[Record<string, unknown>, string, unknown]> = [];

beforeEach(() => {
  calls = [];
  for (const [seam, target, names] of SPIED) {
    for (const name of names) {
      originals.push([target, name, target[name]]);
      target[name] = () => {
        calls.push(`${seam}: ${name}`);
        throw new Error(`Read-only eval reached ${seam}: ${name}`);
      };
    }
  }
});

afterEach(() => {
  for (const [target, name, original] of originals.splice(0)) target[name] = original;
});

/** Runner-side sources: everything except the corpus commands, their CLI entry, and test support. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "corpus" ? [] : sourceFiles(path);
    const corpusEntry = path.endsWith(join("cli", "corpus.ts"));
    return name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "testSupport.ts" && !corpusEntry ? [path] : [];
  });
}

describe("rag-eval read-only runner", () => {
  it("never reaches a mutation, route, or live-client seam in deterministic mode", async () => {
    const report = await runOfflineRagEval(loadRagEvalFixtures());
    assert.equal(report.status, "pass");
    assert.deepEqual(calls, []);
  });

  it("never reaches a mutation seam in live mode; only exports, source detail, and approved search are read", async () => {
    const fixtures = loadRagEvalFixtures();
    const harness = liveCorpusHarness(fixtures);
    const scripted = scriptedLiveDependencies(fixtures);
    const report = await runLiveRagEval({
      fixtures,
      manifest: harness.manifest,
      projectRef: TEST_PROJECT_REF,
      port: defaultLiveReadPort(harness.client as unknown as apiService.ExperienceServiceClient),
      dependenciesFor: scripted.dependenciesFor,
      clock: () => Date.UTC(2026, 0, 1),
    });
    assert.equal(report.live, true);
    assert.deepEqual(calls, []);
    assert.deepEqual(harness.client.mutations(), [], "no insert, update, upsert, delete, RPC, or Storage call on the database client");
    assert.ok(harness.client.calls.length > 0, "live mode read the retained rows");
    assert.ok(scripted.rpcCalls.length > 0);
    assert.deepEqual([...new Set(scripted.rpcCalls)], ["match_approved_experience_chunks"]);
  });

  it("keeps runner modules free of corpus commands and mutation entry points", () => {
    const root = join(process.cwd(), "app/lib/ragQualityEvals");
    const mutationNames = SPIED.filter(([seam]) => !seam.startsWith("JD-fit live") && !seam.startsWith("database"))
      .flatMap(([, , names]) => names)
      .filter((name) => name !== "createEmbedding");
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      const label = relative(root, file);
      assert.doesNotMatch(text, /from "[./]+\/corpus\//, `${label} must not import the corpus commands`);
      for (const name of mutationNames) {
        assert.equal(new RegExp(`\\b${name}\\b`).test(text), false, `${label} must not reference ${name}`);
      }
    }
  });
});
