import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function readExperienceReadme() {
  return readFileSync(join(process.cwd(), "app/lib/experience/README.md"), "utf8");
}

describe("experience API contract documentation", () => {
  it("documents experience endpoints, recoverable errors, and generic route separation", () => {
    const readme = readExperienceReadme();
    for (const route of [
      "POST /api/experiences",
      "GET /api/experiences",
      "GET /api/experiences/[id]",
      "POST /api/experiences/[id]/extract",
      "POST /api/experiences/[id]/parse",
      "PATCH /api/experiences/[id]/draft",
      "POST /api/experiences/[id]/approve",
      "POST /api/experiences/[id]/draft-from-approved",
      "GET /api/experiences/[id]/revisions/[revisionId]/export",
      "GET /api/experiences/[id]/file",
    ]) {
      assert.match(readme, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    for (const errorCode of [
      "draft-validation-failed",
      "draft-version-conflict",
      "approval-version-conflict",
      "approval-candidate-stale",
      "revision-export-unavailable",
      "source-file-unavailable",
      "cross-origin-rejected",
    ]) {
      assert.match(readme, new RegExp(errorCode));
    }

    assert.match(readme, /\/api\/upload/);
    assert.match(readme, /\/api\/documents/);
    assert.match(readme, /\/api\/search/);
    assert.match(readme, /remain generic/);
  });
});
