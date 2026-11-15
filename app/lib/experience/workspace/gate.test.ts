import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blockLabels, buildApprovalGate, targetForPath, unassignedBlocks } from "./gate";
import type { CanonicalRevision, EvidenceItem, ExperienceEntry, SourceBlock, SourceDetail, SourceSpan } from "./types";

const BLOCKS: SourceBlock[] = [
  { block_id: "blk-c", order: 2, text: "Gamma block." },
  { block_id: "blk-a", order: 0, text: "Alpha block." },
  { block_id: "blk-b", order: 1, text: "Beta block." },
];

function sbs(value: string | null = null, refs: SourceSpan[] = []) {
  return { value, source_refs: refs };
}

function evidence(refs: SourceSpan[]): EvidenceItem {
  return { kind: "contribution", summary: "Did a thing", source_refs: refs, attribution: "individual", activity_status: "completed" };
}

function experience(items: EvidenceItem[], titleRefs: SourceSpan[] = []): ExperienceEntry {
  return {
    type: "project",
    title: sbs("Atlas", titleRefs),
    organization: sbs(),
    role: sbs(),
    period: { start: sbs(), end: sbs(), precision: "unknown" },
    technologies: { value: [], source_refs: [] },
    context_refs: [],
    evidence_items: items,
  };
}

function draft(experiences: ExperienceEntry[], acks = { warnings: false, unassigned_blocks: false }): CanonicalRevision {
  return {
    schema_version: "1",
    source: { source_id: "s", original_file_name: "f.docx", original_file_type: "docx", byte_sha256: "h" },
    extraction: { extraction_snapshot_id: "x", text_sha256: "t", parser_version: "p", normalization_version: "n" },
    revision: { revision_id: "r", status: "draft", draft_version: 1, approved_content_hash: null, model_version: null, prompt_version: null },
    experiences,
    review_acknowledgements: acks,
  };
}

function detail(warnings: string[] = []): Pick<SourceDetail, "latest_extraction" | "latest_revision" | "source"> {
  return {
    source: { id: "s", file_name: "f.docx", status: "draft", latest_approved_version_number: 2 },
    latest_extraction: { id: "x", blocks: BLOCKS, warnings },
    latest_revision: null,
  };
}

const ALL_BLOCKS: SourceSpan[] = [
  { block_id: "blk-a", start: 0, end: 5 },
  { block_id: "blk-b", start: 0, end: 4 },
  { block_id: "blk-c", start: 0, end: 5 },
];

