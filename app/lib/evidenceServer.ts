import type {
  EvidenceChunkInput,
  EvidenceInsertResult,
  EvidenceSearchOptions,
  EvidenceSearchResult,
  ExpandedEvidenceSearchResult,
  ParentDocument,
  ParentEvidenceInput,
} from "./evidence";
import { createEmbedding } from "./gemini";
import { getSupabaseAdminClient } from "./supabaseServer";

function requireText(value: string, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be non-empty text.`);
  }
}

export async function insertProjectEvidence(
  parent: ParentEvidenceInput,
  chunks: EvidenceChunkInput[],
): Promise<EvidenceInsertResult> {
  requireText(parent.source_document_id, "source_document_id");
  requireText(parent.source_file_name, "source_file_name");
  requireText(parent.source_file_type, "source_file_type");
  requireText(parent.parent_text, "parent_text");
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error("At least one evidence chunk is required.");
  }
  for (const chunk of chunks) {
    requireText(chunk.child_text, "child_text");
    requireText(chunk.embedding_text, "embedding_text");
  }

  const supabase = getSupabaseAdminClient();
  const embeddedChunks = [];
  // Do not persist a parent until all embeddings are ready.
  for (const chunk of chunks) {
    embeddedChunks.push({
      child_text: chunk.child_text,
      embedding_text: chunk.embedding_text,
      metadata: chunk.metadata ?? {},
      embedding: await createEmbedding(chunk.embedding_text, "RETRIEVAL_DOCUMENT"),
    });
  }

  const { data, error } = await supabase.rpc("insert_project_evidence", {
    parent_input: { ...parent, metadata: parent.metadata ?? {} },
    chunks_input: embeddedChunks,
  });
  if (error) {
    throw new Error(`Failed to insert project evidence: ${error.message}`);
  }
  if (!data?.parent?.id || data.chunkCount !== chunks.length) {
    throw new Error("Evidence insertion returned an unexpected response.");
  }
  return data as EvidenceInsertResult;
}

export async function searchProjectEvidence(
  query: string,
  options: EvidenceSearchOptions = {},
): Promise<ExpandedEvidenceSearchResult[]> {
  requireText(query, "query");
  const matchCount = options.matchCount ?? 10;
  const matchThreshold = options.matchThreshold ?? -1;
  if (!Number.isInteger(matchCount) || matchCount < 1 || matchCount > 100) {
    throw new Error("matchCount must be between 1 and 100.");
  }
  if (!Number.isFinite(matchThreshold) || matchThreshold < -1 || matchThreshold > 1) {
    throw new Error("matchThreshold must be between -1 and 1.");
  }

  const supabase = getSupabaseAdminClient();
  const embedding = await createEmbedding(query.trim(), "RETRIEVAL_QUERY");
  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: JSON.stringify(embedding),
    match_threshold: matchThreshold,
    match_count: matchCount,
  });
  if (error) {
    throw new Error(`Failed to search project evidence: ${error.message}`);
  }
  const matches = (data ?? []) as EvidenceSearchResult[];
  if (matches.length === 0) {
    return [];
  }

  const parentIds = [...new Set(matches.map((match) => match.parent_id))];
  const { data: parentRows, error: parentError } = await supabase
    .from("parent_documents")
    .select("id, source_document_id, source_file_name, source_file_type, parent_text, metadata, created_at, updated_at")
    .in("id", parentIds);
  if (parentError) {
    throw new Error(`Failed to expand evidence context: ${parentError.message}`);
  }

  const parents = new Map((parentRows as ParentDocument[] ?? []).map((parent) => [parent.id, parent]));
  // A parent deleted between search and expansion must not become stale context.
  return matches.flatMap((match) => {
    const parent = parents.get(match.parent_id);
    return parent ? [{ ...match, parent }] : [];
  });
}

export async function deleteProjectEvidence(parentId: string): Promise<void> {
  requireText(parentId, "parentId");
  const { error } = await getSupabaseAdminClient()
    .from("parent_documents")
    .delete()
    .eq("id", parentId);
  if (error) {
    throw new Error(`Failed to delete project evidence: ${error.message}`);
  }
}
