import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePassageAnchor } from "../anchors";
import { parseRagEvalFixture } from "../fixtureSchema";
import { synthesizeOfflineCorpusEntry } from "../offlineExport";
import { RAG_EVAL_FIXTURE_INPUTS, loadRagEvalFixtures } from "./index";

const REQUIRED_SCENARIOS = ["strong-match", "partial-match", "missing-evidence", "prompt-injection", "distractor-heavy", "active-vs-latest"];

/** Patterns that would indicate real personal or internal data slipped into a fixture. */
const REDACTION_PATTERNS: Array<[string, RegExp]> = [
  ["email address", /[\w.+-]+@[\w-]+\.[\w.]+/],
  ["phone number", /\+?\d[\d\s().-]{8,}\d/],
  ["URL", /https?:\/\/|www\./i],
  ["internal marker", /\b(confidential|internal only|do not distribute)\b/i],
];

describe("rag-eval synthetic fixtures", () => {
  it("covers every required scenario and validates as a set", () => {
    const fixtures = loadRagEvalFixtures();
    assert.deepEqual(fixtures.map((fixture) => fixture.fixture_id).sort(), [...REQUIRED_SCENARIOS].sort());
    assert.equal(fixtures.filter((fixture) => fixture.revision_plan.kind === "active-r1-latest-r2-unindexed").length, 1);
  });

  it("states expected gaps and distractors explicitly in every fixture", () => {
    for (const input of RAG_EVAL_FIXTURE_INPUTS) {
      assert.ok(Array.isArray(input.expected_gaps), `${input.fixture_id} must state expected_gaps`);
      assert.ok(input.distractors && typeof input.distractors === "object", `${input.fixture_id} must state distractors`);
    }
    const fixtures = loadRagEvalFixtures();
    assert.ok(fixtures.some((fixture) => fixture.expected_gaps.length > 0));
    assert.ok(fixtures.some((fixture) => Object.values(fixture.distractors).flat().length > 0));
  });

  it("contains only synthetic text", () => {
    for (const fixture of loadRagEvalFixtures()) {
      assert.match(fixture.title, /\(synthetic\)/, `${fixture.fixture_id} title must mark it synthetic`);
      assert.match(fixture.experience.paragraphs[0], /synthetic project/, `${fixture.fixture_id} must declare the project synthetic`);
      assert.match(fixture.experience.paragraphs[0], /fictional/, `${fixture.fixture_id} must name a fictional organization`);
      const text = [fixture.title, fixture.jd_text, ...fixture.experience.paragraphs].join("\n");
      for (const [label, pattern] of REDACTION_PATTERNS) {
        assert.doesNotMatch(text, pattern, `${fixture.fixture_id} contains a ${label}`);
      }
    }
  });

  it("keeps fixture topics disjoint, because live search spans the whole seeded corpus", () => {
    const fixtures = loadRagEvalFixtures();
    for (const fixture of fixtures) {
      const others = fixtures.filter((other) => other.fixture_id !== fixture.fixture_id).map((other) => other.experience.paragraphs.join(" ").toLowerCase());
      for (const requirement of fixture.expected_requirements) {
        for (const phrase of requirement.match_any) {
          for (const otherText of others) {
            assert.equal(otherText.includes(phrase.toLowerCase()), false, `${fixture.fixture_id}/${requirement.id} phrase "${phrase}" appears in another fixture's experience`);
          }
        }
      }
    }
  });

  it("resolves every expected and distractor passage against the active and latest revisions", () => {
    for (const fixture of loadRagEvalFixtures()) {
      const entry = synthesizeOfflineCorpusEntry(fixture);
      const passages = [...Object.values(fixture.expected_evidence).flat(), ...Object.values(fixture.distractors).flat()];
      for (const exportDoc of [entry.active, entry.latest_unindexed].filter((value) => value !== null)) {
        for (const passage of passages) {
          const anchor = resolvePassageAnchor(exportDoc, { passage });
          assert.equal(anchor.revision_id, exportDoc.revision.revision.revision_id);
          assert.equal(anchor.covered, true);
        }
      }
    }
  });

  it("re-validates each committed input independently", () => {
    for (const input of RAG_EVAL_FIXTURE_INPUTS) {
      assert.doesNotThrow(() => parseRagEvalFixture(structuredClone(input)), input.fixture_id);
    }
  });
});
