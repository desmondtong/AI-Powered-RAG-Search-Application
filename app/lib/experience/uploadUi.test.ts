import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  autostartKey,
  getDocumentsUploadConfig,
  getDocumentsUploadErrorMessage,
  isDocumentsUploadSuccess,
  shouldAutostart,
  uploadedSourceId,
} from "./uploadUi";

describe("experience upload UI contracts", () => {
  it("scopes the inline upload to the experience API, DOCX and PDF, with the new labels", () => {
    const experience = getDocumentsUploadConfig("experience");

    assert.equal(experience.endpoint, "/api/experiences");
    assert.equal(experience.accept, ".pdf,.docx");
    assert.equal(experience.title, "Upload experience file");
    assert.equal(experience.body, "Drop a DOCX or selectable-text PDF here, or browse. Max 10 MB.");
    assert.equal(experience.hint, "Uploading takes you straight to the file.");
    assert.deepEqual(getDocumentsUploadConfig(), experience);
  });

  it("interprets experience upload responses", () => {
    assert.equal(isDocumentsUploadSuccess("experience", { source: { id: "source-1", file_name: "work.docx" } }), true);
    assert.equal(isDocumentsUploadSuccess("experience", { success: true, fileName: "notes.pdf", chunks: 3 }), false);
    assert.equal(isDocumentsUploadSuccess("experience", { source: { id: "source-1" }, error: "failed" }), false);
    assert.equal(isDocumentsUploadSuccess("experience", null), false);
    assert.equal(uploadedSourceId({ source: { id: "source-1" } }), "source-1");
    assert.equal(uploadedSourceId({ source: {} }), null);
  });

  it("auto-starts processing only for a new upload that is still uploaded", () => {
    assert.equal(shouldAutostart({ source: { id: "s1", status: "uploaded" }, upload_state: "uploaded", next_action: "extract" }), true);
    assert.equal(shouldAutostart({ source: { id: "s1", status: "uploaded" }, upload_state: "already-uploaded" }), false);
    assert.equal(shouldAutostart({ source: { id: "s1", status: "draft" }, upload_state: "already-uploaded" }), false);
    assert.equal(shouldAutostart({ source: { id: "s1", status: "extracted" }, upload_state: "uploaded" }), false);
    assert.equal(shouldAutostart({ source: { status: "uploaded" }, upload_state: "uploaded" }), false);
    assert.equal(shouldAutostart(null), false);
    assert.equal(autostartKey("s1"), "jdfit:autostart:s1");
  });

  it("reads upload error messages and falls back when none is given", () => {
    assert.equal(getDocumentsUploadErrorMessage({ error: { message: "Experience source file is required." } }), "Experience source file is required.");
    assert.equal(getDocumentsUploadErrorMessage({ error: { code: "file-too-large", message: "File exceeds 10 MB." } }), "File exceeds 10 MB.");
    assert.equal(getDocumentsUploadErrorMessage({ error: "Bad request" }), "Bad request");
    assert.equal(getDocumentsUploadErrorMessage(null), "Upload failed. Try again.");
  });
});
