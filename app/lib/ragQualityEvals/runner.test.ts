import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadRagEvalFixtures } from "./fixtures";
import { renderRagEvalMarkdown } from "./report";
import { runOfflineRagEval } from "./runner";

describe("rag-eval deterministic runner", () => {
  it("produces byte-identical reports for identical fixtures and versions", async () => {
    const first = await runOfflineRagEval(loadRagEvalFixtures());
    const second = await runOfflineRagEval(loadRagEvalFixtures());
    const reversed = await runOfflineRagEval(loadRagEvalFixtures().reverse());
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(JSON.stringify(first), JSON.stringify(reversed), "fixture input order does not change the report");
    assert.equal(renderRagEvalMarkdown(first), renderRagEvalMarkdown(second));
  });

  it("runs every fixture in stable fixture-ID order through evaluateJobDescription", async () => {
    const report = await runOfflineRagEval(loadRagEvalFixtures());
    const ids = report.fixtures.map((fixture) => fixture.fixture_id);
    assert.deepEqual(ids, [...ids].sort());
    assert.equal(report.status, "pass");
    assert.ok(report.fixtures.every((fixture) => fixture.jd_fit.status === "evaluated"));
  });

  it("changes the run ID when a fixture changes", async () => {
    const fixtures = loadRagEvalFixtures();
    const base = await runOfflineRagEval(fixtures);
    fixtures[0].thresholds.offline.gap_visibility = 0.9;
    const edited = await runOfflineRagEval(fixtures);
    assert.notEqual(base.run_id, edited.run_id);
  });
});
