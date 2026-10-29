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
    const documentsPage = read("app/documents/page.tsx");
    const reviewClient = read("app/experiences/[id]/ExperienceReviewClient.tsx");
    const searchPage = read("app/page.tsx");

    assert.match(documentsPage, /Upload Experience/);
    assert.match(documentsPage, /\/experiences\/\$\{source\.id\}/);
    assert.match(reviewClient, /Extract/);
    assert.match(reviewClient, /Parse/);
    assert.match(reviewClient, /Save Draft/);
    assert.match(reviewClient, /Approve/);
    assert.match(reviewClient, /Index/);
    assert.match(reviewClient, /Inspect Accepted JSON/);
    assert.match(reviewClient, /Download Original/);
    assert.match(searchPage, /fetch\("\/api\/search"/);
    assert.doesNotMatch(searchPage, /\/api\/experiences/);
  });
});
