import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCiteParam, quoteFromBlocks, resolveCitation } from "./citation";
import type { SourceBlock } from "./types";

const blocks: SourceBlock[] = [
  { block_id: "blk-1", order: 0, text: "Project Atlas" },
  { block_id: "blk-2", order: 1, text: "I led the migration of the billing service to Postgres." },
];

describe("citation links", () => {
  it("parses block, offsets and revision", () => {
    assert.deepEqual(parseCiteParam("blk-2:2:5", "rev-9"), { span: { block_id: "blk-2", start: 2, end: 5 }, revisionId: "rev-9" });
    assert.deepEqual(parseCiteParam("blk-2:0:4", null), { span: { block_id: "blk-2", start: 0, end: 4 }, revisionId: null });
  });

  it("keeps colons inside block IDs", () => {
    assert.deepEqual(parseCiteParam("doc:p:7:1:3")?.span, { block_id: "doc:p:7", start: 1, end: 3 });
  });

  it("rejects malformed or empty ranges", () => {
    for (const value of [null, "", "blk-2", "blk-2:1", ":1:3", "blk-2:a:3", "blk-2:3:3", "blk-2:5:2", "blk-2:-1:2"]) {
      assert.equal(parseCiteParam(value), null, String(value));
    }
  });

  it("highlights when the displayed text at the offsets equals the quote", () => {
    const target = parseCiteParam("blk-2:2:5")!;
    assert.deepEqual(resolveCitation(blocks, target, "led"), { kind: "highlight", span: target.span, quote: "led" });
  });

  it("shows the different-version notice when the text differs", () => {
    const target = parseCiteParam("blk-2:2:5")!;
    assert.deepEqual(resolveCitation(blocks, target, "ran"), { kind: "different-version", quote: "ran" });
  });

  it("shows the notice when the block is absent or the offsets run past the text", () => {
    assert.deepEqual(resolveCitation(blocks, parseCiteParam("blk-7:0:3")!, "Pro"), { kind: "different-version", quote: "Pro" });
    assert.deepEqual(resolveCitation(blocks, parseCiteParam("blk-1:0:99")!, "Project Atlas"), {
      kind: "different-version",
      quote: "Project Atlas",
    });
  });

  it("never highlights without a quote", () => {
    assert.deepEqual(resolveCitation(blocks, parseCiteParam("blk-1:0:7")!, null), { kind: "different-version", quote: null });
  });

  it("reads the quote from the cited revision's own blocks", () => {
    assert.equal(quoteFromBlocks(blocks, { block_id: "blk-1", start: 0, end: 7 }), "Project");
    assert.equal(quoteFromBlocks(blocks, { block_id: "blk-3", start: 0, end: 1 }), null);
    assert.equal(quoteFromBlocks(blocks, { block_id: "blk-1", start: 0, end: 50 }), null);
  });
});
