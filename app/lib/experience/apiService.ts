import mammoth from "mammoth";
import { z } from "zod";
import { extractTextWithPdf2Json, extractTextWithPdftotext } from "../documentExtraction";
import { getSupabaseAdminClient } from "../supabaseServer";
import { ExperienceApiError } from "./apiRoutes";
import {
  buildCoverageReport,
  hashCanonicalRevisionContent,
  parseCanonicalExperienceRevision,
  resolveRevisionSourceReferences,
  StructuredExperienceExportSchema,
} from "./contracts";
import { convertLegacyDocToDocx } from "./docConversion";
import {
  persistExperienceDraft,
  recordExperienceParseFailure,
  type ExperienceDraftPersistenceClient,
} from "./draftPersistence";
import {
  buildExperienceExtractionSnapshot,
  persistExperienceExtractionSnapshot,
  snapshotFromExperienceExtractionRow,
  type ExperienceExtractionSnapshotClient,
} from "./extractionSnapshot";
import {
  EXPERIENCE_EMBEDDING_PREPARATION_BATCH_SIZE,
  EXPERIENCE_EMBEDDING_PREPARATION_TIMEOUT_MS,
  prepareExperienceEmbeddingBatch,
} from "./embeddingPreparation";
import {
  ExperienceValidationError,
  validateExperienceExtractedText,
  validateExperienceSourceFile,
  type ExperienceSourceFileDescriptor,
} from "./extractionValidation";
import { storeExperienceSourceFile, type ExperienceSourceStorageClient } from "./sourceStorage";
import { StructuredGenerationError, generateValidatedStructuredExperienceDraft } from "./structuredGeneration";
import { freezeApprovedExperienceIndexPlan } from "./parentPlanning";

export type ExperienceAction = "extract" | "parse" | "review" | "approve" | "index" | "retry";
export type ExperienceServiceClient = ReturnType<typeof getSupabaseAdminClient>;

interface SourceRow {
  id: string;
  original_byte_sha256: string;
  original_file_name: string;
  original_file_type: string;
  original_file_size: number;
  storage_bucket: string;
  storage_path: string;
  status: string;
  latest_extraction_id: string | null;
  latest_draft_revision_id: string | null;
  latest_approved_revision_id: string | null;
  active_revision_id: string | null;
  failure: unknown;
  cleanup_error: unknown;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  storage_uploaded_at?: string | null;
}

interface ExtractionRow {
  id: string;
  source_id: string;
  text_sha256: string;
  parser_version: string;
  normalization_version: string;
  blocks: unknown;
  warnings: unknown;
  created_at?: string;
}

interface RevisionRow {
  id: string;
  source_id: string;
  extraction_id: string;
  status: string;
  draft_json: unknown;
  draft_version: number;
  approved_json: unknown;
  approved_content_hash: string | null;
  model_version: string | null;
  prompt_version: string | null;
  parse_error: unknown;
  created_at?: string;
  updated_at?: string;
}

interface ExecutionLease {
  source_id: string;
  execution_token: string;
  execution_stage: string;
  execution_token_expires_at: string;
  status: string;
}

interface SupabaseErrorLike {
  code?: string;
  message?: string;
  name?: string;
}

interface DraftFieldError {
  path: string;
  code: string;
  message: string;
}

const SaveExperienceDraftRequestSchema = z.object({
  revision_id: z.string().min(1),
  expected_draft_version: z.number().int().positive(),
  draft: z.unknown(),
});

const ApproveExperienceRevisionRequestSchema = z.object({
  revision_id: z.string().min(1),
  expected_draft_version: z.number().int().positive(),
});

const CreateDraftFromApprovedRequestSchema = z.object({
  approved_revision_id: z.string().min(1).optional(),
});

const IndexExperienceRevisionRequestSchema = z.object({
  revision_id: z.string().min(1).optional(),
});

type ExecutionStage = "extracting" | "parsing" | "indexing";
type ExperienceEmbeddingFunction = NonNullable<Parameters<typeof prepareExperienceEmbeddingBatch>[0]["embed"]>;

export interface IndexExperienceRevisionOptions {
  batchSize?: number;
  maxDurationMs?: number;
  embed?: ExperienceEmbeddingFunction;
}

function getClient(client?: ExperienceServiceClient) {
  return client ?? getSupabaseAdminClient();
}

function errorMessage(error: SupabaseErrorLike) {
  return error.message || error.code || error.name || "Unknown Supabase error";
}

function safeCode(error: unknown) {
  if (error instanceof ExperienceApiError) {
    return error.code;
  }
  if (error instanceof ExperienceValidationError || error instanceof StructuredGenerationError) {
    return error.code;
  }
  return "experience-stage-failed";
}

function safeMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function normalizeRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function firstRow<T>(data: unknown): T | null {
  return normalizeRows<T>(data)[0] ?? null;
}

function sourceSummary(row: SourceRow) {
  return {
    id: row.id,
    file_name: row.original_file_name,
    file_type: row.original_file_type,
    file_size: row.original_file_size,
    byte_sha256: row.original_byte_sha256,
    status: row.status,
    latest_extraction_id: row.latest_extraction_id,
    latest_draft_revision_id: row.latest_draft_revision_id,
    latest_approved_revision_id: row.latest_approved_revision_id,
    active_revision_id: row.active_revision_id,
    failure: row.failure,
    cleanup_error: row.cleanup_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
    storage_uploaded_at: row.storage_uploaded_at ?? null,
    actions: availableExperienceActions(row.status),
  };
}

