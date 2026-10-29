import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getDocumentsUploadConfig,
  getDocumentsUploadErrorMessage,
  getDocumentsUploadSuccessMessage,
  isDocumentsUploadSuccess,
} from "./uploadUi";

describe("documents upload UI contracts", () => {
  it("keeps generic and experience upload actions scoped to their intended APIs and formats", () => {
    const generic = getDocumentsUploadConfig("generic");
    const experience = getDocumentsUploadConfig("experience");

    assert.equal(generic.endpoint, "/api/upload");
    assert.equal(generic.accept, ".pdf,.docx,.txt");
    assert.equal(experience.endpoint, "/api/experiences");
    assert.equal(experience.accept, ".pdf,.docx,.doc");
  });

  it("interprets generic and experience upload responses without mixing contracts", () => {
    assert.equal(isDocumentsUploadSuccess("generic", { success: true, fileName: "notes.pdf", chunks: 3 }), true);
    assert.equal(isDocumentsUploadSuccess("generic", { source: { id: "source-1" } }), false);
    assert.equal(isDocumentsUploadSuccess("experience", { source: { id: "source-1", file_name: "work.doc" } }), true);
    assert.equal(isDocumentsUploadSuccess("experience", { success: true, fileName: "notes.pdf", chunks: 3 }), false);

    assert.match(
      getDocumentsUploadSuccessMessage("generic", { success: true, fileName: "notes.pdf", chunks: 3 }, "fallback.pdf"),
      /Processed 3 chunks/,
    );
    assert.match(
      getDocumentsUploadSuccessMessage(
        "experience",
        { source: { file_name: "work.doc" }, next_action: "extract" },
        "fallback.doc",
      ),
      /Next action: extract/,
    );
    assert.equal(getDocumentsUploadErrorMessage({ error: { message: "Experience source file is required." } }), "Experience source file is required.");
  });
});
