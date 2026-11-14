import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RAG_EVAL_METRICS } from "./fixtureSchema";
import { loadRagEvalFixtures } from "./fixtures";
import { runOfflineRagEval } from "./runner";
import { FAILING_EXAMPLES } from "./scenarios";
import { FINDING_CATEGORIES } from "./types";

describe("rag-eval deterministic suite, end to end", () => {
  it("passes over every synthetic fixture and measures every metric somewhere", async () => {
    const report = await runOfflineRagEval(loadRagEvalFixtures());
    assert.equal(report.status, "pass", JSON.stringify(report.failures, null, 2));
    assert.equal(report.fixtures.length, 6);
    for (const name of RAG_EVAL_METRICS) {
      assert.ok(report.fixtures.some((fixture) => fixture.metrics[name].applicable), `${name} is measured by at least one fixture`);
    }
    assert.equal(report.finding_counts.contract, 0);
    assert.equal(report.finding_counts["wrong-revision"], 0);
  });

  it("covers extraction, recall, distractors, citations, unsupported claims, and gaps on the committed fixtures", async () => {
    const report = await runOfflineRagEval(loadRagEvalFixtures());
    const byId = new Map(report.fixtures.map((fixture) => [fixture.fixture_id, fixture]));

    assert.equal(report.aggregates.requirement_recall.value, 1);
    assert.equal(report.aggregates.retrieval_recall.value, 1);
    assert.equal(byId.get("distractor-heavy")!.metrics.distractor_precision.value, 0.5);
    assert.equal(report.aggregates.citation_validity.value, 1);
    assert.equal(report.aggregates.unsupported_positive_claims.value, 0);
    assert.equal(report.aggregates.gap_visibility.value, 1);

    // Prompt injection: the obeyed "strong Rust" claim is downgraded, and Rust stays a visible gap.
    const injection = byId.get("prompt-injection")!;
    const rust = injection.jd_fit.requirements.find((requirement) => requirement.text === "Rust")!;
    assert.deepEqual([rust.fit, rust.downgraded], ["missing", true]);
    assert.ok(injection.jd_fit.gaps.includes(rust.requirement_id));

    // Missing evidence: every requirement is a gap, and nothing positive is claimed.
    const missing = byId.get("missing-evidence")!;
    assert.ok(missing.jd_fit.requirements.every((requirement) => requirement.fit === "weak" || requirement.fit === "missing"));
  });

  it("cites only R1 for the active-vs-latest fixture while R2 is a known, uncited revision", async () => {
    const report = await runOfflineRagEval(loadRagEvalFixtures());
    const fixture = report.fixtures.find((entry) => entry.fixture_id === "active-vs-latest")!;
    assert.ok(fixture.source.latest_unindexed_revision_id);
    assert.ok(fixture.cited_revisions.length > 0);
    for (const revision of fixture.cited_revisions) {
      assert.equal(revision.role, "active");
      assert.equal(revision.revision_id, fixture.source.active_revision_id);
    }
  });

  it("has a failing example for every finding category the scorer emits, contract checks included", () => {
    const covered = new Set(FAILING_EXAMPLES.map((example) => example.category));
    for (const category of FINDING_CATEGORIES.filter((entry) => entry !== "run-error")) {
      assert.ok(covered.has(category), `failing example for ${category}`);
    }
  });
});
