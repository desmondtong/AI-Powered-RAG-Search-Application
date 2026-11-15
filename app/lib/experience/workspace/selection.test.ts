import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { offsetsWithin, segmentBlock, spanMatches } from "./selection";

const BLOCK = "Led the migration of billing to Postgres. Cut deploy time by 40%.";

describe("selection offsets", () => {
  it("maps an ASCII selection to exact offsets", () => {
    const selected = "Cut deploy time by 40%.";
    const prefix = BLOCK.indexOf(selected);
    const result = offsetsWithin(BLOCK, prefix, selected);
    assert.deepEqual(result, { ok: true, start: prefix, end: prefix + selected.length, text: selected });
    assert.equal(result.ok && BLOCK.slice(result.start, result.end), selected);
  });

  it("works when the selection starts after text split across highlight nodes", () => {
    // DOM: "Led the " + <mark>"migration of billing"</mark> + " to Postgres." ...; the prefix range's text is the
    // concatenation of every node before the selection, so its length is the block offset.
    const nodes = ["Led the ", "migration of billing", " to Postgres. "];
    const prefixLength = nodes.join("").length;
    const result = offsetsWithin(BLOCK, prefixLength, "Cut deploy");
    assert.equal(result.ok && BLOCK.slice(result.start, result.end), "Cut deploy");
  });

  it("trims leading and trailing whitespace inward", () => {
    const selected = " Cut deploy time ";
    const prefix = BLOCK.indexOf("Cut") - 1;
    const result = offsetsWithin(BLOCK, prefix, selected);
    assert.ok(result.ok);
    assert.equal(result.ok && BLOCK.slice(result.start, result.end), "Cut deploy time");
    assert.equal(result.ok && result.start, BLOCK.indexOf("Cut"));
  });

  it("rejects a selection whose offsets do not reproduce the text", () => {
    assert.deepEqual(offsetsWithin(BLOCK, 3, "Cut deploy"), { ok: false, reason: "mismatch" });
    assert.deepEqual(offsetsWithin(BLOCK, BLOCK.length - 2, "beyond the end"), { ok: false, reason: "mismatch" });
  });

  it("rejects an empty or whitespace-only selection", () => {
    assert.deepEqual(offsetsWithin(BLOCK, 0, ""), { ok: false, reason: "empty" });
    assert.deepEqual(offsetsWithin(BLOCK, 0, "   \n"), { ok: false, reason: "empty" });
  });

  it("counts non-BMP characters in UTF-16 code units, like block.text.slice", () => {
    const text = "Shipped 🚀 launch for 🇸🇬 users.";
    const selected = "launch for 🇸🇬";
    const prefix = text.indexOf(selected);
    const result = offsetsWithin(text, prefix, selected);
    assert.ok(result.ok);
    assert.equal(result.ok && text.slice(result.start, result.end), selected);
    assert.equal(result.ok && result.end - result.start, selected.length);
    assert.ok(selected.length > [...selected].length, "the flag is more than one code unit");
  });
});

describe("block segmentation for highlights", () => {
  it("keeps the concatenated text identical to the block text", () => {
    const segments = segmentBlock(BLOCK, [
      { key: "a", start: 8, end: 28 },
      { key: "b", start: 20, end: 40 },
      { key: "c", start: 42, end: BLOCK.length },
    ]);
    assert.equal(segments.map((segment) => segment.text).join(""), BLOCK);
    const overlap = segments.find((segment) => segment.start === 20);
    assert.deepEqual(overlap?.keys, ["a", "b"]);
    assert.deepEqual(segments[0].keys, []);
  });

  it("clamps out-of-range highlights and ignores empty ones", () => {
    const segments = segmentBlock("short", [{ key: "x", start: 3, end: 99 }, { key: "y", start: 2, end: 2 }]);
    assert.deepEqual(segments.map((segment) => [segment.text, segment.keys]), [["sho", []], ["rt", ["x"]]]);
  });

  it("checks citation spans against the displayed text", () => {
    assert.equal(spanMatches(BLOCK, { block_id: "b", start: 42, end: 65 }, "Cut deploy time by 40%."), true);
    assert.equal(spanMatches(BLOCK, { block_id: "b", start: 0, end: 5 }, "Cut d"), false);
    assert.equal(spanMatches(undefined, { block_id: "b", start: 0, end: 5 }, "Led t"), false);
    assert.equal(spanMatches(BLOCK, { block_id: "b", start: 60, end: 90 }, "x"), false);
  });
});
