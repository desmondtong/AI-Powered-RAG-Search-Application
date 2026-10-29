import type {
  EvidenceMetadata,
  EvidenceSearchResult,
  ParentDocument,
} from "../evidence";
import { createEmbedding } from "../gemini";
import { getSupabaseAdminClient } from "../supabaseServer";

export interface ApprovedExperienceSearchClient {
  rpc(functionName: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

export interface ApprovedExperienceSearchOptions {
  matchCount?: number;
  matchThreshold?: number;
  sourceIds?: string[];
  client?: ApprovedExperienceSearchClient;
  embed?: (input: string, taskType: "RETRIEVAL_QUERY") => Promise<number[]>;
}

interface ApprovedExperienceSearchRow extends EvidenceSearchResult {
  source_id: string;
  revision_id: string;
  approved_content_hash: string;
  logical_experience_id: string;
  logical_parent_id: string;
  logical_chunk_id: string | null;
  parent_source_document_id: string;
  parent_source_file_name: string;
  parent_source_file_type: string;
  parent_text: string;
  parent_metadata: EvidenceMetadata;
  parent_created_at: string;
  parent_updated_at: string;
}

export interface ApprovedExperienceSearchResult extends EvidenceSearchResult {
  source_id: string;
  revision_id: string;
  approved_content_hash: string;
  logical_experience_id: string;
  logical_parent_id: string;
  logical_chunk_id: string | null;
  parent: ParentDocument;
}

function requireText(value: string, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be non-empty text.`);
  }
}

function normalizeMatchCount(value: number | undefined) {
  const matchCount = value ?? 10;
  if (!Number.isInteger(matchCount) || matchCount < 1 || matchCount > 100) {
    throw new Error("matchCount must be between 1 and 100.");
  }
  return matchCount;
}

function normalizeMatchThreshold(value: number | undefined) {
  const matchThreshold = value ?? -1;
  if (!Number.isFinite(matchThreshold) || matchThreshold < -1 || matchThreshold > 1) {
    throw new Error("matchThreshold must be between -1 and 1.");
  }
  return matchThreshold;
}

function normalizeSourceIds(sourceIds: string[] | undefined) {
  if (sourceIds === undefined) {
    return null;
  }
  const normalized = sourceIds.map((sourceId) => sourceId.trim());
  if (normalized.some((sourceId) => !sourceId)) {
    throw new Error("sourceIds must contain only non-empty source IDs.");
  }
  return [...new Set(normalized)];
}

function mapApprovedSearchRow(row: ApprovedExperienceSearchRow): ApprovedExperienceSearchResult {
  return {
    id: row.id,
    parent_id: row.parent_id,
    child_text: row.child_text,
    embedding_text: row.embedding_text,
    metadata: row.metadata,
    chunk_index: row.chunk_index,
    similarity: row.similarity,
    source_id: row.source_id,
    revision_id: row.revision_id,
    approved_content_hash: row.approved_content_hash,
    logical_experience_id: row.logical_experience_id,
    logical_parent_id: row.logical_parent_id,
    logical_chunk_id: row.logical_chunk_id,
    parent: {
      id: row.parent_id,
      source_document_id: row.parent_source_document_id,
      source_file_name: row.parent_source_file_name,
      source_file_type: row.parent_source_file_type,
      parent_text: row.parent_text,
      metadata: row.parent_metadata,
      created_at: row.parent_created_at,
      updated_at: row.parent_updated_at,
    },
  };
}

export async function searchApprovedExperienceEvidence(
  query: string,
  options: ApprovedExperienceSearchOptions = {},
): Promise<ApprovedExperienceSearchResult[]> {
  requireText(query, "query");
  const matchCount = normalizeMatchCount(options.matchCount);
  const matchThreshold = normalizeMatchThreshold(options.matchThreshold);
  const sourceIds = normalizeSourceIds(options.sourceIds);
  if (sourceIds && sourceIds.length === 0) {
    return [];
  }

  const embed = options.embed ?? createEmbedding;
  const embedding = await embed(query.trim(), "RETRIEVAL_QUERY");
  if (!Array.isArray(embedding) || embedding.length !== 1536 || !embedding.every((value) => Number.isFinite(value))) {
    throw new Error("Query embedding must be a finite 1536-dimensional vector.");
  }

  const client = options.client ?? getSupabaseAdminClient();
  const { data, error } = await client.rpc("match_approved_experience_chunks", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: matchThreshold,
    match_count: matchCount,
    source_ids: sourceIds,
  });
  if (error) {
    throw new Error(`Failed to search approved experience evidence: ${error.message ?? error.code ?? "unknown error"}`);
  }

  return ((Array.isArray(data) ? data : []) as ApprovedExperienceSearchRow[]).map(mapApprovedSearchRow);
}
