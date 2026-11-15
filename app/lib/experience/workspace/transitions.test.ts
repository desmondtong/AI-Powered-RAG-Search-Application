import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectTransitions, transitionText, type StatusSnapshot, type TrackedSource } from "./transitions";

const a = (status: string): TrackedSource => ({ id: "a", file_name: "lumen.docx", status });
const b = (status: string): TrackedSource => ({ id: "b", file_name: "basalt.docx", status });

function run(steps: TrackedSource[][]) {
  let snapshot: StatusSnapshot = new Map();
  const raised: string[][] = [];
  for (const list of steps) {
    const result = detectTransitions(snapshot, list);
    snapshot = result.snapshot;
    raised.push(result.events.map(transitionText));
  }
  return raised;
}

describe("stage transitions", () => {
  it("raises nothing for sources seen for the first time", () => {
    assert.deepEqual(run([[a("draft"), b("indexed")]]), [[]]);
  });

  it("raises nothing when a refresh returns the same statuses", () => {
    assert.deepEqual(run([[a("parsing")], [a("parsing")], [a("parsing")]]), [[], [], []]);
  });

  it("raises ready-for-review once when processing finishes", () => {
    assert.deepEqual(run([[a("parsing")], [a("draft")], [a("draft")]]), [[], ["lumen.docx is ready for review."], []]);
  });

  it("treats a poll that skipped parsing as the same transition", () => {
    assert.deepEqual(run([[a("extracting")], [a("draft")]]), [[], ["lumen.docx is ready for review."]]);
  });

  it("raises searchable once when indexing finishes", () => {
    assert.deepEqual(run([[b("indexing")], [b("indexed")], [b("indexed")]]), [[], ["basalt.docx is searchable."], []]);
  });

  it("ignores changes that are not one of the two transitions", () => {
    assert.deepEqual(run([[a("draft")], [a("approved")], [a("indexing")]]), [[], [], []]);
    assert.deepEqual(run([[a("parsing")], [a("failed")]]), [[], []]);
  });

  it("raises nothing for a source that disappears, and forgets it", () => {
    assert.deepEqual(run([[a("parsing"), b("indexing")], [b("indexing")], [a("draft"), b("indexed")]]), [[], [], ["basalt.docx is searchable."]]);
  });
});
