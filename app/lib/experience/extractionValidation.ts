import { isLikelyGarbledPdfText, normalizeExtractedText } from "../documentExtraction";

export const EXPERIENCE_EXTRACTION_LIMITS = {
  maxUploadBytes: 10 * 1024 * 1024,
  maxDocxExpandedBytes: 50 * 1024 * 1024,
  maxExtractedTextUtf16Units: 60000,
} as const;

export type ExperienceSourceBytes = ArrayBuffer | Uint8Array | Buffer;
export type ExperienceSourceFileKind = "pdf" | "docx" | "doc";

export type ExperienceValidationErrorCode =
  | "deadline-exceeded"
  | "empty-file"
  | "unsupported-extension"
  | "mime-mismatch"
  | "container-mismatch"
  | "file-too-large"
  | "docx-expanded-too-large"
  | "encrypted-pdf"
  | "extraction-empty"
  | "extraction-too-large"
  | "extraction-unusable";

export interface ExperienceExtractionLimits {
  maxUploadBytes?: number;
  maxDocxExpandedBytes?: number;
  maxExtractedTextUtf16Units?: number;
}

export interface ExperienceDeadline {
  expiresAtMs: number;
  stage: string;
}

export interface ExperienceSourceFileValidationInput {
  bytes: ExperienceSourceBytes;
  fileName: string;
  fileType?: string | null;
  limits?: ExperienceExtractionLimits;
  deadline?: ExperienceDeadline;
  nowMs?: number;
}

export interface ExperienceExtractedTextValidationInput {
  text: string;
  sourceKind?: ExperienceSourceFileKind;
  limits?: ExperienceExtractionLimits;
  deadline?: ExperienceDeadline;
  nowMs?: number;
}

export interface ExperienceSourceFileDescriptor {
  kind: ExperienceSourceFileKind;
  extension: ExperienceSourceFileKind;
  fileName: string;
  fileType: string;
  byteLength: number;
  compressedBytes: number;
  expandedBytes: number | null;
}

export interface ValidatedExperienceExtractedText {
  text: string;
  utf16Length: number;
}

interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
}

const PDF_MIME_TYPES = new Set(["application/pdf"]);
const DOCX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
]);
const DOC_MIME_TYPES = new Set(["application/msword"]);
const UNKNOWN_MIME_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream"]);
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP64_SIZE_MARKER = 0xffffffff;

export class ExperienceValidationError extends Error {
  readonly code: ExperienceValidationErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ExperienceValidationErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ExperienceValidationError";
    this.code = code;
    this.details = details;
  }
}

function mergedLimits(limits?: ExperienceExtractionLimits) {
  return {
    maxUploadBytes: limits?.maxUploadBytes ?? EXPERIENCE_EXTRACTION_LIMITS.maxUploadBytes,
    maxDocxExpandedBytes: limits?.maxDocxExpandedBytes ?? EXPERIENCE_EXTRACTION_LIMITS.maxDocxExpandedBytes,
    maxExtractedTextUtf16Units:
      limits?.maxExtractedTextUtf16Units ?? EXPERIENCE_EXTRACTION_LIMITS.maxExtractedTextUtf16Units,
  };
}

function toBuffer(bytes: ExperienceSourceBytes) {
  if (Buffer.isBuffer(bytes)) {
    return bytes;
  }
  if (bytes instanceof ArrayBuffer) {
    return Buffer.from(bytes);
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function extensionForFileName(fileName: string): ExperienceSourceFileKind {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]{1,16})$/);
  const extension = match?.[1];
  if (extension === "pdf" || extension === "docx" || extension === "doc") {
    return extension;
  }
  throw new ExperienceValidationError("unsupported-extension", "Experience uploads support DOCX, DOC, or PDF files.", {
    fileName,
  });
}

function normalizeMimeType(fileType: string | null | undefined) {
  return fileType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function expectedMimeTypes(kind: ExperienceSourceFileKind) {
  if (kind === "pdf") {
    return PDF_MIME_TYPES;
  }
  if (kind === "docx") {
    return DOCX_MIME_TYPES;
  }
  return DOC_MIME_TYPES;
}

function assertPlausibleMimeType(kind: ExperienceSourceFileKind, fileType: string) {
  if (UNKNOWN_MIME_TYPES.has(fileType) || expectedMimeTypes(kind).has(fileType)) {
    return;
  }

  throw new ExperienceValidationError("mime-mismatch", `Experience ${kind.toUpperCase()} upload has an unexpected MIME type.`, {
    kind,
    fileType,
  });
}

function hasSignature(buffer: Buffer, signature: Buffer) {
  return buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte);
}

function isPdf(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("latin1") === "%PDF-";
}

function isEncryptedPdf(buffer: Buffer) {
  return buffer.toString("latin1").includes("/Encrypt");
}

