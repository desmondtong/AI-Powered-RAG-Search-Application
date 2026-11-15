import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toStageView, type StageView, type StepState } from "./stage";
import type { CanonicalRevision, SourceDetail, SourceSummary } from "./types";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";

const API_ACTIONS: Record<string, string[]> = {
  uploaded: ["extract"],
  extracting: [],
  extracted: ["parse"],
  parsing: [],
  draft: ["review", "parse"],
  approved: ["index"],
  indexing: ["index"],
  indexed: ["review", "parse"],
  failed: ["retry"],
  "cleanup-pending": ["retry"],
};

function source(status: string, overrides: Partial<SourceSummary> = {}): SourceSummary {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    file_name: "experience-2026.docx",
    status,
    actions: API_ACTIONS[status] ?? [],
    updated_at: "2026-11-14T10:00:00+00:00",
    ...overrides,
  };
}

function states(view: StageView): StepState[] {
  return view.steps.map((step) => step.state);
}

function ids(view: StageView) {
  return view.overflow.map((item) => item.id);
}

function draftDetail(summary: SourceSummary, draftVersion = 1): SourceDetail {
  const draft = {
    revision: { revision_id: R2, status: "draft", draft_version: draftVersion },
    experiences: [
      { evidence_items: [{}, {}] },
      { evidence_items: [{}] },
    ],
    review_acknowledgements: { warnings: false, unassigned_blocks: false },
  } as unknown as CanonicalRevision;
  return {
    source: summary,
    latest_extraction: { id: "x", blocks: [], warnings: ["w1", "w2"] },
    latest_revision: {
      id: R2,
      status: "draft",
      draft_version: draftVersion,
      draft_json: { canonical_revision: draft, omitted_block_coverage: { totalBlocks: 9, referencedBlocks: 7, unreferencedBlocks: ["b1", "b7"] } },
    },
    approved_versions: [],
  };
}

/** The file page passes detail; a list row does not. */
function pageDetail(summary: SourceSummary): SourceDetail {
  return { source: summary, approved_versions: [] } as unknown as SourceDetail;
}

