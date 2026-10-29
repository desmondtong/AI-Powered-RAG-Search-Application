import { getSupabaseAdminClient } from "../supabaseServer";
import {
  buildCoverageReport,
  type CanonicalExperienceRevision,
  type CoverageReport,
  type ExtractionSnapshot,
} from "./contracts";
import type { StructuredExperienceGenerationResult } from "./structuredGeneration";

export type ExperienceParsingCheckpointStage = "structured-generation" | "repair" | "canonical-validation";
export type ExperienceParsingCheckpointStatus = "completed" | "failed";

export interface ExperienceParsingCheckpoint {
  stage: ExperienceParsingCheckpointStage;
  status: ExperienceParsingCheckpointStatus;
  detail: Record<string, unknown>;
}

export interface PersistedExperienceDraftJson {
  canonical_revision: CanonicalExperienceRevision;
  parsing_checkpoints: ExperienceParsingCheckpoint[];
  source_warnings: string[];
  omitted_block_coverage: CoverageReport;
}

export interface PersistExperienceDraftInput {
  sourceId: string;
  executionToken: string;
  snapshot: ExtractionSnapshot;
  draft: CanonicalExperienceRevision;
  generation: StructuredExperienceGenerationResult;
  repairAttempted: boolean;
  checkpoints?: ExperienceParsingCheckpoint[];
}

export interface RecordExperienceParseFailureInput {
  sourceId: string;
  executionToken: string;
  code: string;
  message: string;
  modelVersion?: string | null;
  promptVersion?: string | null;
  recoverableAction?: string;
}

export interface ExperienceRevisionInsertRow {
  id: string;
  source_id: string;
  extraction_id: string;
  status: "draft";
  draft_json: PersistedExperienceDraftJson;
  draft_version: number;
  model_version: string | null;
  prompt_version: string | null;
  parse_error: null;
}

interface SupabaseErrorLike {
  code?: string;
  message?: string;
  name?: string;
}

interface SupabaseResponse {
  data: unknown;
  error: SupabaseErrorLike | null;
}

interface InsertBuilder {
  select(columns?: string): {
    single(): Promise<SupabaseResponse>;
  };
}

export interface ExperienceDraftPersistenceClient {
  from(table: "experience_revisions"): {
    insert(row: ExperienceRevisionInsertRow): InsertBuilder;
  };
  rpc(functionName: "complete_experience_source_execution", args: Record<string, unknown>): Promise<SupabaseResponse>;
}

function errorMessage(error: SupabaseErrorLike) {
  return error.message || error.code || error.name || "Unknown Supabase error";
}

function getPersistenceClient(client?: ExperienceDraftPersistenceClient) {
  return client ?? (getSupabaseAdminClient() as unknown as ExperienceDraftPersistenceClient);
}

function defaultParsingCheckpoints(
  generation: StructuredExperienceGenerationResult,
  repairAttempted: boolean,
): ExperienceParsingCheckpoint[] {
  const checkpoints: ExperienceParsingCheckpoint[] = [
    {
      stage: "structured-generation",
      status: "completed",
      detail: {
        model_version: generation.provenance.model,
        prompt_version: generation.provenance.promptVersion,
        schema_version: generation.provenance.schemaVersion,
        finish_reason: generation.provenance.finishReason,
        max_output_tokens: generation.provenance.maxOutputTokens,
        timeout_ms: generation.provenance.timeoutMs,
      },
    },
  ];

  if (repairAttempted) {
    checkpoints.push({
      stage: "repair",
      status: "completed",
      detail: {
        prompt_version: generation.provenance.promptVersion,
      },
    });
  }

  checkpoints.push({
    stage: "canonical-validation",
    status: "completed",
    detail: {
      source_refs_resolved: true,
    },
  });

  return checkpoints;
}

export function buildExperienceDraftJson(input: PersistExperienceDraftInput): PersistedExperienceDraftJson {
  return {
    canonical_revision: input.draft,
    parsing_checkpoints:
      input.checkpoints ?? defaultParsingCheckpoints(input.generation, input.repairAttempted),
    source_warnings: input.snapshot.warnings,
    omitted_block_coverage: buildCoverageReport(input.snapshot, input.draft),
  };
}

export async function persistExperienceDraft(
  input: PersistExperienceDraftInput,
  client?: ExperienceDraftPersistenceClient,
): Promise<PersistedExperienceDraftJson> {
  if (input.draft.source.source_id !== input.sourceId || input.snapshot.source_id !== input.sourceId) {
    throw new Error("Draft, snapshot, and source IDs must match before persistence.");
  }
  if (input.draft.extraction.extraction_snapshot_id !== input.snapshot.extraction_snapshot_id) {
    throw new Error("Draft extraction snapshot must match the persisted snapshot.");
  }

  const supabase = getPersistenceClient(client);
  const draftJson = buildExperienceDraftJson(input);
  const insertRow: ExperienceRevisionInsertRow = {
    id: input.draft.revision.revision_id,
    source_id: input.sourceId,
    extraction_id: input.snapshot.extraction_snapshot_id,
    status: "draft",
    draft_json: draftJson,
    draft_version: input.draft.revision.draft_version,
    model_version: input.draft.revision.model_version,
    prompt_version: input.draft.revision.prompt_version,
    parse_error: null,
  };

  const { error: insertError } = await supabase.from("experience_revisions").insert(insertRow).select("*").single();
  if (insertError) {
    throw new Error(`Failed to persist experience draft revision: ${errorMessage(insertError)}`);
  }

  const { error: completeError } = await supabase.rpc("complete_experience_source_execution", {
    p_source_id: input.sourceId,
    p_execution_token: input.executionToken,
    p_stage: "parsing",
    p_next_status: "draft",
    p_latest_extraction_id: input.snapshot.extraction_snapshot_id,
    p_latest_draft_revision_id: input.draft.revision.revision_id,
    p_failure: null,
  });
  if (completeError) {
    throw new Error(`Failed to complete experience parsing: ${errorMessage(completeError)}`);
  }

  return draftJson;
}

export async function recordExperienceParseFailure(
  input: RecordExperienceParseFailureInput,
  client?: ExperienceDraftPersistenceClient,
): Promise<void> {
  const supabase = getPersistenceClient(client);
  const failure = {
    stage: "parsing",
    code: input.code,
    message: input.message,
    recoverable_action: input.recoverableAction ?? "retry-parse",
    model_version: input.modelVersion ?? null,
    prompt_version: input.promptVersion ?? null,
  };
  const { error } = await supabase.rpc("complete_experience_source_execution", {
    p_source_id: input.sourceId,
    p_execution_token: input.executionToken,
    p_stage: "parsing",
    p_next_status: "failed",
    p_latest_extraction_id: null,
    p_latest_draft_revision_id: null,
    p_failure: failure,
  });
  if (error) {
    throw new Error(`Failed to record experience parse failure: ${errorMessage(error)}`);
  }
}