export function availableExperienceActions(status: string): ExperienceAction[] {
  switch (status) {
    case "uploaded":
      return ["extract"];
    case "extracted":
      return ["parse"];
    case "draft":
      return ["review", "parse"];
    case "approved":
      return ["index"];
    case "indexing":
      return ["index"];
    case "failed":
      return ["retry"];
    case "indexed":
      return ["review", "parse"];
    default:
      return [];
  }
}

async function getSourceRow(sourceId: string, client: ExperienceServiceClient): Promise<SourceRow> {
  const { data, error } = await client
    .from("experience_sources")
    .select("*")
    .eq("id", sourceId)
    .is("deleted_at", null)
    .limit(1);
  if (error) {
    throw new ExperienceApiError("source-read-failed", errorMessage(error), 500);
  }
  const row = firstRow<SourceRow>(data);
  if (!row) {
    throw new ExperienceApiError("source-not-found", "Experience source was not found.", 404);
  }
  return row;
}

async function listExtractionRows(sourceId: string, client: ExperienceServiceClient, limit = 5): Promise<ExtractionRow[]> {
  const { data, error } = await client
    .from("experience_extractions")
    .select("*")
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new ExperienceApiError("extractions-read-failed", errorMessage(error), 500);
  }
  return normalizeRows<ExtractionRow>(data);
}

async function listRevisionRows(sourceId: string, client: ExperienceServiceClient, limit = 5): Promise<RevisionRow[]> {
  const { data, error } = await client
    .from("experience_revisions")
    .select("*")
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    throw new ExperienceApiError("revisions-read-failed", errorMessage(error), 500);
  }
  return normalizeRows<RevisionRow>(data);
}

async function getExtractionRow(extractionId: string, sourceId: string, client: ExperienceServiceClient): Promise<ExtractionRow> {
  const { data, error } = await client
    .from("experience_extractions")
    .select("*")
    .eq("id", extractionId)
    .eq("source_id", sourceId)
    .limit(1);
  if (error) {
    throw new ExperienceApiError("extraction-read-failed", errorMessage(error), 500);
  }
  const row = firstRow<ExtractionRow>(data);
  if (!row) {
    throw new ExperienceApiError("extraction-not-found", "Experience extraction snapshot was not found.", 404);
  }
  return row;
}

async function getRevisionRow(revisionId: string, sourceId: string, client: ExperienceServiceClient): Promise<RevisionRow> {
  const { data, error } = await client
    .from("experience_revisions")
    .select("*")
    .eq("id", revisionId)
    .eq("source_id", sourceId)
    .limit(1);
  if (error) {
    throw new ExperienceApiError("revision-read-failed", errorMessage(error), 500);
  }
  const row = firstRow<RevisionRow>(data);
  if (!row) {
    throw new ExperienceApiError("revision-not-found", "Experience draft revision was not found.", 404);
  }
  return row;
}

async function getSnapshotForRevisionRow(source: SourceRow, revision: RevisionRow, client: ExperienceServiceClient) {
  const extractionRow = await getExtractionRow(revision.extraction_id, source.id, client);
  return snapshotFromExperienceExtractionRow(
    {
      id: extractionRow.id,
      source_id: extractionRow.source_id,
      text_sha256: extractionRow.text_sha256,
      parser_version: extractionRow.parser_version,
      normalization_version: extractionRow.normalization_version,
      blocks: extractionRow.blocks as never,
      warnings: extractionRow.warnings as never,
    },
    {
      sourceId: source.id,
      originalFileName: source.original_file_name,
      originalFileType: source.original_file_type,
      byteSha256: source.original_byte_sha256,
    },
  );
}

function fieldError(path: string, code: string, message: string): DraftFieldError {
  return { path, code, message };
}

function throwDraftValidation(errors: DraftFieldError[]): never {
  throw new ExperienceApiError("draft-validation-failed", "Experience draft could not be saved.", 422, {
    field_errors: errors,
  });
}

function isAcceptedRevisionStatus(status: string): boolean {
  return status === "approved" || status === "indexing" || status === "indexed";
}

function zodFieldErrors(error: z.ZodError): DraftFieldError[] {
  return error.issues.map((issue) =>
    fieldError(issue.path.join(".") || "draft", "invalid-draft-field", issue.message),
  );
}

async function acquireExecution(sourceId: string, stage: ExecutionStage, client: ExperienceServiceClient) {
  const { data, error } = await client.rpc("acquire_experience_source_execution", {
    p_source_id: sourceId,
    p_stage: stage,
    p_lease_seconds: stage === "extracting" ? 90 : 180,
  });
  if (error) {
    throw new ExperienceApiError("execution-conflict", errorMessage(error), 409);
  }
  const lease = firstRow<ExecutionLease>(data) ?? (data as ExecutionLease | null);
  if (!lease?.execution_token) {
    throw new ExperienceApiError("execution-not-acquired", "Experience execution lease was not acquired.", 409);
  }
  return lease;
}

async function completeFailedExecution(
  sourceId: string,
  token: string,
  stage: ExecutionStage,
  error: unknown,
  client: ExperienceServiceClient,
) {
  await client.rpc("complete_experience_source_execution", {
    p_source_id: sourceId,
    p_execution_token: token,
    p_stage: stage,
    p_next_status: "failed",
    p_latest_extraction_id: null,
    p_latest_draft_revision_id: null,
    p_failure: {
      stage: stage === "extracting" ? "extraction" : stage,
      code: safeCode(error),
      message: safeMessage(error, `${stage} failed.`),
      recoverable_action: stage === "extracting" ? "retry-extract" : stage === "parsing" ? "retry-parse" : "retry-index",
    },
  });
}