describe("stage view mapping", () => {
  it("uploaded: only Upload is done and Continue processing is the primary", () => {
    const view = toStageView(source("uploaded"));
    assert.deepEqual(states(view), ["done", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
    assert.equal(view.primary?.label, "Continue processing");
  });

  it("extracting: Extract is running, nothing to click, and the page helper says the user can leave", () => {
    const summary = source("extracting");
    const view = toStageView(summary, pageDetail(summary));
    assert.deepEqual(states(view), ["done", "running", "upcoming", "upcoming", "upcoming", "upcoming"]);
    assert.equal(view.primary, null);
    assert.equal(view.helper, "You can leave this page.");
  });

  it("extracted: Extract done and Continue processing parses", () => {
    const view = toStageView(source("extracted"));
    assert.deepEqual(states(view), ["done", "done", "upcoming", "upcoming", "upcoming", "upcoming"]);
    assert.equal(view.primary?.id, "continue-processing");
  });

  it("parsing: Parse is running with no primary", () => {
    const summary = source("parsing");
    const view = toStageView(summary, pageDetail(summary));
    assert.deepEqual(states(view), ["done", "done", "running", "upcoming", "upcoming", "upcoming"]);
    assert.equal(view.primary, null);
    assert.match(view.helper, /leave this page/);
  });

  it("list rows carry no helper for running or finished work", () => {
    for (const status of ["extracting", "parsing"]) {
      assert.equal(toStageView(source(status)).helper, "", status);
    }
    const indexed = toStageView(source("indexed", { active_revision_id: R1, latest_approved_revision_id: R1, active_version_number: 1 }));
    assert.equal(indexed.helper, "");
    assert.match(indexed.metaFact ?? "", /^Indexed Nov 1[45], 2026/);
  });

  it("draft: Review is current, Start review is primary and re-parse is only in the overflow", () => {
    const summary = source("draft", { latest_draft_revision_id: R2 });
    const view = toStageView(summary, draftDetail(summary));
    assert.deepEqual(states(view), ["done", "done", "done", "current", "upcoming", "upcoming"]);
    assert.equal(view.primary?.label, "Start review");
    assert.match(view.label, /Draft for version 1/);
    assert.equal(view.helper, "We found 2 experiences and 3 evidence items, with 2 extraction warnings and 2 unassigned blocks to check.");
    assert.ok(ids(view).includes("reparse"));
    assert.notEqual(view.primary?.id, "reparse");
    assert.ok(!ids(view).includes("index-now") && !ids(view).includes("continue-indexing"), "no index actions for a draft");
    assert.doesNotMatch(view.helper, /Step \d of 6/);
  });

  it("draft that was already saved: Continue review", () => {
    const summary = source("draft", { latest_draft_revision_id: R2 });
    assert.equal(toStageView(summary, draftDetail(summary, 3)).primary?.label, "Continue review");
  });

  it("approved: Approve done, Index current and Index now is primary", () => {
    const view = toStageView(source("approved", { latest_approved_revision_id: R1, latest_approved_version_number: 3 }));
    assert.deepEqual(states(view), ["done", "done", "done", "done", "done", "current"]);
    assert.equal(view.primary?.label, "Index now");
    assert.equal(view.label, "Version 3 approved · not indexed");
    assert.equal(view.helper, "Index now to make it searchable in Fit Check.");
    assert.match(view.metaFact ?? "", /^Approved /);
    assert.ok(ids(view).includes("edit-approved"));
    assert.ok(ids(view).includes("inspect-json"));
  });

  it("indexing: Index running and Continue indexing is primary", () => {
    const view = toStageView(source("indexing", { latest_approved_revision_id: R1, latest_approved_version_number: 2 }));
    assert.deepEqual(states(view), ["done", "done", "done", "done", "done", "running"]);
    assert.equal(view.primary?.label, "Continue indexing");
    assert.equal(view.label, "Indexing version 2");
    assert.match(view.helper, /continue indexing to finish/);
  });

  it("indexed: every step done, S6 reads Indexed and Try a job description is primary", () => {
    const view = toStageView(
      source("indexed", { active_revision_id: R1, latest_approved_revision_id: R1, active_version_number: 2, latest_approved_version_number: 2 }),
    );
    assert.deepEqual(states(view), ["done", "done", "done", "done", "done", "done"]);
    assert.equal(view.steps[5].label, "Indexed");
    assert.equal(view.primary?.label, "Try a job description");
    assert.equal(view.label, "Indexed · version 2");
    const edit = view.overflow.find((item) => item.id === "edit-approved");
    assert.equal(edit?.label, "Edit · starts draft for version 3");
  });

  it("indexed file page: one fact with counts and time, and the version only in the label", () => {
    const summary = source("indexed", { active_revision_id: R1, latest_approved_revision_id: R1, active_version_number: 2, latest_approved_version_number: 2 });
    const view = toStageView(summary, draftDetail(summary));
    assert.equal(view.label, "Indexed · version 2");
    assert.match(view.helper, /^2 experiences and 3 evidence items, searchable since Nov 1[45], 2026/);
    assert.doesNotMatch(view.helper, /version/i);
    assert.equal((view.helper.match(/searchable since/g) ?? []).length, 1);
  });

  it("indexed with a newer draft: Review (new draft) is current and the searchable version is named", () => {
    const summary = source("draft", {
      active_revision_id: R1,
      latest_approved_revision_id: R1,
      latest_draft_revision_id: R2,
      active_version_number: 2,
      latest_approved_version_number: 2,
    });
    const view = toStageView(summary, draftDetail(summary, 2));
    assert.deepEqual(states(view), ["done", "done", "done", "current", "upcoming", "upcoming"]);
    assert.equal(view.steps[3].label, "Review (new draft)");
    assert.equal(view.label, "Indexed · version 2 · new draft in review");
    assert.equal(view.helper, "The indexed version stays searchable until the new draft is approved and indexed.");
    assert.equal(view.primary?.label, "Continue review");
    assert.ok(!ids(view).includes("edit-approved"), "an open draft already exists");
  });

  it("failed at extract: Extract failed, Retry extract primary and Upload a different file alongside", () => {
    const view = toStageView(
      source("failed", { failure: { stage: "extracting", code: "x", message: "The PDF has no selectable text.", recoverable_action: "retry-extract" } }),
    );
    assert.deepEqual(states(view), ["done", "failed", "upcoming", "upcoming", "upcoming", "upcoming"]);
    assert.equal(view.primary?.label, "Retry extract");
    assert.equal(view.secondary?.label, "Upload a different file");
    assert.equal(view.helper, "The PDF has no selectable text.");
    assert.equal(view.tone, "failed");
  });

  it("failed at parse and index map to S3 and S6", () => {
    const parse = toStageView(source("failed", { failure: { stage: "parsing", message: "Model failed.", recoverable_action: "retry-parse" } }));
    assert.deepEqual(states(parse), ["done", "done", "failed", "upcoming", "upcoming", "upcoming"]);
    assert.equal(parse.primary?.label, "Retry parse");
    const index = toStageView(source("failed", { failure: { stage: "indexing", message: "Embedding failed.", recoverable_action: "retry-index" } }));
    assert.deepEqual(states(index), ["done", "done", "done", "done", "done", "failed"]);
    assert.equal(index.primary?.label, "Retry indexing");
  });

  it("failed at an unknown stage labels the failure without marking a step", () => {
    const view = toStageView(source("failed", { failure: { stage: "mystery", message: "Odd." } }));
    assert.ok(!states(view).includes("failed"));
    assert.equal(view.helper, "Odd.");
    assert.equal(view.label, "This stage failed");
  });

  it("offers no retry the API does not allow", () => {
    const view = toStageView(source("failed", { actions: [], failure: { stage: "parsing", message: "Model failed." } }));
    assert.equal(view.primary, null);
  });

  it("cleanup-pending: neutral steps and Retry cleanup", () => {
    const view = toStageView(source("cleanup-pending", { cleanup_error: { message: "Storage busy.", recoverable_action: "retry-delete" } }));
    assert.ok(states(view).every((state) => state === "neutral"));
    assert.equal(view.primary?.id, "retry-delete");
    assert.equal(view.helper, "Storage busy.");
    assert.deepEqual(view.overflow, []);
  });

  it("never includes revision IDs in any label, helper or action", () => {
    const summary = source("draft", { active_revision_id: R1, latest_approved_revision_id: R1, latest_draft_revision_id: R2, active_version_number: 1, latest_approved_version_number: 1 });
    for (const status of Object.keys(API_ACTIONS)) {
      const view = toStageView({ ...summary, status, actions: API_ACTIONS[status] }, draftDetail(summary));
      assert.doesNotMatch(JSON.stringify(view), UUID, status);
    }
  });

  it("never offers an index action unless the API allows indexing", () => {
    for (const status of ["uploaded", "extracted", "draft", "indexed"]) {
      const view = toStageView(source(status, { latest_approved_revision_id: R1 }));
      const offered = [view.primary?.id, ...ids(view)];
      assert.ok(!offered.includes("index-now") && !offered.includes("continue-indexing"), status);
    }
  });
});