describe("approval gate", () => {
  it("labels blocks by document order and computes unassigned blocks from every field", () => {
    assert.deepEqual([...blockLabels(BLOCKS)], [["blk-a", "b1"], ["blk-b", "b2"], ["blk-c", "b3"]]);
    const d = draft([experience([evidence([ALL_BLOCKS[0]])], [ALL_BLOCKS[2]])]);
    assert.deepEqual(unassignedBlocks(d, BLOCKS), ["blk-b"]);
  });

  it("is clear and offers Approve when nothing needs attention and nothing is dirty", () => {
    const gate = buildApprovalGate(draft([experience([evidence(ALL_BLOCKS)])]), detail(), [], false);
    assert.deepEqual(gate.items, []);
    assert.equal(gate.remaining, 0);
    assert.deepEqual(gate.button, { state: "approve", label: "Approve" });
    assert.equal(gate.footer, "Approving freezes version 3. Indexing is a separate step you start yourself.");
  });

  it("offers Save & approve when clear but dirty", () => {
    const gate = buildApprovalGate(draft([experience([evidence(ALL_BLOCKS)])]), detail(), [], true);
    assert.deepEqual(gate.button, { state: "save-and-approve", label: "Save & approve" });
  });

  it("shows the warnings acknowledgement only when there are warnings", () => {
    const clean = buildApprovalGate(draft([experience([evidence(ALL_BLOCKS)])]), detail(), [], false);
    assert.ok(!clean.items.some((item) => item.kind === "ack-warnings"));
    const warned = buildApprovalGate(draft([experience([evidence(ALL_BLOCKS)])]), detail(["w1", "w2"]), [], false);
    const item = warned.items.find((entry) => entry.kind === "ack-warnings");
    assert.equal(item?.label, "I've read the 2 extraction warnings");
    assert.equal(item?.checkbox, true);
    assert.equal(warned.button.label, "Approve · 1 item left");
    const acked = buildApprovalGate(draft([experience([evidence(ALL_BLOCKS)])], { warnings: true, unassigned_blocks: false }), detail(["w1", "w2"]), [], false);
    assert.equal(acked.remaining, 0);
  });

  it("shows the unassigned acknowledgement only when blocks are unassigned, listing their b-labels", () => {
    const gate = buildApprovalGate(draft([experience([evidence([ALL_BLOCKS[1]])])]), detail(), [], false);
    const item = gate.items.find((entry) => entry.kind === "ack-unassigned");
    assert.equal(item?.label, "I've checked the 2 unassigned blocks (b1, b3) and they don't belong in any experience");
    assert.deepEqual(item?.targets, [{ kind: "block", blockId: "blk-a" }, { kind: "block", blockId: "blk-c" }]);
  });

  it("counts evidence items that still need a span and links to each", () => {
    const gate = buildApprovalGate(
      draft([experience([evidence(ALL_BLOCKS), evidence([])]), experience([evidence([])])], { warnings: true, unassigned_blocks: true }),
      detail(["w"]),
      [],
      true,
    );
    const item = gate.items.find((entry) => entry.kind === "missing-spans");
    assert.equal(item?.label, "2 evidence items still need a source span");
    assert.deepEqual(item?.targets, [
      { kind: "evidence", experienceIndex: 0, evidenceIndex: 1 },
      { kind: "evidence", experienceIndex: 1, evidenceIndex: 0 },
    ]);
    assert.equal(gate.button.state, "locked");
    assert.equal(gate.button.label, "Approve · 2 items left");
  });

  it("matches the spec example: one unchecked acknowledgement and two missing spans read three items", () => {
    const gate = buildApprovalGate(draft([experience([evidence(ALL_BLOCKS), evidence([]), evidence([])])]), detail(["w"]), [], false);
    assert.equal(gate.remaining, 3);
    assert.equal(gate.button.label, "Approve · 3 items left");
    assert.equal(gate.items.find((item) => item.kind === "missing-spans")?.label, "2 evidence items still need a source span");
  });

  it("flags zero evidence as nothing to index", () => {
    const gate = buildApprovalGate(draft([experience([], ALL_BLOCKS)]), detail(), [], false);
    assert.ok(gate.items.some((item) => item.kind === "no-evidence"));
    assert.equal(gate.button.state, "locked");
  });

  it("adds one item per server field error, skipping ones the gate already covers", () => {
    const gate = buildApprovalGate(draft([experience([evidence(ALL_BLOCKS)])]), detail(), [
      { path: "experiences.0.evidence_items.0.summary", code: "unsupported-claim", message: "Summary is not supported by its span." },
      { path: "review_acknowledgements.warnings", code: "warnings-unacknowledged", message: "Ack warnings." },
      { path: "experiences", code: "no-usable-evidence", message: "No evidence." },
    ], false);
    const errors = gate.items.filter((item) => item.kind === "field-error");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].label, "Summary is not supported by its span.");
    assert.deepEqual(errors[0].target, { kind: "evidence", experienceIndex: 0, evidenceIndex: 0 });
    assert.equal(gate.button.label, "Approve · 1 item left");
  });

  it("turns stale-version errors into a reload prompt", () => {
    const gate = buildApprovalGate(draft([experience([evidence(ALL_BLOCKS)])]), detail(), [
      { path: "revision", code: "approval-version-conflict", message: "Version changed." },
    ], false);
    assert.equal(gate.items[0].stale, true);
    assert.deepEqual(gate.items[0].target, { kind: "reload" });
    assert.match(gate.items[0].label, /Reload the current draft/);
  });

  it("maps server paths to cards", () => {
    assert.deepEqual(targetForPath("experiences.2.title.value"), { kind: "experience", experienceIndex: 2 });
    assert.deepEqual(targetForPath("other"), { kind: "none" });
  });
});
