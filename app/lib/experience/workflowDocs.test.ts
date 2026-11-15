import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("experience browser workflow documentation", () => {
  it("documents the upload-review-approve-index flow and correction policy", () => {
    const readme = read("app/lib/experience/README.md");

    for (const token of [
      "Browser Workflow And Correction Policy",
      "Project Atlas",
      "Project Beacon",
      "POST /api/experiences",
      "GET /api/experiences/[id]",
      "PATCH /api/experiences/[id]/draft",
      "POST /api/experiences/[id]/approve",
      "POST /api/experiences/[id]/index",
      "Corrections in v1 are source-grounded only",
      "upload a revised source file",
    ]) {
      assert.match(readme, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("keeps documented browser steps wired to the current UI surfaces", () => {
    const readme = read("app/lib/experience/README.md");
    const listPage = read("app/experience/page.tsx");
    const dropZone = read("app/experience/_components/DropZone.tsx");
    const filePage = read("app/experience/[id]/FilePageClient.tsx");
    const copy = read("app/lib/experience/workspace/copy.ts");
    const searchPage = read("app/page.tsx");

    assert.match(listPage, /<DropZone \/>/);
    assert.match(read("app/experience/_components/ExperienceRow.tsx"), /`\/experience\/\$\{source\.id\}`/);
    assert.match(dropZone, /router\.push\(`\/experience\/\$\{sourceId\}`\)/);
    assert.match(filePage, /toStageView\(/);
    assert.match(filePage, /<ApprovalGate/);

    for (const label of [
      "Upload experience file",
      "Start review",
      "Save & approve",
      "Index now",
      "Download original",
      "Inspect accepted JSON",
      "Continue processing",
      "Save draft",
    ]) {
      assert.match(copy, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `copy is missing ${label}`);
      assert.match(readme, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `README is missing ${label}`);
    }
    assert.match(readme, /`\/experience`/);
    assert.match(readme, /`\/experience\/\[id\]`/);
    assert.doesNotMatch(readme.slice(readme.indexOf("## Browser Workflow"), readme.indexOf("## Preflight Checks")), /\/documents|Upload Experience|Edit Approved/);

    assert.match(searchPage, /<JdFitPanel \/>/);
    assert.doesNotMatch(searchPage, /\/api\/experiences/);
  });
});
