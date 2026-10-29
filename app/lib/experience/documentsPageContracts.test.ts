import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function readDocumentsPage() {
  return readFileSync(join(process.cwd(), "app/documents/page.tsx"), "utf8");
}

describe("documents page upload contracts", () => {
  it("keeps generic documents and experience sources in separate UI sections and APIs", () => {
    const page = readDocumentsPage();

    assert.match(page, /Generic Documents/);
    assert.match(page, /Experience/);
    assert.match(page, /fetch\("\/api\/documents"\)/);
    assert.match(page, /fetch\("\/api\/experiences"\)/);
    assert.match(page, /kind="experience"/);
    assert.match(page, /onUploadSuccess=\{fetchDocuments\}/);
    assert.match(page, /onUploadSuccess=\{fetchExperienceSources\}/);
  });

  it("preserves generic document preview, download, and delete routes", () => {
    const page = readDocumentsPage();

    assert.match(page, /\/api\/documents\?id=\$\{doc\.id\}&file=true&view=true/);
    assert.match(page, /\/api\/documents\?id=\$\{doc\.id\}&file=true/);
    assert.match(page, /fetch\(`\/api\/documents\?id=\$\{id\}`,\s*\{ method: "DELETE" \}\)/);
  });
});
