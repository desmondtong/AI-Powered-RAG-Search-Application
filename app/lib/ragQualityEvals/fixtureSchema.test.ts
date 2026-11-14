import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FixtureValidationError,
  hashFixtureCorpusContent,
  parseRagEvalFixture,
  parseRagEvalFixtures,
  type FixtureValidationCode,
} from "./fixtureSchema";
import { sampleFixtureInput } from "./testSupport";

function expectCode(input: unknown, code: FixtureValidationCode) {
  assert.throws(
    () => parseRagEvalFixture(input),
    (error: unknown) => error instanceof FixtureValidationError && error.code === code,
    `expected ${code}`,
  );
}

describe("rag-eval fixture schema", () => {
  it("parses a valid fixture", () => {
    const fixture = parseRagEvalFixture(sampleFixtureInput());
    assert.equal(fixture.fixture_id, "unit-sample");
    assert.equal(fixture.revision_plan.kind, "single");
  });

  it("rejects an unsupported schema version before anything else", () => {
    expectCode({ ...sampleFixtureInput(), schema_version: "rag-eval-fixture-v0" }, "schema-version-unsupported");
    expectCode({ ...sampleFixtureInput(), schema_version: undefined }, "schema-version-unsupported");
    expectCode("not a fixture", "fixture-not-object");
  });

  it("rejects missing or incomplete thresholds", () => {
    const withoutLive = sampleFixtureInput() as unknown as Record<string, unknown>;
    withoutLive.thresholds = { offline: sampleFixtureInput().thresholds.offline };
    expectCode(withoutLive, "missing-thresholds");

    const partial = sampleFixtureInput();
    delete (partial.thresholds.offline as Partial<typeof partial.thresholds.offline>).retrieval_recall;
    expectCode(partial, "missing-thresholds");

    const noThresholds = sampleFixtureInput() as unknown as Record<string, unknown>;
    delete noThresholds.thresholds;
    expectCode(noThresholds, "missing-thresholds");
  });

  it("rejects unknown revision plans", () => {
    expectCode({ ...sampleFixtureInput(), revision_plan: { kind: "r3-unindexed" } }, "unknown-revision-plan");
  });

  it("rejects duplicate fixture IDs across a set and duplicate requirement IDs within a fixture", () => {
    assert.throws(
      () => parseRagEvalFixtures([sampleFixtureInput(), sampleFixtureInput()]),
      (error: unknown) => error instanceof FixtureValidationError && error.code === "duplicate-fixture-id",
    );
    const fixture = sampleFixtureInput();
    fixture.expected_requirements.push({ ...fixture.expected_requirements[0] });
    expectCode(fixture, "duplicate-requirement-id");
  });

  it("rejects passages that are not exact substrings of the experience text", () => {
    const evidence = sampleFixtureInput();
    evidence.expected_evidence["ts-apis"] = ["Designed Typescript REST APIs for invoice reconciliation"];
    expectCode(evidence, "passage-not-in-experience");

    const distractor = sampleFixtureInput();
    distractor.distractors["ts-apis"] = ["a passage that was never written"];
    expectCode(distractor, "passage-not-in-experience");

    const crossing = sampleFixtureInput();
    crossing.expected_evidence["ts-apis"] = ["2023.\n\nDesigned TypeScript"];
    expectCode(crossing, "passage-not-in-experience");

    const scripted = sampleFixtureInput();
    scripted.offline.search["designed TypeScript REST APIs"] = ["invented search result passage"];
    expectCode(scripted, "passage-not-in-experience");
  });

  it("rejects ambiguous, trivial, and double-labeled passages", () => {
    const ambiguous = sampleFixtureInput();
    ambiguous.experience.paragraphs.push("Designed TypeScript REST APIs for invoice reconciliation again.");
    expectCode(ambiguous, "passage-ambiguous");

    const short = sampleFixtureInput();
    short.expected_evidence["ts-apis"] = ["REST"];
    expectCode(short, "passage-too-short");

    const twice = sampleFixtureInput();
    twice.distractors["ts-apis"] = ["Designed TypeScript REST APIs for invoice reconciliation"];
    expectCode(twice, "passage-labeled-twice");
  });

  it("rejects references to unknown requirements and gaps that list evidence", () => {
    const unknown = sampleFixtureInput();
    unknown.expected_gaps = ["graphql"];
    expectCode(unknown, "unknown-requirement-reference");

    const gapWithEvidence = sampleFixtureInput();
    gapWithEvidence.expected_gaps = ["ts-apis"];
    expectCode(gapWithEvidence, "gap-has-expected-evidence");
  });

  it("rejects paragraphs that would not map one-to-one onto source blocks", () => {
    const fixture = sampleFixtureInput();
    fixture.experience.paragraphs[0] = " Harbor Ledger ";
    expectCode(fixture, "paragraph-not-normalized");
  });

  it("rejects offline scripts that point at unscripted requirements, and malformed shapes", () => {
    const fixture = sampleFixtureInput();
    fixture.offline.report.push({ requirement: 9, fit: "weak", rationale: "x", cite: [] });
    expectCode(fixture, "offline-script-invalid");
    expectCode({ ...sampleFixtureInput(), unexpected: true }, "fixture-shape-invalid");
  });

  it("hashes only corpus content, so ground-truth edits do not force a reseed", () => {
    const base = parseRagEvalFixture(sampleFixtureInput());
    const thresholdEdit = parseRagEvalFixture({ ...sampleFixtureInput(), thresholds: { ...base.thresholds, live: { ...base.thresholds.live, retrieval_recall: 0.5 } } });
    const textEdit = sampleFixtureInput();
    textEdit.experience.paragraphs[0] = "Harbor Ledger, synthetic billing platform, 2024.";
    assert.equal(hashFixtureCorpusContent(base), hashFixtureCorpusContent(thresholdEdit));
    assert.notEqual(hashFixtureCorpusContent(base), hashFixtureCorpusContent(parseRagEvalFixture(textEdit)));
  });
});
