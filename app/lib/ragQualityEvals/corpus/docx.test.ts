import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import mammoth from "mammoth";
import { extractTextFromGenericDocument } from "../../documentExtraction";
import { buildExperienceExtractionSnapshot } from "../../experience/extractionSnapshot";
import { validateExperienceExtractedText, validateExperienceSourceFile } from "../../experience/extractionValidation";
import { fixtureExperienceText } from "../fixtureSchema";
import { loadRagEvalFixtures } from "../fixtures";
import { DOCX_MIME_TYPE, fixtureFileName, synthesizeOfflineCorpusEntry } from "../offlineExport";
import { buildMinimalDocx } from "./docx";

describe("rag-eval minimal DOCX", () => {
  it("round-trips every fixture through extraction into blocks equal to the fixture paragraphs", async () => {
    for (const fixture of loadRagEvalFixtures()) {
      const bytes = buildMinimalDocx(fixture.experience.paragraphs);
      const fileName = fixtureFileName(fixture);
      const descriptor = validateExperienceSourceFile({ bytes, fileName, fileType: DOCX_MIME_TYPE });
      assert.equal(descriptor.kind, "docx");

      // The experience extractor's path: mammoth raw text, text validation, then the snapshot builder.
      const raw = await mammoth.extractRawText({ buffer: bytes });
      validateExperienceExtractedText({ text: raw.value, sourceKind: "docx" });
      const snapshot = buildExperienceExtractionSnapshot({
        sourceId: "source",
        originalFileName: fileName,
        originalFileType: DOCX_MIME_TYPE,
        byteSha256: createHash("sha256").update(bytes).digest("hex"),
        segments: [{ text: raw.value, locator: { kind: "unknown" } }],
        warnings: raw.messages.map((message) => message.message),
      });
      assert.deepEqual(snapshot.blocks.map((block) => block.text), fixture.experience.paragraphs, fixture.fixture_id);
      assert.deepEqual(snapshot.warnings, [], fixture.fixture_id);
      assert.deepEqual(snapshot.blocks, synthesizeOfflineCorpusEntry(fixture).active.source_blocks, `${fixture.fixture_id} offline blocks match`);

      // The generic documentExtraction path reads the same text.
      const generic = await extractTextFromGenericDocument(new File([new Uint8Array(bytes)], fileName, { type: DOCX_MIME_TYPE }));
      assert.equal(generic.trim(), fixtureExperienceText(fixture));
    }
  });

  it("escapes XML and produces identical bytes for identical paragraphs", async () => {
    const paragraphs = ['Tom & Jerry <test> "quoted" it\'s fine.'];
    const bytes = buildMinimalDocx(paragraphs);
    assert.deepEqual(bytes, buildMinimalDocx(paragraphs));
    const raw = await mammoth.extractRawText({ buffer: bytes });
    assert.equal(raw.value.trim(), paragraphs[0]);
  });
});
