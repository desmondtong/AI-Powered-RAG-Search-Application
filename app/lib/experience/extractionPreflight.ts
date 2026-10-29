import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EXPERIENCE_EXTRACTION_LIMITS } from "./extractionValidation";

const execFileAsync = promisify(execFile);

export interface RuntimeToolCheck {
  name: string;
  available: boolean;
  command?: string;
  version?: string;
  error?: string;
}

export interface ExperienceExtractionPreflightResult {
  ok: boolean;
  supportedFormats: Array<"docx" | "doc" | "pdf">;
  limits: typeof EXPERIENCE_EXTRACTION_LIMITS;
  libreOffice: RuntimeToolCheck;
  pdftotext: RuntimeToolCheck;
  mammoth: RuntimeToolCheck;
  pdf2json: RuntimeToolCheck;
  warnings: string[];
}

export interface ExperienceExtractionPreflightOptions {
  libreOfficePath?: string;
  pdftotextPath?: string;
  timeoutMs?: number;
}

function firstLine(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

async function checkCommand(name: string, command: string, args: string[], timeoutMs: number): Promise<RuntimeToolCheck> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 256 * 1024,
      windowsHide: true,
    });
    return {
      name,
      command,
      available: true,
      version: firstLine(stdout) || firstLine(stderr),
    };
  } catch (error) {
    return {
      name,
      command,
      available: false,
      error: error instanceof Error ? error.message : "Unknown runtime check error",
    };
  }
}

async function checkModule(name: string, loader: () => Promise<unknown>): Promise<RuntimeToolCheck> {
  try {
    await loader();
    return { name, available: true };
  } catch (error) {
    return {
      name,
      available: false,
      error: error instanceof Error ? error.message : "Unknown module check error",
    };
  }
}

export async function runExperienceExtractionPreflight(
  options: ExperienceExtractionPreflightOptions = {},
): Promise<ExperienceExtractionPreflightResult> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const libreOfficeCommand = options.libreOfficePath || process.env.LIBREOFFICE_PATH || "soffice";
  const pdftotextCommand = options.pdftotextPath || process.env.PDFTOTEXT_PATH || "pdftotext";

  const [libreOffice, pdftotext, mammoth, pdf2json] = await Promise.all([
    checkCommand("LibreOffice", libreOfficeCommand, ["--version"], timeoutMs),
    checkCommand("Poppler pdftotext", pdftotextCommand, ["-v"], timeoutMs),
    checkModule("Mammoth", () => import("mammoth")),
    checkModule("pdf2json", () => import("pdf2json")),
  ]);
  const warnings: string[] = [];

  if (!pdftotext.available) {
    warnings.push("Poppler pdftotext is unavailable; selectable PDFs will use the pdf2json fallback.");
  }

  return {
    ok: libreOffice.available && mammoth.available && pdf2json.available,
    supportedFormats: ["docx", "doc", "pdf"],
    limits: EXPERIENCE_EXTRACTION_LIMITS,
    libreOffice,
    pdftotext,
    mammoth,
    pdf2json,
    warnings,
  };
}
