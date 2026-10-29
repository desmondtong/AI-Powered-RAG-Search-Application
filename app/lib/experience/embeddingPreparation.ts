import { createEmbedding } from "../gemini";
import {
  parseCanonicalExperienceRevision,
  parseExtractionSnapshot,
  type CanonicalExperienceRevision,
  type ExtractionSnapshot,
} from "./contracts";
import {
  EXPERIENCE_EMBEDDING_TASK_TYPE,
  freezeApprovedExperienceIndexPlan,
  type ExperienceChildPlanEntry,
  type ExperienceParentPlanEntry,
  type FrozenExperienceIndexPlan,
} from "./parentPlanning";

export const EXPERIENCE_EMBEDDING_PREPARATION_BATCH_SIZE = readPositiveInt(
  "EXPERIENCE_EMBEDDING_PREPARATION_BATCH_SIZE",
  3,
);
export const EXPERIENCE_EMBEDDING_PREPARATION_TIMEOUT_MS = readPositiveInt(
  "EXPERIENCE_EMBEDDING_PREPARATION_TIMEOUT_MS",
  75_000,
);

interface SupabaseErrorLike {
  message?: string;
}

interface StagingQueryResult {
  then(resolve: (value: { data: unknown; error: SupabaseErrorLike | null }) => void): unknown;
}

interface ExperienceIndexStagingQuery {
  select(columns: string): {
    eq(column: string, value: string): StagingQueryResult;
  };
  upsert(
    rows: ExperienceIndexStagingRow[],
    options?: { onConflict: string },
  ): StagingQueryResult;
}

export interface ExperienceEmbeddingPreparationClient {
  from(table: "experience_index_staging"): ExperienceIndexStagingQuery;
}

export interface ExperienceIndexStagingRow {
  revision_id: string;
  logical_chunk_key: string;
  plan_hash: string;
  approved_content_hash: string;
  chunking_version: string;
  embedding_model: string;
  embedding_task_type: string;
  embedding_dimensions: number;
  parent_payload: unknown;
  child_payload: unknown;
  embedding: unknown;
  prepared_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PrepareExperienceEmbeddingBatchInput {
  snapshot: unknown;
  revision: unknown;
  client: ExperienceEmbeddingPreparationClient;
  batchSize?: number;
  maxDurationMs?: number;
  embed?: (input: string, taskType: typeof EXPERIENCE_EMBEDDING_TASK_TYPE) => Promise<number[]>;
  now?: () => Date;
}

export interface PreparedExperienceEmbeddingBatch {
  revision_id: string;
  source_id: string;
  plan_hash: string;
  approved_content_hash: string;
  total_chunks: number;
  prepared_chunks: number;
  previously_prepared_chunks: number;
  newly_prepared_chunks: number;
  remaining_chunks: number;
  prepared_chunk_keys: string[];
  next_chunk_keys: string[];
  frozen_plan: FrozenExperienceIndexPlan;
}

function readPositiveInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeRows<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

function normalizeBatchSize(value: number | undefined) {
  const batchSize = value ?? EXPERIENCE_EMBEDDING_PREPARATION_BATCH_SIZE;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > EXPERIENCE_EMBEDDING_PREPARATION_BATCH_SIZE
  ) {
    throw new Error(`Embedding preparation batch size must be between 1 and ${EXPERIENCE_EMBEDDING_PREPARATION_BATCH_SIZE}.`);
  }
  return batchSize;
}

function validateEmbeddingVector(vector: number[], dimensions: number) {
  if (!Array.isArray(vector) || vector.length !== dimensions) {
    throw new Error(`Prepared embedding has invalid dimensions: ${Array.isArray(vector) ? vector.length : 0}/${dimensions}.`);
  }
  if (!vector.every((value) => Number.isFinite(value))) {
    throw new Error("Prepared embedding contains non-finite values.");
  }
}

function hasPreparedEmbedding(row: ExperienceIndexStagingRow) {
  return Boolean(row.prepared_at && row.embedding);
}

function isCompatibleStagingRow(row: ExperienceIndexStagingRow, plan: FrozenExperienceIndexPlan) {
  const config = plan.preparation_config;
  return (
    row.plan_hash === plan.plan_hash &&
    row.approved_content_hash === plan.approved_content_hash &&
    row.chunking_version === config.chunking_version &&
    row.embedding_model === config.embedding_model &&
    row.embedding_task_type === config.embedding_task_type &&
    row.embedding_dimensions === config.embedding_dimensions
  );
}

function buildParentPayload(revision: CanonicalExperienceRevision, parent: ExperienceParentPlanEntry) {
  return {
    source_document_id: revision.source.source_id,
    source_file_name: revision.source.original_file_name,
    source_file_type: revision.source.original_file_type,
    parent_text: parent.parent_text,
    metadata: parent.metadata,
  };
}

function buildChildPayload(child: ExperienceChildPlanEntry) {
  return {
    child_text: child.child_text,
    embedding_text: child.embedding_text,
    metadata: child.metadata,
    logical_chunk_id: child.logical_chunk_id,
    chunk_index: child.child_index,
  };
}

