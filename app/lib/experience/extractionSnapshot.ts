import { createHash, randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../supabaseServer";
import { normalizeExtractedText } from "../documentExtraction";
import { parseExtractionSnapshot, type ExtractionSnapshot, type SourceBlock } from "./contracts";

export const EXPERIENCE_EXTRACTION_PARSER_VERSION = "experience-extraction-v1";
export const EXPERIENCE_NORMALIZATION_VERSION = "mechanical-normalize-v1";
export const DEFAULT_SOURCE_BLOCK_MAX_UTF16_UNITS = 2000;

export interface ExtractedSourceSegment {
  text: string;
  locator?: SourceBlock["locator"];
}

export interface BuildExperienceExtractionSnapshotInput {
  sourceId: string;
  extractionSnapshotId?: string;
  originalFileName: string;
  originalFileType: string;
  byteSha256: string;
  parserVersion?: string;
  normalizationVersion?: string;
  maxBlockUtf16Units?: number;
  segments: ExtractedSourceSegment[];
  warnings?: string[];
}

export interface ExperienceExtractionInsertRow {
  id: string;
  source_id: string;
  text_sha256: string;
  parser_version: string;
  normalization_version: string;
  blocks: SourceBlock[];
  warnings: string[];
}

export interface ExperienceExtractionSourceMetadata {
  sourceId: string;
  originalFileName: string;
  originalFileType: string;
  byteSha256: string;
}

interface SupabaseErrorLike {
  code?: string;
  message?: string;
  name?: string;
}

interface InsertResponse {
  data?: unknown;
  error: SupabaseErrorLike | null;
}

export interface ExperienceExtractionSnapshotClient {
  from(table: "experience_extractions"): {
    insert(row: ExperienceExtractionInsertRow): Promise<InsertResponse>;
  };
}

function requireNonEmptyText(value: string, name: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} must be non-empty text.`);
  }
  return trimmed;
}

function normalizeWarnings(warnings: string[] | undefined) {
  return [...new Set((warnings ?? []).map((warning) => warning.trim()).filter(Boolean))];
}

function hashText(text: string) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function splitIndex(text: string, maxUtf16Units: number) {
  if (text.length <= maxUtf16Units) {
    return text.length;
  }

  const minIndex = Math.floor(maxUtf16Units * 0.6);
  const separators = ["\n", ". ", "; ", ", ", " "];
  for (const separator of separators) {
    const index = text.lastIndexOf(separator, maxUtf16Units);
    if (index >= minIndex) {
      return index + separator.length;
    }
  }

  return maxUtf16Units;
}

function splitSegmentIntoBlockTexts(text: string, maxUtf16Units: number) {
  const paragraphs = normalizeExtractedText(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const blockTexts: string[] = [];

  for (const paragraph of paragraphs) {
    let remaining = paragraph;
    while (remaining.length > 0) {
      const index = splitIndex(remaining, maxUtf16Units);
      const part = remaining.slice(0, index).trim();
      if (part) {
        blockTexts.push(part);
      }
      if (index >= remaining.length) {
        break;
      }
      remaining = remaining.slice(index).trim();
    }
  }

  return blockTexts;
}

export function reconstructExtractionSnapshotText(snapshot: Pick<ExtractionSnapshot, "blocks">) {
  return snapshot.blocks.map((block) => block.text).join("\n\n");
}

export function buildExperienceExtractionSnapshot(
  input: BuildExperienceExtractionSnapshotInput,
): ExtractionSnapshot {
  const maxBlockUtf16Units = input.maxBlockUtf16Units ?? DEFAULT_SOURCE_BLOCK_MAX_UTF16_UNITS;
  if (!Number.isInteger(maxBlockUtf16Units) || maxBlockUtf16Units < 1) {
    throw new Error("maxBlockUtf16Units must be a positive integer.");
  }

  const sourceId = requireNonEmptyText(input.sourceId, "sourceId");
  const extractionSnapshotId = requireNonEmptyText(input.extractionSnapshotId ?? randomUUID(), "extractionSnapshotId");
  const originalFileName = requireNonEmptyText(input.originalFileName, "originalFileName");
  const originalFileType = requireNonEmptyText(input.originalFileType, "originalFileType");
  const byteSha256 = requireNonEmptyText(input.byteSha256, "byteSha256");
  const parserVersion = requireNonEmptyText(
    input.parserVersion ?? EXPERIENCE_EXTRACTION_PARSER_VERSION,
    "parserVersion",
  );
  const normalizationVersion = requireNonEmptyText(
    input.normalizationVersion ?? EXPERIENCE_NORMALIZATION_VERSION,
    "normalizationVersion",
  );

  const blocks: SourceBlock[] = [];
  let cursor = 0;

  for (const segment of input.segments) {
    const blockTexts = splitSegmentIntoBlockTexts(segment.text, maxBlockUtf16Units);
    for (const blockText of blockTexts) {
      if (blocks.length > 0) {
        cursor += 2;
      }

      const block: SourceBlock = {
        block_id: `block-${String(blocks.length + 1).padStart(4, "0")}`,
        order: blocks.length,
        text: blockText,
        text_start: cursor,
        text_end: cursor + blockText.length,
      };
      if (segment.locator) {
        block.locator = segment.locator;
      }
      blocks.push(block);
      cursor = block.text_end;
    }
  }

  if (blocks.length === 0) {
    throw new Error("Extraction snapshot must contain at least one non-empty source block.");
  }

  return parseExtractionSnapshot({
    source_id: sourceId,
    extraction_snapshot_id: extractionSnapshotId,
    original_file_name: originalFileName,
    original_file_type: originalFileType,
    byte_sha256: byteSha256,
    text_sha256: hashText(reconstructExtractionSnapshotText({ blocks })),
    parser_version: parserVersion,
    normalization_version: normalizationVersion,
    blocks,
    warnings: normalizeWarnings(input.warnings),
  });
}

export function toExperienceExtractionInsertRow(snapshot: ExtractionSnapshot): ExperienceExtractionInsertRow {
  return {
    id: snapshot.extraction_snapshot_id,
    source_id: snapshot.source_id,
    text_sha256: snapshot.text_sha256,
    parser_version: snapshot.parser_version,
    normalization_version: snapshot.normalization_version,
    blocks: snapshot.blocks,
    warnings: snapshot.warnings,
  };
}

export function snapshotFromExperienceExtractionRow(
  row: ExperienceExtractionInsertRow,
  source: ExperienceExtractionSourceMetadata,
): ExtractionSnapshot {
  if (row.source_id !== source.sourceId) {
    throw new Error("Persisted extraction row belongs to a different source.");
  }

  return parseExtractionSnapshot({
    source_id: source.sourceId,
    extraction_snapshot_id: row.id,
    original_file_name: source.originalFileName,
    original_file_type: source.originalFileType,
    byte_sha256: source.byteSha256,
    text_sha256: row.text_sha256,
    parser_version: row.parser_version,
    normalization_version: row.normalization_version,
    blocks: row.blocks,
    warnings: row.warnings,
  });
}

function errorMessage(error: SupabaseErrorLike) {
  return error.message || error.code || error.name || "Unknown Supabase error";
}

function getSnapshotClient(client?: ExperienceExtractionSnapshotClient) {
  return client ?? (getSupabaseAdminClient() as unknown as ExperienceExtractionSnapshotClient);
}

export async function persistExperienceExtractionSnapshot(
  snapshot: ExtractionSnapshot,
  client?: ExperienceExtractionSnapshotClient,
): Promise<ExtractionSnapshot> {
  const supabase = getSnapshotClient(client);
  const row = toExperienceExtractionInsertRow(snapshot);
  const { error } = await supabase.from("experience_extractions").insert(row);

  if (error) {
    throw new Error(`Failed to persist experience extraction snapshot: ${errorMessage(error)}`);
  }

  return snapshot;
}
