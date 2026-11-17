import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ACTION_LABELS, EXPLANATIONS, HOW_IT_WORKS, NOTICES, STAGE_COPY, indexedPill } from "./copy";
import { toStageView } from "./stage";
import type { CanonicalRevision, SourceDetail, SourceSummary } from "./types";

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";

/** Sentences end in . ! or ? followed by a space and a capital letter, or the end of the text. */
function sentenceCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/(?<=[.!?])\s+(?=[A-Z])/).length;
}

function source(status: string, overrides: Partial<SourceSummary> = {}): SourceSummary {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    file_name: "experience-2026.docx",
    status,
    actions: ["extract", "parse", "review", "index", "retry"],
    created_at: "2026-11-14T09:00:00+00:00",
    updated_at: "2026-11-14T10:00:00+00:00",
    ...overrides,
  };
}

function detailFor(summary: SourceSummary, draftVersion = 1): SourceDetail {
  const draft = {
    revision: { revision_id: R2, status: "draft", draft_version: draftVersion },
    experiences: [{ evidence_items: [{}, {}] }, { evidence_items: [{}] }],
    review_acknowledgements: { warnings: false, unassigned_blocks: false },
  } as unknown as CanonicalRevision;
  return {
    source: summary,
    latest_extraction: { id: "x", blocks: [], warnings: ["w1"] },
    latest_revision: {
      id: R2,
      status: "draft",
      draft_version: draftVersion,
      draft_json: { canonical_revision: draft, omitted_block_coverage: { totalBlocks: 4, referencedBlocks: 3, unreferencedBlocks: ["b4"] } },
    },
    approved_versions: [{ revision_id: R1, version_number: 3, approved_at: "2026-11-14T09:30:00+00:00" }],
  };
}

const INDEXED = { active_revision_id: R1, latest_approved_revision_id: R1, active_version_number: 3, latest_approved_version_number: 3 };

/** Every state the stage mapping knows, as both a list row (no detail) and the file page (with detail). */
const CASES: Array<[string, SourceSummary, number?]> = [
  ["uploaded", source("uploaded")],
  ["extracting", source("extracting")],
  ["extracted", source("extracted")],
  ["parsing", source("parsing")],
  ["draft (new)", source("draft", { latest_draft_revision_id: R2 })],
  ["draft (started)", source("draft", { latest_draft_revision_id: R2 }), 4],
  ["draft over an indexed version", source("draft", { ...INDEXED, latest_draft_revision_id: R2 })],
  ["approved", source("approved", { latest_approved_revision_id: R1, latest_approved_version_number: 3 })],
  ["indexing", source("indexing", { latest_approved_revision_id: R1, latest_approved_version_number: 3 })],
  ["indexed", source("indexed", INDEXED)],
  ["failed", source("failed", { failure: { stage: "parsing", message: "The model returned no projects.", recoverable_action: "retry-parse" } })],
  ["cleanup-pending", source("cleanup-pending", { cleanup_error: { message: "Storage is busy." } })],
  ["unknown", source("mystery")],
];

function* views() {
  for (const [name, summary, draftVersion] of CASES) {
    yield { name: `${name} row`, view: toStageView(summary) };
    yield { name: `${name} page`, view: toStageView(summary, detailFor(summary, draftVersion)) };
  }
}

describe("copy classes", () => {
  it("every stage helper is at most one sentence", () => {
    for (const { name, view } of views()) {
      assert.ok(sentenceCount(view.helper) <= 1, `${name}: "${view.helper}"`);
    }
  });

  it("no stage helper or label contains an explanation", () => {
    for (const { name, view } of views()) {
      for (const explanation of EXPLANATIONS) {
        assert.ok(!view.helper.includes(explanation), `${name} helper explains: "${explanation}"`);
        assert.ok(!view.label.includes(explanation), `${name} label explains: "${explanation}"`);
      }
    }
  });

  it("no helper repeats the version number its label already names", () => {
    for (const { name, view } of views()) {
      for (const [, number] of view.label.matchAll(/version (\d+)/gi)) {
        assert.doesNotMatch(view.helper, new RegExp(`version ${number}\\b`, "i"), `${name}: "${view.label}" / "${view.helper}"`);
      }
    }
  });

  it("the meta-line fact never repeats the label's version", () => {
    for (const { name, view } of views()) {
      if (!view.metaFact) continue;
      assert.doesNotMatch(view.metaFact, /version \d+/i, name);
    }
  });

  it("How it works gives each of the six stages exactly one sentence", () => {
    assert.equal(HOW_IT_WORKS.length, 6);
    for (const stage of HOW_IT_WORKS) {
      assert.equal(sentenceCount(stage.description), 1, stage.name);
    }
  });

  it("stage copy keeps instructions and facts apart", () => {
    const entries = [
      STAGE_COPY.uploaded,
      STAGE_COPY.extracting,
      STAGE_COPY.extracted,
      STAGE_COPY.parsing,
      STAGE_COPY.draftNew("Draft for version 1", null),
      STAGE_COPY.draftNew("Draft for version 1", { experiences: 1, evidence: 2, warnings: 0, unassigned: 0 }),
      STAGE_COPY.draftStarted("Draft for version 1"),
      STAGE_COPY.indexedWithDraft(1),
      STAGE_COPY.approved(1),
      STAGE_COPY.indexing(1),
      STAGE_COPY.indexed(1, null),
      STAGE_COPY.indexed(1, { experiences: 1, evidence: 2, since: "Nov 14, 2026" }),
      STAGE_COPY.cleanupPending,
      STAGE_COPY.unavailable,
    ];
    for (const entry of entries) {
      const helpers = [("instruction" in entry && entry.instruction) || null, ("fact" in entry && entry.fact) || null].filter(Boolean);
      assert.ok(helpers.length <= 1, `${entry.label} has both an instruction and a fact`);
    }
  });

  it("drops the warning and unassigned clause when there is nothing to check", () => {
    assert.equal(
      STAGE_COPY.draftNew("Draft for version 1", { experiences: 1, evidence: 1, warnings: 0, unassigned: 0 }).fact,
      "We found 1 experience and 1 evidence item.",
    );
  });

  it("keeps Try a job description on the searchable notice only, never as a stage action", () => {
    assert.ok(!(Object.values(ACTION_LABELS) as string[]).includes("Try a job description"));
    assert.ok(!("try-jd" in ACTION_LABELS));
    assert.equal(NOTICES.tryJd, "Try a job description");
    assert.equal(ACTION_LABELS["start-processing"], "Start processing");
    assert.equal(ACTION_LABELS["continue-processing"], "Continue processing");
  });

  it("the top-bar pill does not restate that indexed files are searchable", () => {
    assert.equal(indexedPill(2), "2 files indexed");
    assert.equal(indexedPill(1), "1 file indexed");
    assert.equal(indexedPill(0), "No files indexed");
  });
});