async function completeIndexingExecution(
  sourceId: string,
  token: string,
  nextStatus: "indexing" | "indexed" | "approved",
  client: ExperienceServiceClient,
  failure: Record<string, unknown> | null = null,
) {
  const { error } = await client.rpc("complete_experience_source_execution", {
    p_source_id: sourceId,
    p_execution_token: token,
    p_stage: "indexing",
    p_next_status: nextStatus,
    p_latest_extraction_id: null,
    p_latest_draft_revision_id: null,
    p_failure: failure,
  });
  if (error) {
    throw new ExperienceApiError("index-completion-failed", errorMessage(error), 409);
  }
}

async function downloadPrivateSource(row: SourceRow, client: ExperienceServiceClient): Promise<Buffer> {
  const { data, error } = await client.storage.from(row.storage_bucket).download(row.storage_path);
  if (error || !data) {
    throw new ExperienceApiError("source-file-unavailable", error ? errorMessage(error) : "Private source file is unavailable.", 404);
  }
  return Buffer.from(await data.arrayBuffer());
}

async function extractTextForExperienceSource(buffer: Buffer, descriptor: ExperienceSourceFileDescriptor) {
  if (descriptor.kind === "pdf") {
    const text = (await extractTextWithPdftotext(buffer)) || (await extractTextWithPdf2Json(buffer));
    return {
      segments: [{ text, locator: { kind: "unknown" as const } }],
      warnings: [],
    };
  }

  if (descriptor.kind === "doc") {
    const converted = await convertLegacyDocToDocx({
      bytes: buffer,
      sourceFileName: descriptor.fileName,
      sourceFileType: descriptor.fileType,
    });
    const result = await mammoth.extractRawText({ buffer: converted.bytes });
    return {
      segments: [{ text: result.value, locator: { kind: "unknown" as const } }],
      warnings: result.messages.map((message) => message.message).filter(Boolean),
    };
  }

  const result = await mammoth.extractRawText({ buffer });
  return {
    segments: [{ text: result.value, locator: { kind: "unknown" as const } }],
    warnings: result.messages.map((message) => message.message).filter(Boolean),
  };
}

export async function uploadExperienceSourceFromFile(file: File, client?: ExperienceServiceClient) {
  if (!file) {
    throw new ExperienceApiError("file-required", "Experience source file is required.", 400);
  }
  const supabase = getClient(client);
  const bytes = Buffer.from(await file.arrayBuffer());
  validateExperienceSourceFile({
    bytes,
    fileName: file.name,
    fileType: file.type,
  });
  const stored = await storeExperienceSourceFile(
    {
      bytes,
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
    },
    supabase as unknown as ExperienceSourceStorageClient,
  );

  return {
    source: {
      id: stored.id,
      file_name: stored.originalFileName,
      file_type: stored.originalFileType,
      file_size: stored.originalFileSize,
      byte_sha256: stored.originalByteSha256,
      status: stored.status,
      storage_uploaded_at: stored.storage.uploadedAt,
      actions: availableExperienceActions(stored.status),
    },
    upload_state: stored.uploadState,
    next_action: stored.status === "uploaded" ? "extract" : availableExperienceActions(stored.status)[0] ?? null,
  };
}

export async function listExperienceSources(client?: ExperienceServiceClient) {
  const supabase = getClient(client);
  const { data, error } = await supabase
    .from("experience_sources")
    .select("*")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    throw new ExperienceApiError("sources-read-failed", errorMessage(error), 500);
  }
  return { sources: normalizeRows<SourceRow>(data).map(sourceSummary) };
}

export async function getExperienceSourceDetail(sourceId: string, client?: ExperienceServiceClient) {
  const supabase = getClient(client);
  const source = await getSourceRow(sourceId, supabase);
  const [extractions, revisions] = await Promise.all([
    listExtractionRows(sourceId, supabase),
    listRevisionRows(sourceId, supabase),
  ]);

  return {
    source: sourceSummary(source),
    latest_extraction: extractions[0] ?? null,
    latest_revision: revisions[0] ?? null,
    revisions,
  };
}

export async function extractExperienceSource(sourceId: string, client?: ExperienceServiceClient) {
  const supabase = getClient(client);
  const lease = await acquireExecution(sourceId, "extracting", supabase);
  try {
    const source = await getSourceRow(sourceId, supabase);
    const buffer = await downloadPrivateSource(source, supabase);
    const descriptor = validateExperienceSourceFile({
      bytes: buffer,
      fileName: source.original_file_name,
      fileType: source.original_file_type,
    });
    const extracted = await extractTextForExperienceSource(buffer, descriptor);
    const text = extracted.segments.map((segment) => segment.text).join("\n\n");
    validateExperienceExtractedText({ text, sourceKind: descriptor.kind });
    const snapshot = buildExperienceExtractionSnapshot({
      sourceId: source.id,
      originalFileName: source.original_file_name,
      originalFileType: source.original_file_type,
      byteSha256: source.original_byte_sha256,
      segments: extracted.segments,
      warnings: extracted.warnings,
    });
    await persistExperienceExtractionSnapshot(snapshot, supabase as unknown as ExperienceExtractionSnapshotClient);
    const { error } = await supabase.rpc("complete_experience_source_execution", {
      p_source_id: sourceId,
      p_execution_token: lease.execution_token,
      p_stage: "extracting",
      p_next_status: "extracted",
      p_latest_extraction_id: snapshot.extraction_snapshot_id,
      p_latest_draft_revision_id: null,
      p_failure: null,
    });
    if (error) {
      throw new ExperienceApiError("extract-completion-failed", errorMessage(error), 409);
    }
    return {
      source_id: sourceId,
      status: "extracted",
      extraction: {
        extraction_snapshot_id: snapshot.extraction_snapshot_id,
        text_sha256: snapshot.text_sha256,
        blocks: snapshot.blocks.length,
        warnings: snapshot.warnings,
      },
      next_action: "parse",
    };
  } catch (error) {
    await completeFailedExecution(sourceId, lease.execution_token, "extracting", error, supabase);
    throw error;
  }
}

