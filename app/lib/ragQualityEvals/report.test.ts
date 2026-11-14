import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExperienceServiceClient } from "../experience/apiService";
import { RAG_EVAL_METRICS } from "./fixtureSchema";
import { loadRagEvalFixtures } from "./fixtures";
import { defaultLiveReadPort, runLiveRagEval } from "./live";
import { OFFLINE_HARNESS_METRICS } from "./metrics";
import { renderRagEvalMarkdown } from "./report";
import { runOfflineRagEval } from "./runner";
import { FAILING_EXAMPLES } from "./scenarios";
import { TEST_PROJECT_REF, liveCorpusHarness, scriptedLiveDependencies } from "./testSupport";
import { RAG_EVAL_FIXTURE_SCHEMA_VERSION, RAG_EVAL_REPORT_SCHEMA_VERSION, RAG_EVAL_RUNNER_VERSION } from "./versions";

describe("rag-eval quality reports", () => {
  it("records mode, versions, diagnostics, cited-revision configuration, findings, aggregates, thresholds, and status", async () => {
    const report = await runOfflineRagEval(loadRagEvalFixtures());
    assert.equal(report.report_schema_version, RAG_EVAL_REPORT_SCHEMA_VERSION);
    assert.equal(report.mode, "offline");
    assert.equal(report.deterministic, true);
    assert.equal(report.live, false);
    assert.equal(report.versions.fixture_schema, RAG_EVAL_FIXTURE_SCHEMA_VERSION);
    assert.equal(report.versions.runner, RAG_EVAL_RUNNER_VERSION);
    assert.deepEqual(Object.keys(report.versions.jd_fit ?? {}), ["model", "requirement_prompt", "report_prompt", "validation"]);
    assert.equal(report.status, "pass");
    assert.deepEqual(Object.keys(report.aggregates), [...RAG_EVAL_METRICS]);

    for (const fixture of report.fixtures) {
      assert.ok(fixture.jd_fit.diagnostics, `${fixture.fixture_id} carries JD-fit diagnostics`);
      assert.match(fixture.fixture_hash, /^sha256:/);
      for (const name of RAG_EVAL_METRICS) {
        assert.equal(typeof fixture.metrics[name].threshold, "number");
        assert.equal(typeof fixture.metrics[name].pass, "boolean");
      }
      assert.ok(Array.isArray(fixture.findings));
      for (const revision of fixture.cited_revisions) {
        assert.equal(revision.role, "active");
        assert.deepEqual(Object.keys(revision.configuration_versions ?? {}).sort(), ["chunking", "embedding", "model", "parser", "prompt", "schema"]);
      }
    }
    assert.ok(report.fixtures.some((fixture) => fixture.cited_revisions.length > 0));
  });

  it("labels offline extraction and retrieval metrics as harness checks, and nothing in live mode", async () => {
    const offline = await runOfflineRagEval(loadRagEvalFixtures());
    assert.match(offline.harness_check_note ?? "", /harness checks over scripted inputs/);
    for (const name of RAG_EVAL_METRICS) {
      assert.equal(offline.aggregates[name].harness_check, OFFLINE_HARNESS_METRICS.has(name), name);
      assert.equal(offline.fixtures[0].metrics[name].harness_check, OFFLINE_HARNESS_METRICS.has(name), name);
    }
    assert.match(renderRagEvalMarkdown(offline), /deterministic/);

    const fixtures = loadRagEvalFixtures();
    const harness = liveCorpusHarness(fixtures);
    const live = await runLiveRagEval({
      fixtures,
      manifest: harness.manifest,
      projectRef: TEST_PROJECT_REF,
      port: defaultLiveReadPort(harness.client as unknown as ExperienceServiceClient),
      dependenciesFor: scriptedLiveDependencies(fixtures).dependenciesFor,
      clock: () => Date.UTC(2026, 0, 1),
    });
    assert.equal(live.live, true);
    assert.equal(live.harness_check_note, null);
    assert.ok(RAG_EVAL_METRICS.every((name) => !live.aggregates[name].harness_check));
    assert.match(renderRagEvalMarkdown(live), /live, non-deterministic evidence/);
  });

  it("names the metric category, fixture, and requirement for each failure, in JSON and Markdown", async () => {
    const example = FAILING_EXAMPLES.find((entry) => entry.id === "passage-never-indexed")!;
    const fixtureReport = await example.run();
    assert.equal(fixtureReport.status, "fail");
    assert.equal(fixtureReport.metrics.ingestion_coverage.pass, false);

    const report = await runOfflineRagEval(
      loadRagEvalFixtures().map((fixture) => {
        if (fixture.fixture_id === "distractor-heavy") fixture.thresholds.offline.distractor_precision = 1;
        return fixture;
      }),
    );
    assert.equal(report.status, "fail");
    const failure = report.failures.find((entry) => entry.category === "distractor_precision")!;
    assert.equal(failure.fixture_id, "distractor-heavy");
    assert.ok(failure.requirement_id);
    const markdown = renderRagEvalMarkdown(report);
    assert.match(markdown, /# RAG quality eval: FAIL/);
    assert.match(markdown, /\*\*distractor_precision\*\* distractor-heavy \/ (wcag-audits|react-performance)/);
  });
});
