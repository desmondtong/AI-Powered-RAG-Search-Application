import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXPERIENCE_EXTRACTION_LIMITS } from "./extractionValidation";
import { runExperienceExtractionPreflight } from "./extractionPreflight";

describe("experience extraction runtime preflight", () => {
  it("checks required extraction runtimes and reports supported limits", async () => {
    const result = await runExperienceExtractionPreflight({ timeoutMs: 5000 });

    assert.equal(result.ok, true);
    assert.deepEqual(result.supportedFormats, ["docx", "doc", "pdf"]);
    assert.deepEqual(result.limits, EXPERIENCE_EXTRACTION_LIMITS);
    assert.equal(result.libreOffice.available, true);
    assert.equal(result.mammoth.available, true);
    assert.equal(result.pdf2json.available, true);
    assert.equal(typeof result.pdftotext.available, "boolean");
  });
});
