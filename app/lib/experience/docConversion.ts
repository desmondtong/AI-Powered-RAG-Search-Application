import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  assertExperienceDeadline,
  validateExperienceSourceFile,
  type ExperienceDeadline,
  type ExperienceExtractionLimits,
  type ExperienceSourceBytes,
} from "./extractionValidation";

const execFileAsync = promisify(execFile);

export const DOC_CONVERSION_DEFAULTS = {
  timeoutMs: 30000,
  maxOutputBytes: 10 * 1024 * 1024,
  maxProcessOutputBytes: 1024 * 1024,
} as const;

export type DocConversionErrorCode =
  | "converter-unavailable"
  | "conversion-timeout"
  | "conversion-failed"
  | "conversion-output-too-large";

export interface LegacyDocConversionInput {
  bytes: ExperienceSourceBytes;
  sourceFileName?: string;
  sourceFileType?: string | null;
  converterPath?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxProcessOutputBytes?: number;
  limits?: ExperienceExtractionLimits;
  deadline?: ExperienceDeadline;
  nowMs?: number;
  onTemporaryDirectoryCreated?: (path: string) => void;
}

export interface LegacyDocConversionResult {
  bytes: Buffer;
  fileName: "source.docx";
  fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  converterPath: string;
}

interface ExecErrorLike extends Error {
  code?: string;
  signal?: string;
  killed?: boolean;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

export class DocConversionError extends Error {
  readonly code: DocConversionErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: DocConversionErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "DocConversionError";
    this.code = code;
    this.details = details;
  }
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

function configuredLibreOfficeCommand(converterPath?: string) {
  return converterPath?.trim() || process.env.LIBREOFFICE_PATH?.trim() || "soffice";
}

function truncateProcessOutput(value: string | Buffer | undefined) {
  if (!value) {
    return "";
  }
  const text = Buffer.isBuffer(value) ? value.toString("utf-8") : value;
  return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
}

function toConversionError(error: unknown, converterPath: string): DocConversionError {
  const execError = error as ExecErrorLike;
  if (execError.code === "ENOENT") {
    return new DocConversionError("converter-unavailable", "LibreOffice converter is not available.", {
      converterPath,
    });
  }
  if (execError.code === "ETIMEDOUT" || execError.signal === "SIGTERM" || execError.killed) {
    return new DocConversionError("conversion-timeout", "Legacy DOC conversion timed out.", {
      converterPath,
    });
  }
  return new DocConversionError("conversion-failed", "Legacy DOC conversion failed.", {
    converterPath,
    message: execError.message,
    stdout: truncateProcessOutput(execError.stdout),
    stderr: truncateProcessOutput(execError.stderr),
  });
}

export async function convertLegacyDocToDocx(input: LegacyDocConversionInput): Promise<LegacyDocConversionResult> {
  const buffer = toBuffer(input.bytes);
  const sourceFileName = input.sourceFileName || "source.doc";
  const sourceFileType = input.sourceFileType || "application/msword";
  const converterPath = configuredLibreOfficeCommand(input.converterPath);
  const timeoutMs = input.timeoutMs ?? DOC_CONVERSION_DEFAULTS.timeoutMs;
  const maxOutputBytes = input.maxOutputBytes ?? DOC_CONVERSION_DEFAULTS.maxOutputBytes;
  const maxProcessOutputBytes = input.maxProcessOutputBytes ?? DOC_CONVERSION_DEFAULTS.maxProcessOutputBytes;

  validateExperienceSourceFile({
    bytes: buffer,
    fileName: sourceFileName,
    fileType: sourceFileType,
    limits: input.limits,
    deadline: input.deadline,
    nowMs: input.nowMs,
  });

  const tempRoot = await mkdtemp(join(tmpdir(), "experience-doc-"));
  input.onTemporaryDirectoryCreated?.(tempRoot);
  const inputDir = join(tempRoot, "input");
  const outputDir = join(tempRoot, "output");
  const profileDir = join(tempRoot, "profile");
  const inputPath = join(inputDir, "source.doc");
  const outputPath = join(outputDir, "source.docx");

  try {
    await mkdir(inputDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await mkdir(profileDir, { recursive: true });
    await writeFile(inputPath, buffer, { flag: "wx" });

    assertExperienceDeadline(input.deadline, input.nowMs);
    try {
      await execFileAsync(
        converterPath,
        [
          "--headless",
          "--nologo",
          "--nofirststartwizard",
          "--norestore",
          "--nodefault",
          `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
          "--convert-to",
          "docx",
          "--outdir",
          outputDir,
          inputPath,
        ],
        {
          cwd: tempRoot,
          timeout: timeoutMs,
          maxBuffer: maxProcessOutputBytes,
          windowsHide: true,
        },
      );
    } catch (error) {
      throw toConversionError(error, converterPath);
    }

    assertExperienceDeadline(input.deadline, input.nowMs);
    let converted: Buffer;
    try {
      converted = await readFile(outputPath);
    } catch (error) {
      throw new DocConversionError("conversion-failed", "LibreOffice did not produce a DOCX output file.", {
        converterPath,
        message: (error as Error).message,
      });
    }

    if (converted.byteLength === 0) {
      throw new DocConversionError("conversion-failed", "LibreOffice produced an empty DOCX output file.", {
        converterPath,
      });
    }
    if (converted.byteLength > maxOutputBytes) {
      throw new DocConversionError("conversion-output-too-large", "Converted DOCX exceeds the supported output limit.", {
        byteLength: converted.byteLength,
        maxOutputBytes,
      });
    }

    validateExperienceSourceFile({
      bytes: converted,
      fileName: "source.docx",
      fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      limits: input.limits,
      deadline: input.deadline,
      nowMs: input.nowMs,
    });

    return {
      bytes: converted,
      fileName: "source.docx",
      fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      converterPath,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