function stagingRowForPreparedChunk(input: {
  plan: FrozenExperienceIndexPlan;
  revision: CanonicalExperienceRevision;
  parent: ExperienceParentPlanEntry;
  child: ExperienceChildPlanEntry;
  embedding: number[];
  preparedAt: string;
}): ExperienceIndexStagingRow {
  const config = input.plan.preparation_config;
  return {
    revision_id: input.plan.revision_id,
    logical_chunk_key: input.child.logical_chunk_id,
    plan_hash: input.plan.plan_hash,
    approved_content_hash: input.plan.approved_content_hash,
    chunking_version: config.chunking_version,
    embedding_model: config.embedding_model,
    embedding_task_type: config.embedding_task_type,
    embedding_dimensions: config.embedding_dimensions,
    parent_payload: buildParentPayload(input.revision, input.parent),
    child_payload: buildChildPayload(input.child),
    embedding: input.embedding,
    prepared_at: input.preparedAt,
  };
}

function ensureWithinDeadline(startedAt: number, maxDurationMs: number) {
  if (Date.now() - startedAt > maxDurationMs) {
    throw new Error("Embedding preparation deadline expired before the batch completed.");
  }
}

export async function prepareExperienceEmbeddingBatch(
  input: PrepareExperienceEmbeddingBatchInput,
): Promise<PreparedExperienceEmbeddingBatch> {
  const snapshot: ExtractionSnapshot = parseExtractionSnapshot(input.snapshot);
  const revision: CanonicalExperienceRevision = parseCanonicalExperienceRevision(input.revision);
  const batchSize = normalizeBatchSize(input.batchSize);
  const maxDurationMs = input.maxDurationMs ?? EXPERIENCE_EMBEDDING_PREPARATION_TIMEOUT_MS;
  if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1) {
    throw new Error("Embedding preparation timeout must be a positive integer.");
  }

  const frozenPlan = freezeApprovedExperienceIndexPlan({ snapshot, revision });
  const { data, error } = await input.client
    .from("experience_index_staging")
    .select("*")
    .eq("revision_id", frozenPlan.revision_id);
  if (error) {
    throw new Error(`Failed to read embedding staging checkpoints: ${error.message ?? "unknown error"}`);
  }

  const rows = normalizeRows<ExperienceIndexStagingRow>(data);
  const rowsByChunk = new Map(rows.map((row) => [row.logical_chunk_key, row]));
  const validChunkKeys = new Set(frozenPlan.child_plan.children.map((child) => child.logical_chunk_id));
  for (const row of rows) {
    if (!validChunkKeys.has(row.logical_chunk_key)) {
      continue;
    }
    if (!isCompatibleStagingRow(row, frozenPlan)) {
      throw new Error(`Existing embedding checkpoint is incompatible with the frozen plan: ${row.logical_chunk_key}`);
    }
  }

  const preparedChunkKeys = new Set(
    frozenPlan.child_plan.children
      .filter((child) => {
        const row = rowsByChunk.get(child.logical_chunk_id);
        return row && isCompatibleStagingRow(row, frozenPlan) && hasPreparedEmbedding(row);
      })
      .map((child) => child.logical_chunk_id),
  );
  const missingChildren = frozenPlan.child_plan.children.filter((child) => !preparedChunkKeys.has(child.logical_chunk_id));
  const batchChildren = missingChildren.slice(0, batchSize);
  const parentById = new Map(frozenPlan.parent_plan.parents.map((parent) => [parent.logical_parent_id, parent]));
  const embed = input.embed ?? createEmbedding;
  const now = input.now ?? (() => new Date());
  const startedAt = Date.now();
  const preparedRows: ExperienceIndexStagingRow[] = [];

  for (const child of batchChildren) {
    ensureWithinDeadline(startedAt, maxDurationMs);
    const parent = parentById.get(child.logical_parent_id);
    if (!parent) {
      throw new Error(`Child chunk references an unknown parent: ${child.logical_parent_id}`);
    }
    const embedding = await embed(child.embedding_text, EXPERIENCE_EMBEDDING_TASK_TYPE);
    validateEmbeddingVector(embedding, frozenPlan.preparation_config.embedding_dimensions);
    preparedRows.push(
      stagingRowForPreparedChunk({
        plan: frozenPlan,
        revision,
        parent,
        child,
        embedding,
        preparedAt: now().toISOString(),
      }),
    );
  }

  if (preparedRows.length > 0) {
    const { error: upsertError } = await input.client
      .from("experience_index_staging")
      .upsert(preparedRows, { onConflict: "revision_id,logical_chunk_key" });
    if (upsertError) {
      throw new Error(`Failed to write embedding staging checkpoints: ${upsertError.message ?? "unknown error"}`);
    }
  }

  const allPreparedKeys = new Set([...preparedChunkKeys, ...preparedRows.map((row) => row.logical_chunk_key)]);
  const remainingChildren = frozenPlan.child_plan.children.filter((child) => !allPreparedKeys.has(child.logical_chunk_id));
  return {
    revision_id: frozenPlan.revision_id,
    source_id: frozenPlan.source_id,
    plan_hash: frozenPlan.plan_hash,
    approved_content_hash: frozenPlan.approved_content_hash,
    total_chunks: frozenPlan.child_plan.children.length,
    prepared_chunks: allPreparedKeys.size,
    previously_prepared_chunks: preparedChunkKeys.size,
    newly_prepared_chunks: preparedRows.length,
    remaining_chunks: remainingChildren.length,
    prepared_chunk_keys: [...allPreparedKeys].sort(),
    next_chunk_keys: remainingChildren.slice(0, batchSize).map((child) => child.logical_chunk_id),
    frozen_plan: frozenPlan,
  };
}
