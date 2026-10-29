import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import mammoth from "mammoth";
import { getErrorMessage } from "./errors";

const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;
const PDFTOTEXT_TIMEOUT_MS = 10000;
const PDFTOTEXT_MAX_BUFFER = 20 * 1024 * 1024;
const execFileAsync = promisify(execFile);

const PDFTOTEXT_COMMANDS = Array.from(
  new Set(
    [
      process.env.PDFTOTEXT_PATH,
      "pdftotext",
      "/opt/homebrew/bin/pdftotext",
      "/usr/local/bin/pdftotext",
      "/usr/bin/pdftotext",
    ].filter((command): command is string => Boolean(command)),
  ),
);

export interface DocumentContext {
  title?: string;
  subtitle?: string;
  text: string;
}

interface PdfTextRun {
  T?: string;
}

interface PdfText {
  R?: PdfTextRun[];
}

interface PdfPage {
  Texts?: PdfText[];
}

interface PdfData {
  Pages?: PdfPage[];
}

interface PdfParserError {
  parserError?: string;
}

interface PdfParser {
  on(event: "pdfParser_dataError", handler: (error: PdfParserError) => void): void;
  on(event: "pdfParser_dataReady", handler: (data: PdfData) => void): void;
  parseBuffer(buffer: Buffer): void;
  getRawTextContent?: () => string;
}

function safeDecodeURIComponent(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    try {
      return decodeURIComponent(str.replace(/%/g, "%25"));
    } catch {
      return str;
    }
  }
}

function findChunkEnd(text: string, start: number) {
  const maxEnd = Math.min(start + CHUNK_SIZE, text.length);
  const minEnd = start + Math.floor(CHUNK_SIZE * 0.6);
  const separators = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "];

  for (const separator of separators) {
    const index = text.lastIndexOf(separator, maxEnd);
    if (index >= minEnd) {
      return index + separator.length;
    }
  }

  return maxEnd;
}

export function splitTextIntoChunks(text: string) {
  const trimmed = text.trim();
  const chunks: string[] = [];
  let start = 0;

  while (start < trimmed.length) {
    const end = findChunkEnd(trimmed, start);
    const chunk = trimmed.slice(start, end).trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= trimmed.length) {
      break;
    }

    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }

  return chunks;
}

export function buildDocumentContext(fileName: string, text: string): DocumentContext {
  const lines = normalizeExtractedText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const title = lines[0] || fileName;
  const subtitle = lines.slice(1, 5).find((line) => line !== title && line.length <= 160);
  const parts = [`File: ${fileName}`];

  if (title) {
    parts.push(`Title: ${title}`);
  }

  if (subtitle) {
    parts.push(`Header: ${subtitle}`);
  }

  return {
    title,
    subtitle,
    text: parts.join("\n"),
  };
}

export function normalizeExtractedText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isLikelyGarbledPdfText(text: string) {
  const normalized = text.trim();
  if (normalized.length < 200) {
    return false;
  }

  const letters = normalized.match(/[A-Za-z]/g) ?? [];
  if (letters.length < 100) {
    return false;
  }

  const gCount = letters.filter((letter) => letter.toLowerCase() === "g").length;
  const symbolCount = (normalized.match(/[■▼▲●○←↑↓]/g) ?? []).length;
  const singleLetterTokens = normalized.match(/\b[A-Za-z]\b/g) ?? [];
  const tokens = normalized.match(/\S+/g) ?? [];

  return (
    (symbolCount > 5 && gCount / letters.length > 0.25) ||
    (tokens.length > 50 && singleLetterTokens.length / tokens.length > 0.65 && gCount / letters.length > 0.35)
  );
}

export async function extractTextWithPdftotext(buffer: Buffer) {
  const tempDir = await mkdtemp(join(tmpdir(), "rag-pdf-"));
  const inputPath = join(tempDir, "input.pdf");

  try {
    await writeFile(inputPath, buffer);

    for (const command of PDFTOTEXT_COMMANDS) {
      try {
        const { stdout } = await execFileAsync(command, ["-layout", "-enc", "UTF-8", inputPath, "-"], {
          timeout: PDFTOTEXT_TIMEOUT_MS,
          maxBuffer: PDFTOTEXT_MAX_BUFFER,
        });
        const text = normalizeExtractedText(stdout);

        if (text && !isLikelyGarbledPdfText(text)) {
          return text;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`pdftotext failed with ${command}:`, getErrorMessage(error, "Unknown pdftotext error"));
        }
      }
    }

    return "";
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function extractTextWithPdf2Json(buffer: Buffer) {
  const PDFParser = (await import("pdf2json")).default as unknown as new (
    context: null,
    needRawText: boolean,
  ) => PdfParser;

  return new Promise<string>((resolve, reject) => {
    const pdfParser = new PDFParser(null, true);
    pdfParser.on("pdfParser_dataError", (err) => reject(new Error(`PDF parsing error: ${err.parserError}`)));
    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      try {
        let positionedText = "";
        pdfData.Pages?.forEach((page) =>
          page.Texts?.forEach((text) =>
            text.R?.forEach((r) => r.T && (positionedText += safeDecodeURIComponent(r.T) + " ")),
          ),
        );

        const rawText = normalizeExtractedText(pdfParser.getRawTextContent?.() || "");
        const normalizedPositionedText = normalizeExtractedText(positionedText);

        resolve(isLikelyGarbledPdfText(normalizedPositionedText) && rawText ? rawText : normalizedPositionedText);
      } catch (error) {
        reject(new Error(`Error extracting text: ${getErrorMessage(error, "Unknown PDF extraction error")}`));
      }
    });
    pdfParser.parseBuffer(buffer);
  });
}

export async function extractTextFromGenericDocument(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith(".pdf")) {
    return (await extractTextWithPdftotext(buffer)) || extractTextWithPdf2Json(buffer);
  } else if (fileName.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } else if (fileName.endsWith(".txt")) {
    return buffer.toString("utf-8");
  } else {
    throw new Error("Unsupported file type. Please upload PDF, DOCX, or TXT files.");
  }
}
