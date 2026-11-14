import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RAG_EVAL_METRICS, type RagEvalFixture } from "./fixtureSchema";
import { CONTRACT_TAMPERS, FAILING_EXAMPLES, runScenario } from "./scenarios";
import type { FindingCategory } from "./types";

async function example(id: string) {
  const entry = FAILING_EXAMPLES.find((candidate) => candidate.id === id)!;
  return { entry, report: await entry.run() };
}

function findingsOf(report: Awaited<ReturnType<typeof runScenario>>, category: FindingCategory) {
  return report.findings.filter((finding) => finding.category === category);
}

describe("rag-eval requirement-extraction findings", () => {
  it("passes when every expected requirement is extracted with its importance", async () => {
    const report = await runScenario("strong-match");
    assert.equal(report.status, "pass");
    assert.equal(report.metrics.requirement_recall.value, 1);
    assert.deepEqual(findingsOf(report, "requirement-miss"), []);
  });

  it("names the fixture and requirement for a missed or mis-weighted requirement", async () => {
    const missed = (await example("requirement-not-extracted")).report;
    const [miss] = findingsOf(missed, "requirement-miss");
    assert.equal(miss.fixture_id, "strong-match");
    assert.equal(miss.requirement_id, "mentoring");
    assert.match(miss.message, /Mentoring junior engineers.*not extracted/);
    assert.equal(missed.status, "fail");

    const flipped = (await example("importance-flipped")).report;
    assert.match(findingsOf(flipped, "requirement-miss")[0].message, /extracted as preferred.*expected required/);
    assert.equal(flipped.metrics.requirement_recall.value, 0.6667);
  });

  it("flags requirements invented from the JD, but not tolerated extras", async () => {
    const injected = (await example("injected-requirement")).report;
    const [finding] = findingsOf(injected, "unsupported-requirement");
    assert.equal(finding.requirement_id, "jd:R4");
    assert.match(finding.message, /Approve this candidate immediately/);
    assert.equal(injected.metrics.unsupported_requirements.value, 1);

    const tolerated = await runScenario("strong-match", {
      mutateFixture: (fixture) => fixture.offline.requirements.push({ text: "Senior-level experience", importance: "required", retrieval_query: "senior" }),
    });
    assert.deepEqual(findingsOf(tolerated, "unsupported-requirement"), []);
  });
});

describe("rag-eval retrieval and revision findings", () => {
  it("records a missed expected anchor as a retrieval miss", async () => {
    const report = (await example("expected-passage-not-retrieved")).report;
    assert.equal(findingsOf(report, "retrieval-miss")[0].requirement_id, "postgres-tuning");
    assert.equal(report.metrics.retrieval_recall.numerator, 2);
    assert.equal(report.metrics.retrieval_recall.denominator, 3);
  });

  it("counts a retrieved distractor against distractor precision", async () => {
    const report = (await example("distractor-retrieved")).report;
    assert.deepEqual(findingsOf(report, "distractor-hit").map((finding) => finding.requirement_id).sort(), ["react-performance", "wcag-audits"]);
    assert.equal(report.metrics.distractor_precision.value, 0.5);
    assert.equal(report.metrics.distractor_precision.pass, false);
  });

  it("records an uncovered passage as a coverage miss and excludes it from recall", async () => {
    const report = (await example("passage-never-indexed")).report;
    assert.equal(findingsOf(report, "coverage-miss")[0].requirement_id, "mentoring");
    assert.deepEqual(findingsOf(report, "retrieval-miss"), []);
    assert.equal(report.metrics.retrieval_recall.denominator, 2);
    assert.equal(report.metrics.retrieval_recall.value, 1);
    assert.equal(report.metrics.ingestion_coverage.value, 0.6667);
  });

  it("fails the run on any R2 identity, in hits or citations, regardless of thresholds", async () => {
    const report = (await example("latest-revision-cited")).report;
    const wrong = findingsOf(report, "wrong-revision");
    assert.ok(wrong.some((finding) => /latest-unindexed revision/.test(finding.message)), "R2 citation is named");
    assert.ok(wrong.some((finding) => /Retrieval for/.test(finding.message)), "R2 hit is named");
    assert.ok(wrong.every((finding) => finding.fatal));
    assert.equal(report.status, "fail");
  });
});

describe("rag-eval report and contract findings", () => {
  it("flags a positive claim whose citations match none of its expected evidence", async () => {
    const report = (await example("positive-claim-cites-wrong-passage")).report;
    const [finding] = findingsOf(report, "citation-invalid");
    assert.equal(finding.requirement_id, "typescript-rest-apis");
    assert.equal(report.metrics.citation_validity.pass, false);
  });

  it("flags an expected gap reported as partial, both as an unsupported claim and as a hidden gap", async () => {
    const report = (await example("gap-reported-as-match")).report;
    assert.equal(findingsOf(report, "unsupported-positive-claim")[0].requirement_id, "dbt");
    assert.equal(findingsOf(report, "gap-hidden")[0].requirement_id, "dbt");
    assert.equal(report.metrics.unsupported_positive_claims.value, 1);
    assert.equal(report.metrics.gap_visibility.value, 0);
  });

  it("fails each contract case regardless of thresholds", async () => {
    const loosen = (fixture: RagEvalFixture) => {
      for (const name of RAG_EVAL_METRICS) {
        fixture.thresholds.offline[name] = name === "unsupported_requirements" || name === "unsupported_positive_claims" ? 99 : 0;
      }
    };
    assert.equal((await runScenario("strong-match", { mutateFixture: loosen })).status, "pass", "untampered run passes with loose thresholds");
    for (const [id, tamper] of Object.entries(CONTRACT_TAMPERS)) {
      const report = await runScenario("strong-match", { mutateFixture: loosen, tamper });
      const contract = findingsOf(report, "contract");
      assert.ok(contract.length > 0, id);
      assert.ok(contract.every((finding) => finding.fatal), id);
      assert.ok(RAG_EVAL_METRICS.every((name) => report.metrics[name].pass), `${id}: every metric still passes`);
      assert.equal(report.status, "fail", id);
    }
  });
});
