import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countIndexed } from "./summary";

describe("workspace summary", () => {
  it("counts zero when nothing is indexed", () => {
    assert.equal(countIndexed([]), 0);
    assert.equal(countIndexed([{ active_revision_id: null }, { active_revision_id: null }]), 0);
  });

  it("counts only sources with an active revision in a mixed list", () => {
    assert.equal(
      countIndexed([{ active_revision_id: "r1" }, { active_revision_id: null }, { active_revision_id: "r9" }, { active_revision_id: "" }]),
      2,
    );
  });

  it("treats missing fields and missing lists as not indexed", () => {
    assert.equal(countIndexed([{} as { active_revision_id?: string | null }]), 0);
    assert.equal(countIndexed(undefined), 0);
    assert.equal(countIndexed(null), 0);
  });
});