export async function parseExperienceSource(sourceId: string, client?: ExperienceServiceClient) {
  const supabase = getClient(client);
  const lease = await acquireExecution(sourceId, "parsing", supabase);
  try {
    const source = await getSourceRow(sourceId, supabase);
    const extractions = await listExtractionRows(sourceId, supabase, 1);
    const latestExtraction = extractions[0];
    if (!latestExtraction) {
      throw new ExperienceApiError("extraction-required", "Experience source must be extracted before parsing.", 409);
    }
    const snapshot = snapshotFromExperienceExtractionRow(
      {
        id: latestExtraction.id,
        source_id: latestExtraction.source_id,
        text_sha256: latestExtraction.text_sha256,
        parser_version: latestExtraction.parser_version,
        normalization_version: latestExtraction.normalization_version,
        blocks: latestExtraction.blocks as never,
        warnings: latestExtraction.warnings as never,
      },
      {
        sourceId: source.id,
        originalFileName: source.original_file_name,
        originalFileType: source.original_file_type,
        byteSha256: source.original_byte_sha256,
      },
    );
    const generated = await generateValidatedStructuredExperienceDraft({
      snapshot,
      revisionId: crypto.randomUUID(),
    });
    const draftJson = await persistExperienceDraft(
      {
        sourceId,
        executionToken: lease.execution_token,
        snapshot,
        draft: generated.draft,
        generation: generated.generation,
        repairAttempted: generated.repairAttempted,
      },
      supabase as unknown as ExperienceDraftPersistenceClient,
    );
    return {
      source_id: sourceId,
      status: "draft",
      revision_id: generated.draft.revision.revision_id,
      draft_version: generated.draft.revision.draft_version,
      repair_attempted: generated.repairAttempted,
      omitted_block_coverage: draftJson.omitted_block_coverage,
      next_action: "review",
    };
  } catch (error) {
    await recordExperienceParseFailure(
      {
        sourceId,
        executionToken: lease.execution_token,
        code: safeCode(error),
        message: safeMessage(error, "Experience parsing failed."),
      },
      supabase as unknown as ExperienceDraftPersistenceClient,
    );
    throw error;
  }
}

