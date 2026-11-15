import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { numberApprovedVersions, versionNumberMap } from "./versionNumbers";

describe("approved version numbers", () => {
  it("returns no versions for an empty list", () => {
    assert.deepEqual(numberApprovedVersions([]), []);
  });

  it("numbers a single approval as version 1", () => {
    assert.deepEqual(numberApprovedVersions([{ id: "r1", approved_at: "2026-11-01T10:00:00+00:00" }]), [
      { revision_id: "r1", version_number: 1, approved_at: "2026-11-01T10:00:00+00:00" },
    ]);
  });

  it("orders by approved_at regardless of input order", () => {
    const versions = numberApprovedVersions([
      { id: "r3", approved_at: "2026-11-03T10:00:00+00:00" },
      { id: "r1", approved_at: "2026-11-01T10:00:00+00:00" },
      { id: "r2", approved_at: "2026-11-02T10:00:00+00:00" },
    ]);
    assert.deepEqual(versions.map((v) => [v.revision_id, v.version_number]), [["r1", 1], ["r2", 2], ["r3", 3]]);
  });

  it("breaks approval ties by id", () => {
    const at = "2026-11-01T10:00:00.123456+00:00";
    const versions = numberApprovedVersions([
      { id: "rb", approved_at: at },
      { id: "ra", approved_at: at },
    ]);
    assert.deepEqual(versions.map((v) => v.revision_id), ["ra", "rb"]);
  });

  it("keeps sub-millisecond order ahead of the id tiebreak", () => {
    const versions = numberApprovedVersions([
      { id: "ra", approved_at: "2026-11-01T10:00:00.123900+00:00" },
      { id: "rb", approved_at: "2026-11-01T10:00:00.1231+00:00" },
    ]);
    assert.deepEqual(versions.map((v) => v.revision_id), ["rb", "ra"]);
  });

  it("skips unapproved rows and keeps numbering contiguous", () => {
    const versions = numberApprovedVersions([
      { id: "draft", approved_at: null },
      { id: "r1", approved_at: "2026-11-01T10:00:00+00:00" },
      { id: "abandoned", approved_at: null },
      { id: "r2", approved_at: "2026-11-05T10:00:00+00:00" },
    ]);
    assert.deepEqual(versions.map((v) => [v.revision_id, v.version_number]), [["r1", 1], ["r2", 2]]);
    assert.equal(versionNumberMap(versions).get("draft"), undefined);
  });

  it("is stable when the same rows are re-read in a different order", () => {
    const rows = [
      { id: "r2", approved_at: "2026-11-02T00:00:00+00:00" },
      { id: "r1", approved_at: "2026-11-01T00:00:00+00:00" },
      { id: "r4", approved_at: "2026-11-02T00:00:00+00:00" },
      { id: "r3", approved_at: null },
    ];
    const first = numberApprovedVersions(rows);
    const second = numberApprovedVersions([...rows].reverse());
    assert.deepEqual(first, second);
    assert.deepEqual([...versionNumberMap(first)], [["r1", 1], ["r2", 2], ["r4", 3]]);
  });
});
