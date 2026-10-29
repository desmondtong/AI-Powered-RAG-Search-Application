import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ExperienceValidationError,
  assertExperienceDeadline,
  validateExperienceExtractedText,
  validateExperienceSourceFile,
  type ExperienceValidationErrorCode,
} from "./extractionValidation";

const PDF_BYTES = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", "latin1");
const ENCRYPTED_PDF_BYTES = Buffer.from(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Encrypt 2 0 R >>\nendobj\n%%EOF\n",
  "latin1",
);

interface ZipFixtureEntry {
  name: string;
  compressedSize?: number;
  uncompressedSize: number;
}

function zipEntry(name: string, uncompressedSize: number, compressedSize = uncompressedSize): ZipFixtureEntry {
  return { name, compressedSize, uncompressedSize };
}

function writeUInt32LE(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function writeUInt16LE(value: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function buildDocxLikeZip(entries: ZipFixtureEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf-8");
    const compressedSize = entry.compressedSize ?? entry.uncompressedSize;
    const localHeader = Buffer.concat([
      writeUInt32LE(0x04034b50),
      writeUInt16LE(20),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt16LE(0),
      writeUInt32LE(0),
      writeUInt32LE(compressedSize),
      writeUInt32LE(entry.uncompressedSize),
      writeUInt16LE(name.byteLength),
      writeUInt16LE(0),
      name,
      Buffer.alloc(compressedSize),
    ]);
    localParts.push(localHeader);

    centralParts.push(
      Buffer.concat([
        writeUInt32LE(0x02014b50),
        writeUInt16LE(20),
        writeUInt16LE(20),
        writeUInt16LE(0),
        writeUInt16LE(0),
        writeUInt16LE(0),
        writeUInt16LE(0),
        writeUInt32LE(0),
        writeUInt32LE(compressedSize),
        writeUInt32LE(entry.uncompressedSize),
        writeUInt16LE(name.byteLength),
        writeUInt16LE(0),
        writeUInt16LE(0),
        writeUInt16LE(0),
        writeUInt16LE(0),
        writeUInt32LE(0),
        writeUInt32LE(localOffset),
        name,
      ]),
    );
    localOffset += localHeader.byteLength;
  }

  const localData = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.concat([
    writeUInt32LE(0x06054b50),
    writeUInt16LE(0),
    writeUInt16LE(0),
    writeUInt16LE(entries.length),
    writeUInt16LE(entries.length),
    writeUInt32LE(centralDirectory.byteLength),
    writeUInt32LE(localData.byteLength),
    writeUInt16LE(0),
  ]);

  return Buffer.concat([localData, centralDirectory, eocd]);
}

function validDocxBytes() {
  return buildDocxLikeZip([
    zipEntry("[Content_Types].xml", 25),
    zipEntry("word/document.xml", 40),
    zipEntry("_rels/.rels", 15),
  ]);
}

function assertValidationError(action: () => unknown, code: ExperienceValidationErrorCode) {
  assert.throws(
    action,
    (error) => error instanceof ExperienceValidationError && error.code === code,
    `expected ${code}`,
  );
}

describe("experience source file validation", () => {
  it("accepts supported PDF and DOCX containers", () => {
    const pdf = validateExperienceSourceFile({
      bytes: PDF_BYTES,
      fileName: "experience.pdf",
      fileType: "application/pdf",
    });
    const docx = validateExperienceSourceFile({
      bytes: validDocxBytes(),
      fileName: "experience.docx",
      fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    assert.equal(pdf.kind, "pdf");
    assert.equal(pdf.expandedBytes, null);
    assert.equal(docx.kind, "docx");
    assert.equal(docx.expandedBytes, 80);
  });

  it("rejects empty, unsupported, mislabeled, and MIME-conflicting uploads", () => {
    assertValidationError(
      () => validateExperienceSourceFile({ bytes: Buffer.alloc(0), fileName: "experience.pdf", fileType: "application/pdf" }),
      "empty-file",
    );
    assertValidationError(
      () => validateExperienceSourceFile({ bytes: Buffer.from("text"), fileName: "experience.txt", fileType: "text/plain" }),
      "unsupported-extension",
    );
    assertValidationError(
      () => validateExperienceSourceFile({ bytes: Buffer.from("doc"), fileName: "experience.doc", fileType: "application/msword" }),
      "unsupported-extension",
    );
    assertValidationError(
      () => validateExperienceSourceFile({ bytes: PDF_BYTES, fileName: "experience.pdf", fileType: "text/plain" }),
      "mime-mismatch",
    );
    assertValidationError(
      () =>
        validateExperienceSourceFile({
          bytes: validDocxBytes(),
          fileName: "experience.pdf",
          fileType: "application/pdf",
        }),
      "container-mismatch",
    );
  });

  it("enforces compressed upload size and DOCX expanded-size limits", () => {
    assertValidationError(
      () =>
        validateExperienceSourceFile({
          bytes: PDF_BYTES,
          fileName: "experience.pdf",
          fileType: "application/pdf",
          limits: { maxUploadBytes: 8 },
        }),
      "file-too-large",
    );
    assertValidationError(
      () =>
        validateExperienceSourceFile({
          bytes: buildDocxLikeZip([
            zipEntry("[Content_Types].xml", 5),
            zipEntry("word/document.xml", 100, 0),
          ]),
          fileName: "experience.docx",
          fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          limits: { maxDocxExpandedBytes: 20 },
        }),
      "docx-expanded-too-large",
    );
  });

  it("rejects encrypted PDFs and expired extraction deadlines", () => {
    assertValidationError(
      () =>
        validateExperienceSourceFile({
          bytes: ENCRYPTED_PDF_BYTES,
          fileName: "experience.pdf",
          fileType: "application/pdf",
        }),
      "encrypted-pdf",
    );
    assertValidationError(
      () =>
        validateExperienceSourceFile({
          bytes: PDF_BYTES,
          fileName: "experience.pdf",
          fileType: "application/pdf",
          deadline: { stage: "extract", expiresAtMs: 100 },
          nowMs: 101,
        }),
      "deadline-exceeded",
    );
    assertValidationError(() => assertExperienceDeadline({ stage: "parse", expiresAtMs: 5 }, 5), "deadline-exceeded");
  });
});

describe("experience extracted text validation", () => {
  it("normalizes usable extracted text before structured parsing", () => {
    const result = validateExperienceExtractedText({
      text: "Project Atlas\r\nDelivered search workflows for support teams.\n",
      sourceKind: "docx",
    });

    assert.equal(result.text, "Project Atlas\nDelivered search workflows for support teams.");
    assert.equal(result.utf16Length, result.text.length);
  });

  it("rejects scanned-only, over-limit, symbol-only, and garbled fallback text", () => {
    assertValidationError(() => validateExperienceExtractedText({ text: " \n\t", sourceKind: "pdf" }), "extraction-empty");
    assertValidationError(
      () =>
        validateExperienceExtractedText({
          text: "Project text that is too long",
          sourceKind: "docx",
          limits: { maxExtractedTextUtf16Units: 5 },
        }),
      "extraction-too-large",
    );
    assertValidationError(
      () => validateExperienceExtractedText({ text: "!!!!! ????? -----", sourceKind: "pdf" }),
      "extraction-unusable",
    );
    assertValidationError(
      () => validateExperienceExtractedText({ text: `${"g ".repeat(140)} ${"■".repeat(10)}`, sourceKind: "pdf" }),
      "extraction-unusable",
    );
  });

  it("enforces parsing deadlines before LLM work can start", () => {
    assertValidationError(
      () =>
        validateExperienceExtractedText({
          text: "Project Atlas delivered search workflows for support teams.",
          sourceKind: "pdf",
          deadline: { stage: "parse", expiresAtMs: 1000 },
          nowMs: 1000,
        }),
      "deadline-exceeded",
    );
  });
});