export async function saveExperienceDraft(sourceId: string, body: unknown, client?: ExperienceServiceClient) {
  const supabase = getClient(client);
  let request: z.infer<typeof SaveExperienceDraftRequestSchema>;
  try {
    request = SaveExperienceDraftRequestSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throwDraftValidation(zodFieldErrors(error));
    }
    throw error;
  }

  const source = await getSourceRow(sourceId, supabase);
  const existingRevision = await getRevisionRow(request.revision_id, sourceId, supabase);
  const extractionRow = await getExtractionRow(existingRevision.extraction_id, sourceId, supabase);
  const snapshot = snapshotFromExperienceExtractionRow(
    {
      id: extractionRow.id,
      source_id: extractionRow.source_id,
      text_sha256: extractionRow.text_sha256,
      parser_version: extractionRow.parser_version,
      normalization_version: extractionRow.normalization_version,
      blocks: extractionRow.blocks as never,
      warnings: extractionRow.warnings as never,
    },
    {
      sourceId: source.id,
      originalFileName: source.original_file_name,
      originalFileType: source.original_file_type,
      byteSha256: source.original_byte_sha256,
    },
  );

  const fieldErrors: DraftFieldError[] = [];
  let draft: ReturnType<typeof parseCanonicalExperienceRevision> | null = null;
  try {
    draft = parseCanonicalExperienceRevision(request.draft);
  } catch (error) {
    if (error instanceof z.ZodError) {
      fieldErrors.push(...zodFieldErrors(error));
    } else {
      fieldErrors.push(fieldError("draft", "invalid-draft", safeMessage(error, "Draft is invalid.")));
    }
  }

  if (draft) {
    if (draft.source.source_id !== sourceId) {
      fieldErrors.push(fieldError("source.source_id", "source-mismatch", "Draft source does not match the route source."));
    }
    if (draft.extraction.extraction_snapshot_id !== snapshot.extraction_snapshot_id) {
      fieldErrors.push(
        fieldError("extraction.extraction_snapshot_id", "extraction-mismatch", "Draft extraction snapshot does not match the revision."),
      );
    }
    if (draft.extraction.text_sha256 !== snapshot.text_sha256) {
      fieldErrors.push(fieldError("extraction.text_sha256", "text-hash-mismatch", "Draft text hash does not match the retained extraction."));
    }
    if (draft.revision.revision_id !== request.revision_id) {
      fieldErrors.push(fieldError("revision.revision_id", "revision-mismatch", "Draft revision ID does not match the requested revision."));
    }
    if (draft.revision.status !== "draft") {
      fieldErrors.push(fieldError("revision.status", "draft-status-required", "Only draft revisions can be saved."));
    }
    if (draft.revision.draft_version !== request.expected_draft_version) {
      fieldErrors.push(fieldError("revision.draft_version", "draft-version-mismatch", "Draft version does not match the expected save version."));
    }
    const evidenceCount = draft.experiences.reduce((count, experience) => count + experience.evidence_items.length, 0);
    if (evidenceCount === 0) {
      fieldErrors.push(fieldError("experiences", "no-usable-evidence", "Draft must contain at least one source-grounded evidence item."));
    }

    try {
      const coverage = buildCoverageReport(snapshot, draft);
      if (snapshot.warnings.length > 0 && !draft.review_acknowledgements.warnings) {
        fieldErrors.push(fieldError("review_acknowledgements.warnings", "warnings-unacknowledged", "Extraction warnings must be acknowledged before saving."));
      }
      if (coverage.unreferencedBlocks.length > 0 && !draft.review_acknowledgements.unassigned_blocks) {
        fieldErrors.push(
          fieldError("review_acknowledgements.unassigned_blocks", "unassigned-blocks-unacknowledged", "Unassigned source blocks must be acknowledged before saving."),
        );
      }
    } catch (error) {
      fieldErrors.push(fieldError("experiences", "invalid-source-selection", safeMessage(error, "Draft source references are invalid.")));
    }
  }

  if (fieldErrors.length > 0 || !draft) {
    throwDraftValidation(fieldErrors);
  }

  const persistedDraft = parseCanonicalExperienceRevision({
    ...draft,
    revision: {
      ...draft.revision,
      draft_version: request.expected_draft_version + 1,
    },
  });
  const omittedBlockCoverage = buildCoverageReport(snapshot, persistedDraft);
  const draftJson = {
    canonical_revision: persistedDraft,
    parsing_checkpoints: [
      {
        stage: "canonical-validation",
        status: "completed",
        detail: {
          source_refs_resolved: true,
          saved_from_review: true,
        },
      },
    ],
    source_warnings: snapshot.warnings,
    omitted_block_coverage: omittedBlockCoverage,
  };

  const { data, error } = await supabase.rpc("update_experience_revision_draft", {
    p_revision_id: request.revision_id,
    p_expected_draft_version: request.expected_draft_version,
    p_draft_json: draftJson,
  });
  if (error) {
    const message = errorMessage(error);
    if (error.code === "40001" || message.toLowerCase().includes("conflict")) {
      throw new ExperienceApiError("draft-version-conflict", message, 409);
    }
    throw new ExperienceApiError("draft-save-failed", message, 500);
  }

  const updatedRevision = (firstRow<RevisionRow>(data) ?? (data as RevisionRow | null)) || {
    id: request.revision_id,
    draft_version: request.expected_draft_version + 1,
  };
  return {
    source_id: sourceId,
    revision_id: request.revision_id,
    draft_version: updatedRevision.draft_version,
    omitted_block_coverage: omittedBlockCoverage,
    next_action: "review",
  };
}

