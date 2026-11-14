import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getDocumentsUploadConfig,
  getDocumentsUploadErrorMessage,
  getDocumentsUploadSuccessMessage,
  isDocumentsUploadSuccess,
} from "./uploadUi";

describe("documents upload UI contracts", () => {
  it("scopes the experience upload action to its API and formats", () => {
    const experience = getDocumentsUploadConfig("experience");

    assert.equal(experience.endpoint, "/api/experiences");
    assert.equal(experience.accept, ".pdf,.docx");
    assert.deepEqual(getDocumentsUploadConfig(), experience);
  });

  it("interprets experience upload responses", () => {
    assert.equal(isDocumentsUploadSuccess("experience", { source: { id: "source-1", file_name: "work.docx" } }), true);
    assert.equal(isDocumentsUploadSuccess("experience", { success: true, fileName: "notes.pdf", chunks: 3 }), false);
    assert.equal(isDocumentsUploadSuccess("experience", { source: { id: "source-1" }, error: "failed" }), false);
    assert.equal(isDocumentsUploadSuccess("experience", null), false);
  });

  it("builds the next-action success message and reads error messages", () => {
    assert.match(
      getDocumentsUploadSuccessMessage(
        "experience",
        { source: { file_name: "work.docx" }, next_action: "extract" },
        "fallback.docx",
      ),
      /Experience "work\.docx" uploaded successfully\. Next action: extract\./,
    );
    assert.match(getDocumentsUploadSuccessMessage("experience", {}, "fallback.docx"), /"fallback\.docx".*Next action: extract/);
    assert.equal(getDocumentsUploadErrorMessage({ error: { message: "Experience source file is required." } }), "Experience source file is required.");
    assert.equal(getDocumentsUploadErrorMessage({ error: "Bad request" }), "Bad request");
    assert.equal(getDocumentsUploadErrorMessage(null), "Upload failed");
  });
});
