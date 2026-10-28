import { NextResponse } from "next/server";
import { getErrorMessage } from "@/app/lib/errors";
import { createEmbedding, generateAnswer } from "@/app/lib/gemini";
import { getSupabaseAdminClient } from "@/app/lib/supabaseServer";

const VECTOR_MATCH_COUNT = 10;
const VECTOR_MATCH_THRESHOLD = -1.0;
const MAX_CONTEXT_CHARACTERS = 12000;

interface SearchMetadata {
  document_id?: string;
  file_name?: string;
  source?: string;
  chunk_index?: number | string;
  total_chunks?: number | string;
  document_context?: string;
}

interface SearchResult {
  id?: number | string;
  content?: string;
  metadata?: SearchMetadata | null;
  similarity?: number;
}

function getSearchErrorStatus(error: unknown) {
  const message = getErrorMessage(error, "");
  return /timeout|deadline|504/i.test(message) ? 504 : 500;
}

function parseChunkIndex(value: unknown) {
  const index = typeof value === "number" ? value : Number(value);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function resultKey(result: SearchResult) {
  const documentId = result.metadata?.document_id;
  const chunkIndex = parseChunkIndex(result.metadata?.chunk_index);

  if (documentId && chunkIndex !== null) {
    return `${documentId}:${chunkIndex}`;
  }

  return result.id?.toString() || result.content || crypto.randomUUID();
}

function orderResultsByDocument(results: SearchResult[]) {
  const documentRank = new Map<string, number>();
  results.forEach((result) => {
    const documentId = result.metadata?.document_id;
    if (documentId && !documentRank.has(documentId)) {
      documentRank.set(documentId, documentRank.size);
    }
  });

  return [...results].sort((a, b) => {
    const aDocumentRank = documentRank.get(a.metadata?.document_id || "") ?? Number.MAX_SAFE_INTEGER;
    const bDocumentRank = documentRank.get(b.metadata?.document_id || "") ?? Number.MAX_SAFE_INTEGER;
    if (aDocumentRank !== bDocumentRank) {
      return aDocumentRank - bDocumentRank;
    }

    const aChunkIndex = parseChunkIndex(a.metadata?.chunk_index) ?? Number.MAX_SAFE_INTEGER;
    const bChunkIndex = parseChunkIndex(b.metadata?.chunk_index) ?? Number.MAX_SAFE_INTEGER;
    return aChunkIndex - bChunkIndex;
  });
}

async function expandResultsWithDocumentContext(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  results: SearchResult[],
) {
  const expanded = new Map<string, SearchResult>();
  const addResult = (result: SearchResult) => {
    if (result.content?.trim()) {
      expanded.set(resultKey(result), result);
    }
  };

  results.forEach(addResult);

  const wantedIndexesByDocument = new Map<string, Set<number>>();
  for (const result of results) {
    const documentId = result.metadata?.document_id;
    if (!documentId) {
      continue;
    }

    const wantedIndexes = wantedIndexesByDocument.get(documentId) ?? new Set<number>();
    wantedIndexes.add(0);

    const chunkIndex = parseChunkIndex(result.metadata?.chunk_index);
    if (chunkIndex !== null) {
      wantedIndexes.add(Math.max(0, chunkIndex - 1));
      wantedIndexes.add(chunkIndex);
      wantedIndexes.add(chunkIndex + 1);
    }

    wantedIndexesByDocument.set(documentId, wantedIndexes);
  }

  for (const [documentId, wantedIndexes] of wantedIndexesByDocument) {
    const { data, error } = await supabase
      .from("documents")
      .select("id, content, metadata")
      .eq("metadata->>document_id", documentId)
      .order("metadata->>chunk_index", { ascending: true });

    if (error) {
      console.warn("[search] Failed to expand document context", {
        documentId,
        error: error.message,
      });
      continue;
    }

    ((data || []) as SearchResult[]).forEach((row) => {
      const chunkIndex = parseChunkIndex(row.metadata?.chunk_index);
      if (chunkIndex !== null && wantedIndexes.has(chunkIndex)) {
        addResult(row);
      }
    });
  }

  return orderResultsByDocument(Array.from(expanded.values()));
}

function formatResultForContext(result: SearchResult) {
  const metadata = result.metadata || {};
  const source = metadata.file_name || metadata.source;
  const chunkIndex = parseChunkIndex(metadata.chunk_index);
  const totalChunks = parseChunkIndex(metadata.total_chunks);
  const details = [
    source ? `Source: ${source}` : null,
    metadata.document_context,
    chunkIndex !== null && totalChunks !== null ? `Chunk: ${chunkIndex + 1} of ${totalChunks}` : null,
  ].filter(Boolean);

  return [...details, result.content?.trim()].filter(Boolean).join("\n");
}

function buildContext(results: SearchResult[]) {
  const parts: string[] = [];
  let characterCount = 0;

  for (const result of results) {
    const part = formatResultForContext(result);
    if (!part) {
      continue;
    }

    if (characterCount && characterCount + part.length > MAX_CONTEXT_CHARACTERS) {
      break;
    }

    parts.push(part);
    characterCount += part.length;
  }

  return parts.join("\n---\n");
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabaseAdminClient();
    const { query } = await req.json();
    const normalizedQuery = typeof query === "string" ? query.trim() : "";

    if (!normalizedQuery) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    // Generate a query embedding in the same Gemini vector space as uploaded chunks.
    const embedding = await createEmbedding(normalizedQuery, "RETRIEVAL_QUERY");

    // Find similar documents using vector similarity search.
    const { data: results, error } = await supabase.rpc("match_documents", {
      query_embedding: JSON.stringify(embedding),
      match_threshold: VECTOR_MATCH_THRESHOLD,
      match_count: VECTOR_MATCH_COUNT,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Combine retrieved chunks into context
    // These chunks will be used as context for the AI to generate an answer
    const searchResults = (results || []) as SearchResult[];
    const expandedResults = await expandResultsWithDocumentContext(supabase, searchResults);
    const context = buildContext(expandedResults);

    if (!context.trim()) {
      return NextResponse.json({
        answer: "I do not know.",
        sources: expandedResults,
      });
    }

    // Generate the final RAG answer with Gemini.
    const startedAt = Date.now();
    console.log("[search] Generating answer", {
      sourceCount: expandedResults.length,
      contextCharacters: context.length,
    });
    const answer = await generateAnswer(normalizedQuery, context);
    console.log("[search] Generated answer", {
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      answer,
      sources: expandedResults,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Search failed") },
      { status: getSearchErrorStatus(error) },
    );
  }
}