export async function approveExperienceRevision(sourceId: string, body: unknown, client?: ExperienceServiceClient) {
  const supabase = getClient(client);
  let request: z.infer<typeof ApproveExperienceRevisionRequestSchema>;
  try {
    request = ApproveExperienceRevisionRequestSchema.parse(body);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throwDraftValidation(zodFieldErrors(error));
    }
    throw error;
  }

  const source = await getSourceRow(sourceId, supabase);
  if (source.latest_draft_revision_id !== request.revision_id) {
    throw new ExperienceApiError(
      "approval-candidate-stale",
      "Approval must target the latest saved draft revision for this source.",
      409,
    );
  }

  const existingRevision = await getRevisionRow(request.revision_id, sourceId, supabase);
  if (existingRevision.status !== "draft" || existingRevision.approved_content_hash) {
    throw new ExperienceApiError("revision-approval-conflict", "Only an unapproved draft revision can be approved.", 409);
  }
  if (existingRevision.draft_version !== request.expected_draft_version) {
    throw new ExperienceApiError("approval-version-conflict", "Draft version changed after review.", 409);
  }

  const extractionRow = await getExtractionRow(existingRevision.extraction_id, sourceId, supabase);
  const snapshot = snapshotFromExperienceExtractionRow(
    {
      id: extractionRow.id,
      source_id: extractionRow.source_id,
      text_sha256: extractionRow.text_sha256,
      parser_version: extractionRow.parser_version,
      normalization_version: extractionRow.normalization_version,
      blocks: extractionRow.blocks as never,
      warnings: extractionRow.warnings as never,
    },
    {
      sourceId: source.id,
      originalFileName: source.original_file_name,
      originalFileType: source.original_file_type,
      byteSha256: source.original_byte_sha256,
    },
  );

  const fieldErrors: DraftFieldError[] = [];
  const draftJson = existingRevision.draft_json as { canonical_revision?: unknown } | null;
  let draft: ReturnType<typeof parseCanonicalExperienceRevision> | null = null;
  try {
    draft = parseCanonicalExperienceRevision(draftJson?.canonical_revision);
  } catch (error) {
    if (error instanceof z.ZodError) {
      fieldErrors.push(...zodFieldErrors(error));
    } else {
      fieldErrors.push(fieldError("draft", "invalid-draft", safeMessage(error, "Draft is invalid.")));
    }
  }

  if (draft) {
    if (draft.source.source_id !== sourceId) {
      fieldErrors.push(fieldError("source.source_id", "source-mismatch", "Draft source does not match the route source."));
    }
    if (draft.extraction.extraction_snapshot_id !== snapshot.extraction_snapshot_id) {
      fieldErrors.push(
        fieldError("extraction.extraction_snapshot_id", "extraction-mismatch", "Draft extraction snapshot does not match the revision."),
      );
    }
    if (draft.extraction.text_sha256 !== snapshot.text_sha256) {
      fieldErrors.push(fieldError("extraction.text_sha256", "text-hash-mismatch", "Draft text hash does not match the retained extraction."));
    }
    if (draft.revision.revision_id !== request.revision_id) {
      fieldErrors.push(fieldError("revision.revision_id", "revision-mismatch", "Draft revision ID does not match the requested revision."));
    }
    if (draft.revision.status !== "draft") {
      fieldErrors.push(fieldError("revision.status", "draft-status-required", "Only draft revisions can be approved."));
    }
    if (draft.revision.draft_version !== request.expected_draft_version) {
      fieldErrors.push(fieldError("revision.draft_version", "draft-version-mismatch", "Draft version does not match the expected approval version."));
    }
    const evidenceCount = draft.experiences.reduce((count, experience) => count + experience.evidence_items.length, 0);
    if (evidenceCount === 0) {
      fieldErrors.push(fieldError("experiences", "no-usable-evidence", "Draft must contain at least one source-grounded evidence item."));
    }

    try {
      const coverage = buildCoverageReport(snapshot, draft);
      if (snapshot.warnings.length > 0 && !draft.review_acknowledgements.warnings) {
        fieldErrors.push(fieldError("review_acknowledgements.warnings", "warnings-unacknowledged", "Extraction warnings must be acknowledged before approval."));
      }
      if (coverage.unreferencedBlocks.length > 0 && !draft.review_acknowledgements.unassigned_blocks) {
        fieldErrors.push(
          fieldError("review_acknowledgements.unassigned_blocks", "unassigned-blocks-unacknowledged", "Unassigned source blocks must be acknowledged before approval."),
        );
      }
    } catch (error) {
      fieldErrors.push(fieldError("experiences", "invalid-source-selection", safeMessage(error, "Draft source references are invalid.")));
    }
  }

  if (fieldErrors.length > 0 || !draft) {
    throwDraftValidation(fieldErrors);
  }

  const approvedContentHash = hashCanonicalRevisionContent(draft);
  const approvedRevision = parseCanonicalExperienceRevision({
    ...draft,
    revision: {
      ...draft.revision,
      status: "approved",
      draft_version: request.expected_draft_version,
      approved_content_hash: approvedContentHash,
    },
  });

  const { data, error } = await supabase.rpc("approve_experience_revision", {
    p_source_id: sourceId,
    p_revision_id: request.revision_id,
    p_expected_draft_version: request.expected_draft_version,
    p_approved_json: approvedRevision,
    p_approved_content_hash: approvedContentHash,
  });
  if (error) {
    const message = errorMessage(error);
    if (error.code === "40001" || message.toLowerCase().includes("stale") || message.toLowerCase().includes("conflict")) {
      throw new ExperienceApiError("approval-version-conflict", message, 409);
    }
    throw new ExperienceApiError("approval-failed", message, 500);
  }

  const approvedRow = (firstRow<RevisionRow>(data) ?? (data as RevisionRow | null)) || {
    id: request.revision_id,
    draft_version: request.expected_draft_version,
    approved_content_hash: approvedContentHash,
  };
  return {
    source_id: sourceId,
    revision_id: request.revision_id,
    status: "approved",
    draft_version: approvedRow.draft_version,
    approved_content_hash: approvedRow.approved_content_hash ?? approvedContentHash,
    next_action: "index",
  };
}

function isConflictLike(error: SupabaseErrorLike) {
  const message = errorMessage(error).toLowerCase();
  return (
    error.code === "40001" ||
    message.includes("stale") ||
    message.includes("conflict") ||
    message.includes("deleted") ||
    message.includes("unavailable") ||
    message.includes("mismatch")
  );
}

