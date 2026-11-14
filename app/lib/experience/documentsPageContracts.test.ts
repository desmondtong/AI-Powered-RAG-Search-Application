import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function readDocumentsPage() {
  return readFileSync(join(process.cwd(), "app/documents/page.tsx"), "utf8");
}

describe("documents page upload contracts", () => {
  it("shows only the Experience section, wired to the experience API and upload modal", () => {
    const page = readDocumentsPage();

    assert.match(page, /Experience/);
    assert.match(page, /fetch\("\/api\/experiences"\)/);
    assert.match(page, /kind="experience"/);
    assert.match(page, /onUploadSuccess=\{fetchExperienceSources\}/);
  });

  it("has no generic document section, route, preview modal, or fetch", () => {
    const page = readDocumentsPage();

    for (const retired of ["Generic Documents", "/api/documents", "PDFViewerModal", "fetchDocuments"]) {
      assert.equal(page.includes(retired), false, `documents page must not reference ${retired}`);
    }
  });
});
