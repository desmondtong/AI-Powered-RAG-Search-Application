import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blockNumbers,
  evidenceErrors,
  evidenceHighlights,
  evidenceSpanKey,
  evidenceTargets,
  experienceErrors,
  firstBlockNumber,
  spanExcerpt,
} from "./review";
import type { CanonicalRevision, EvidenceItem, ExperienceEntry, SourceSpan } from "./types";

function item(summary: string, refs: SourceSpan[], kind: EvidenceItem["kind"] = "contribution"): EvidenceItem {
  return { kind, summary, source_refs: refs, attribution: "individual", activity_status: "completed" };
}

function experience(title: string | null, items: EvidenceItem[], type: ExperienceEntry["type"] = "project"): ExperienceEntry {
  const empty = { value: null, source_refs: [] };
  return {
    type,
    title: { value: title, source_refs: [] },
    organization: empty,
    role: empty,
    period: { start: empty, end: empty, precision: "unknown" },
    technologies: { value: [], source_refs: [] },
    context_refs: [],
    evidence_items: items,
  };
}

function draft(experiences: ExperienceEntry[]): CanonicalRevision {
  return {
    schema_version: "1",
    source: { source_id: "s", original_file_name: "f.docx", original_file_type: "docx", byte_sha256: "h" },
    extraction: { extraction_snapshot_id: "x", text_sha256: "t", parser_version: "p", normalization_version: "n" },
    revision: { revision_id: "r", status: "draft", draft_version: 1, approved_content_hash: null, model_version: null, prompt_version: null },
    experiences,
    review_acknowledgements: { warnings: false, unassigned_blocks: false },
  };
}

const sample = draft([
  experience("Atlas", [item("Led migration", [{ block_id: "b-2", start: 0, end: 4 }, { block_id: "b-3", start: 1, end: 3 }]), item("Cut costs", [])]),
  experience(null, [item("Mentored", [{ block_id: "b-2", start: 5, end: 9 }], "responsibility")], "general-experience"),
]);

describe("review presentation helpers", () => {
  it("groups every evidence span by block with stable keys", () => {
    const highlights = evidenceHighlights(sample);
    assert.deepEqual(highlights.get("b-2"), [
      { key: evidenceSpanKey(0, 0, 0), start: 0, end: 4 },
      { key: evidenceSpanKey(1, 0, 0), start: 5, end: 9 },
    ]);
    assert.deepEqual(highlights.get("b-3"), [{ key: "ev:0:0:1", start: 1, end: 3 }]);
    assert.equal(evidenceHighlights(null).size, 0);
  });

  it("numbers blocks by document order and captions the first referenced block", () => {
    const numbers = blockNumbers([
      { block_id: "b-3", order: 2, text: "c" },
      { block_id: "b-1", order: 0, text: "a" },
      { block_id: "b-2", order: 1, text: "b" },
    ]);
    assert.equal(numbers.get("b-1"), 1);
    assert.equal(numbers.get("b-3"), 3);
    assert.equal(firstBlockNumber([{ block_id: "gone", start: 0, end: 1 }, { block_id: "b-2", start: 0, end: 1 }], numbers), 2);
    assert.equal(firstBlockNumber([], numbers), null);
  });

  it("lists popover targets with unspanned items first", () => {
    const targets = evidenceTargets(sample);
    assert.deepEqual(
      targets.map((target) => [target.experienceIndex, target.evidenceIndex, target.hasSpan]),
      [
        [0, 1, false],
        [0, 0, true],
        [1, 0, true],
      ],
    );
    assert.equal(targets[0].label, "Atlas · contribution · Cut costs · (no span)");
    assert.equal(targets[2].label, "General experience · responsibility · Mentored");
    assert.deepEqual(evidenceTargets(null), []);
  });

  it("routes server field errors to the matching card", () => {
    const errors = [
      { path: "experiences.0.title", code: "x", message: "title" },
      { path: "experiences.0.evidence_items.1.source_refs", code: "y", message: "span" },
      { path: "experiences.10.title", code: "z", message: "other" },
    ];
    assert.deepEqual(experienceErrors(errors, 0).map((error) => error.message), ["title"]);
    assert.deepEqual(evidenceErrors(errors, 0, 1).map((error) => error.message), ["span"]);
    assert.deepEqual(evidenceErrors(errors, 0, 0), []);
    assert.deepEqual(experienceErrors(errors, 1), []);
  });

  it("excerpts span text for chips", () => {
    assert.equal(spanExcerpt("Hello   wide\nworld", { block_id: "b", start: 0, end: 18 }), "Hello wide world");
    assert.equal(spanExcerpt("abcdefghij", { block_id: "b", start: 0, end: 10 }, 5), "abcd…");
    assert.equal(spanExcerpt(undefined, { block_id: "b", start: 0, end: 1 }), "");
  });
});