export async function indexExperienceRevision(
  sourceId: string,
  body: unknown = {},
  client?: ExperienceServiceClient,
  options: IndexExperienceRevisionOptions = {},
) {
  const supabase = getClient(client);
  let request: z.infer<typeof IndexExperienceRevisionRequestSchema>;
  try {
    request = IndexExperienceRevisionRequestSchema.parse(body ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) {
      throwDraftValidation(zodFieldErrors(error));
    }
    throw error;
  }

  const source = await getSourceRow(sourceId, supabase);
  const revisionId = request.revision_id ?? source.latest_approved_revision_id ?? source.active_revision_id;
  if (!revisionId) {
    throw new ExperienceApiError("approved-revision-required", "An approved experience revision is required before indexing.", 409);
  }
  if (source.latest_approved_revision_id && source.latest_approved_revision_id !== revisionId) {
    throw new ExperienceApiError("index-candidate-stale", "Indexing must target the latest approved revision for this source.", 409);
  }

  const revisionRow = await getRevisionRow(revisionId, sourceId, supabase);
  if (!isAcceptedRevisionStatus(revisionRow.status) || !revisionRow.approved_json || !revisionRow.approved_content_hash) {
    throw new ExperienceApiError("revision-not-approved", "Only approved experience revisions can be indexed.", 409);
  }

  const snapshot = await getSnapshotForRevisionRow(source, revisionRow, supabase);
  const approvedRevision = parseCanonicalExperienceRevision(revisionRow.approved_json);
  const approvedHash = hashCanonicalRevisionContent(approvedRevision);
  if (approvedHash !== revisionRow.approved_content_hash || approvedRevision.revision.approved_content_hash !== approvedHash) {
    throw new ExperienceApiError("approved-hash-mismatch", "Retained approved revision hash does not match its content.", 409);
  }

  const frozenPlan = freezeApprovedExperienceIndexPlan({ snapshot, revision: approvedRevision });
  const progressBase = {
    revision_id: revisionId,
    plan_hash: frozenPlan.plan_hash,
    approved_content_hash: frozenPlan.approved_content_hash,
    total_chunks: frozenPlan.expected_child_count,
    expected_parent_count: frozenPlan.expected_parent_count,
    expected_child_count: frozenPlan.expected_child_count,
    preparation_config: frozenPlan.preparation_config,
  };

  if (source.active_revision_id === revisionId && revisionRow.status === "indexed") {
    return {
      source_id: sourceId,
      revision_id: revisionId,
      status: "indexed",
      already_published: true,
      progress: {
        ...progressBase,
        prepared_chunks: frozenPlan.expected_child_count,
        remaining_chunks: 0,
        newly_prepared_chunks: 0,
        previously_prepared_chunks: frozenPlan.expected_child_count,
      },
      publication: {
        status: "indexed",
        already_published: true,
        active_revision_id: revisionId,
        parent_count: frozenPlan.expected_parent_count,
        child_count: frozenPlan.expected_child_count,
        plan_hash: frozenPlan.plan_hash,
      },
      next_action: null,
    };
  }

  const lease = await acquireExecution(sourceId, "indexing", supabase);
  try {
    const preparation = await prepareExperienceEmbeddingBatch({
      snapshot,
      revision: approvedRevision,
      client: supabase,
      batchSize: options.batchSize ?? EXPERIENCE_EMBEDDING_PREPARATION_BATCH_SIZE,
      maxDurationMs: options.maxDurationMs ?? EXPERIENCE_EMBEDDING_PREPARATION_TIMEOUT_MS,
      embed: options.embed,
    });

    const progress = {
      ...progressBase,
      prepared_chunks: preparation.prepared_chunks,
      remaining_chunks: preparation.remaining_chunks,
      newly_prepared_chunks: preparation.newly_prepared_chunks,
      previously_prepared_chunks: preparation.previously_prepared_chunks,
      prepared_chunk_keys: preparation.prepared_chunk_keys,
      next_chunk_keys: preparation.next_chunk_keys,
    };

    if (preparation.remaining_chunks > 0) {
      await completeIndexingExecution(sourceId, lease.execution_token, "indexing", supabase);
      return {
        source_id: sourceId,
        revision_id: revisionId,
        status: "indexing",
        stage: "embedding-preparation",
        progress,
        publication: null,
        next_action: "index",
      };
    }

    const { data, error } = await supabase.rpc("publish_experience_revision", {
      p_source_id: sourceId,
      p_revision_id: revisionId,
      p_plan_hash: preparation.plan_hash,
      p_approved_content_hash: preparation.approved_content_hash,
      p_expected_parent_count: preparation.frozen_plan.expected_parent_count,
      p_expected_child_count: preparation.frozen_plan.expected_child_count,
      p_chunking_version: preparation.frozen_plan.preparation_config.chunking_version,
      p_embedding_model: preparation.frozen_plan.preparation_config.embedding_model,
      p_embedding_task_type: preparation.frozen_plan.preparation_config.embedding_task_type,
      p_embedding_dimensions: preparation.frozen_plan.preparation_config.embedding_dimensions,
    });
    if (error) {
      const failure = {
        stage: "indexing",
        code: isConflictLike(error) ? "index-publication-conflict" : "index-publication-failed",
        message: errorMessage(error),
        recoverable_action: "retry-index",
      };
      await completeIndexingExecution(sourceId, lease.execution_token, "approved", supabase, failure);
      throw new ExperienceApiError(
        isConflictLike(error) ? "index-publication-conflict" : "index-publication-failed",
        errorMessage(error),
        isConflictLike(error) ? 409 : 500,
      );
    }

    await completeIndexingExecution(sourceId, lease.execution_token, "indexed", supabase);
    const publication = (firstRow<Record<string, unknown>>(data) ?? (data as Record<string, unknown> | null)) || {
      status: "indexed",
      already_published: false,
      revision_id: revisionId,
      active_revision_id: revisionId,
      parent_count: preparation.frozen_plan.expected_parent_count,
      child_count: preparation.frozen_plan.expected_child_count,
      plan_hash: preparation.plan_hash,
    };

    return {
      source_id: sourceId,
      revision_id: revisionId,
      status: "indexed",
      stage: "published",
      progress,
      publication,
      next_action: null,
    };
  } catch (error) {
    if (error instanceof ExperienceApiError && error.code.startsWith("index-publication-")) {
      throw error;
    }
    await completeFailedExecution(sourceId, lease.execution_token, "indexing", error, supabase);
    throw error;
  }
}

