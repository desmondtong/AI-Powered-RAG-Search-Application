export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type EvidenceMetadata = Record<string, JsonValue>;

export interface ParentDocument {
  id: string;
  source_document_id: string;
  source_file_name: string;
  source_file_type: string;
  parent_text: string;
  metadata: EvidenceMetadata;
  created_at: string;
  updated_at: string;
}

export interface DocumentChunk {
  id: string;
  parent_id: string;
  child_text: string;
  embedding_text: string;
  // PostgREST serializes pgvector columns as vector literals, not number arrays.
  embedding: string;
  metadata: EvidenceMetadata;
  chunk_index: number;
  created_at: string;
  updated_at: string;
}

export interface EvidenceSearchResult {
  id: string;
  parent_id: string;
  child_text: string;
  embedding_text: string;
  metadata: EvidenceMetadata;
  chunk_index: number;
  similarity: number;
}

export interface ExpandedEvidenceSearchResult extends EvidenceSearchResult {
  parent: ParentDocument;
}

export interface ParentEvidenceInput {
  source_document_id: string;
  source_file_name: string;
  source_file_type: string;
  parent_text: string;
  metadata?: EvidenceMetadata;
}

export interface EvidenceChunkInput {
  child_text: string;
  embedding_text: string;
  metadata?: EvidenceMetadata;
}

export interface EvidenceInsertResult {
  parent: ParentDocument;
  chunkCount: number;
}

export interface EvidenceSearchOptions {
  matchCount?: number;
  matchThreshold?: number;
}