function findZipEndOfCentralDirectory(buffer: Buffer) {
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minOffset; offset--) {
    if (buffer.readUInt32LE(offset) === ZIP_EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function readZipCentralDirectory(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findZipEndOfCentralDirectory(buffer);
  if (eocdOffset < 0 || eocdOffset + 22 > buffer.length) {
    throw new ExperienceValidationError("container-mismatch", "DOCX file is not a readable ZIP container.");
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ExperienceValidationError("container-mismatch", "DOCX central directory is malformed.");
    }

    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;

    if (fileNameEnd > buffer.length) {
      throw new ExperienceValidationError("container-mismatch", "DOCX central directory filename is malformed.");
    }
    if (compressedSize === ZIP64_SIZE_MARKER || uncompressedSize === ZIP64_SIZE_MARKER) {
      throw new ExperienceValidationError("docx-expanded-too-large", "DOCX ZIP64 entries exceed supported size bounds.");
    }

    entries.push({
      name: buffer.subarray(fileNameStart, fileNameEnd).toString("utf-8"),
      compressedSize,
      uncompressedSize,
    });
    offset = fileNameEnd + extraLength + commentLength;
  }

  return entries;
}

function validateDocxContainer(buffer: Buffer, maxDocxExpandedBytes: number) {
  if (buffer.subarray(0, 2).toString("latin1") !== "PK") {
    throw new ExperienceValidationError("container-mismatch", "DOCX file is not a ZIP-based Office document.");
  }

  const entries = readZipCentralDirectory(buffer);
  const names = new Set(entries.map((entry) => entry.name));
  if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) {
    throw new ExperienceValidationError("container-mismatch", "DOCX file is missing required Word document entries.");
  }

  const expandedBytes = entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (expandedBytes > maxDocxExpandedBytes) {
    throw new ExperienceValidationError("docx-expanded-too-large", "DOCX expanded content exceeds the supported limit.", {
      expandedBytes,
      maxDocxExpandedBytes,
    });
  }

  return expandedBytes;
}

export function assertExperienceDeadline(deadline?: ExperienceDeadline, nowMs = Date.now()) {
  if (!deadline) {
    return;
  }
  if (!Number.isFinite(deadline.expiresAtMs) || nowMs >= deadline.expiresAtMs) {
    throw new ExperienceValidationError("deadline-exceeded", `${deadline.stage} deadline expired before processing could continue.`, {
      stage: deadline.stage,
      expiresAtMs: deadline.expiresAtMs,
      nowMs,
    });
  }
}

export function validateExperienceSourceFile(
  input: ExperienceSourceFileValidationInput,
): ExperienceSourceFileDescriptor {
  const limits = mergedLimits(input.limits);
  assertExperienceDeadline(input.deadline, input.nowMs);

  const buffer = toBuffer(input.bytes);
  if (buffer.byteLength === 0) {
    throw new ExperienceValidationError("empty-file", "Experience source file must not be empty.");
  }
  if (buffer.byteLength > limits.maxUploadBytes) {
    throw new ExperienceValidationError("file-too-large", "Experience source file exceeds the supported upload size.", {
      byteLength: buffer.byteLength,
      maxUploadBytes: limits.maxUploadBytes,
    });
  }

  const extension = extensionForFileName(input.fileName);
  const fileType = normalizeMimeType(input.fileType);
  assertPlausibleMimeType(extension, fileType);

  let expandedBytes: number | null = null;
  if (extension === "pdf") {
    if (!isPdf(buffer)) {
      throw new ExperienceValidationError("container-mismatch", "PDF file does not have a PDF container signature.");
    }
    if (isEncryptedPdf(buffer)) {
      throw new ExperienceValidationError("encrypted-pdf", "Encrypted PDFs cannot be extracted for experience ingestion.");
    }
  } else if (extension === "docx") {
    expandedBytes = validateDocxContainer(buffer, limits.maxDocxExpandedBytes);
  } else if (!hasSignature(buffer, OLE_SIGNATURE)) {
    throw new ExperienceValidationError("container-mismatch", "Legacy DOC file does not have an OLE document signature.");
  }

  assertExperienceDeadline(input.deadline, input.nowMs);
  return {
    kind: extension,
    extension,
    fileName: input.fileName,
    fileType: fileType || "application/octet-stream",
    byteLength: buffer.byteLength,
    compressedBytes: buffer.byteLength,
    expandedBytes,
  };
}

export function validateExperienceExtractedText(
  input: ExperienceExtractedTextValidationInput,
): ValidatedExperienceExtractedText {
  const limits = mergedLimits(input.limits);
  assertExperienceDeadline(input.deadline, input.nowMs);

  const text = normalizeExtractedText(input.text);
  if (!text) {
    throw new ExperienceValidationError("extraction-empty", "Experience source did not contain selectable extracted text.");
  }
  if (text.length > limits.maxExtractedTextUtf16Units) {
    throw new ExperienceValidationError("extraction-too-large", "Extracted experience text exceeds the supported limit.", {
      utf16Length: text.length,
      maxExtractedTextUtf16Units: limits.maxExtractedTextUtf16Units,
    });
  }
  if (isLikelyGarbledPdfText(text)) {
    throw new ExperienceValidationError("extraction-unusable", "Extracted experience text appears garbled after fallback parsing.");
  }

  const visibleCharacters = text.replace(/\s/g, "").length;
  const usefulCharacters = (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (usefulCharacters < 8 || (visibleCharacters > 0 && usefulCharacters / visibleCharacters < 0.25)) {
    throw new ExperienceValidationError("extraction-unusable", "Extracted experience text is not usable for structured parsing.");
  }

  assertExperienceDeadline(input.deadline, input.nowMs);
  return {
    text,
    utf16Length: text.length,
  };
}