export async function createDraftFromApprovedRevision(sourceId: string, body: unknown = {}, client?: ExperienceServiceClient) {
  const supabase = getClient(client);
  let request: z.infer<typeof CreateDraftFromApprovedRequestSchema>;
  try {
    request = CreateDraftFromApprovedRequestSchema.parse(body ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) {
      throwDraftValidation(zodFieldErrors(error));
    }
    throw error;
  }

  const source = await getSourceRow(sourceId, supabase);
  const approvedRevisionId = request.approved_revision_id ?? source.latest_approved_revision_id ?? source.active_revision_id;
  if (!approvedRevisionId) {
    throw new ExperienceApiError("approved-revision-required", "An approved experience revision is required before creating an edit draft.", 409);
  }

  const approvedRow = await getRevisionRow(approvedRevisionId, sourceId, supabase);
  if (!isAcceptedRevisionStatus(approvedRow.status) || !approvedRow.approved_json || !approvedRow.approved_content_hash) {
    throw new ExperienceApiError("revision-not-approved", "Only retained approved revisions can be used to create an edit draft.", 409);
  }

  const snapshot = await getSnapshotForRevisionRow(source, approvedRow, supabase);
  const approvedRevision = parseCanonicalExperienceRevision(approvedRow.approved_json);
  const approvedHash = hashCanonicalRevisionContent(approvedRevision);
  if (approvedHash !== approvedRow.approved_content_hash) {
    throw new ExperienceApiError("approved-hash-mismatch", "Retained approved revision hash does not match its content.", 409);
  }

  const draftRevisionId = crypto.randomUUID();
  const draft = parseCanonicalExperienceRevision({
    ...approvedRevision,
    revision: {
      ...approvedRevision.revision,
      revision_id: draftRevisionId,
      status: "draft",
      draft_version: 1,
      approved_content_hash: null,
    },
  });
  const draftJson = {
    canonical_revision: draft,
    parsing_checkpoints: [
      {
        stage: "canonical-validation",
        status: "completed",
        detail: {
          source_refs_resolved: true,
          cloned_from_approved_revision_id: approvedRevisionId,
          cloned_from_approved_content_hash: approvedRow.approved_content_hash,
        },
      },
    ],
    source_warnings: snapshot.warnings,
    omitted_block_coverage: buildCoverageReport(snapshot, draft),
  };

  const { data, error } = await supabase.rpc("create_experience_draft_from_approved", {
    p_source_id: sourceId,
    p_approved_revision_id: approvedRevisionId,
    p_new_revision_id: draftRevisionId,
    p_draft_json: draftJson,
    p_draft_version: 1,
  });
  if (error) {
    const message = errorMessage(error);
    if (error.code === "40001" || message.toLowerCase().includes("conflict")) {
      throw new ExperienceApiError("draft-create-conflict", message, 409);
    }
    throw new ExperienceApiError("draft-create-failed", message, 500);
  }

  const draftRow = (firstRow<RevisionRow>(data) ?? (data as RevisionRow | null)) || {
    id: draftRevisionId,
    draft_version: 1,
  };
  return {
    source_id: sourceId,
    revision_id: draftRow.id,
    draft_version: draftRow.draft_version,
    cloned_from_revision_id: approvedRevisionId,
    cloned_from_content_hash: approvedRow.approved_content_hash,
    next_action: "review",
  };
}

export async function getExperienceRevisionExport(sourceId: string, revisionId: string, client?: ExperienceServiceClient) {
  const supabase = getClient(client);
  const source = await getSourceRow(sourceId, supabase);
  const revisionRow = await getRevisionRow(revisionId, sourceId, supabase);
  if (!isAcceptedRevisionStatus(revisionRow.status) || !revisionRow.approved_json || !revisionRow.approved_content_hash) {
    throw new ExperienceApiError("revision-export-unavailable", "Only retained approved revisions can be exported.", 409);
  }

  const snapshot = await getSnapshotForRevisionRow(source, revisionRow, supabase);
  const approvedRevision = parseCanonicalExperienceRevision(revisionRow.approved_json);
  const contentHash = hashCanonicalRevisionContent(approvedRevision);
  if (contentHash !== revisionRow.approved_content_hash) {
    throw new ExperienceApiError("approved-hash-mismatch", "Retained approved revision hash does not match its content.", 409);
  }

  return StructuredExperienceExportSchema.parse({
    revision: approvedRevision,
    source_blocks: snapshot.blocks,
    content_hash: contentHash,
    exported_at: new Date().toISOString(),
    resolved_source_refs: resolveRevisionSourceReferences(snapshot, approvedRevision),
    configuration_versions: {
      schema: approvedRevision.schema_version,
      parser: snapshot.parser_version,
      prompt: approvedRevision.revision.prompt_version,
      model: approvedRevision.revision.model_version,
      chunking: null,
      embedding: null,
    },
  });
}

export async function getExperienceSourceFile(sourceId: string, client?: ExperienceServiceClient) {
  const supabase = getClient(client);
  const source = await getSourceRow(sourceId, supabase);
  const bytes = await downloadPrivateSource(source, supabase);
  return {
    source_id: sourceId,
    file_name: source.original_file_name,
    file_type: source.original_file_type || "application/octet-stream",
    file_size: source.original_file_size,
    bytes,
  };
}
