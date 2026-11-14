import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getErrorMessage } from "./errors";

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
