# Design

## Context

The current Next.js app indexes uploads by inserting one row per chunk into the existing Supabase `documents` table. Each row stores `content`, `metadata`, and a 1536-dimensional Gemini embedding; the current `/api/search` route calls `match_documents`, then expands neighboring chunks by `metadata.document_id`.

That flat model keeps generic RAG simple, but it does not model project evidence as a parent context plus many focused searchable child chunks. This change adds that foundation while leaving the current generic document flow intact.

## Goals / Non-Goals

**Goals:**

- Add a parent/child evidence index for project experience documents.
- Keep parent context usable for downstream reasoning and child chunks usable for vector search.
- Store `child_text`, `embedding_text`, and `embedding` as distinct concepts.
- Preserve current generic upload/search behavior while the new evidence model is introduced.
- Make later structured ingestion and JD-fit changes possible without redesigning storage again.

**Non-Goals:**

- No LLM-based project JSON extraction.
- No JD requirement extraction, fit report, resume advice, or JD upload flow.
- No formal RAG eval suite.
- No mandatory backfill of existing `documents` rows into the new model.

## Decisions

### Decision: Coexist with the current `documents` table

Create a new project evidence data model instead of immediately replacing the current `documents` table.

Preferred tables:

- `parent_documents`
- `document_chunks`

This keeps the existing generic RAG behavior stable while allowing the new model to evolve for project evidence. A full migration from `documents` can be considered later if the evidence model becomes the only document model.

Alternatives considered:

- Reuse `documents` with more metadata: lower migration cost, but keeps overloading one table with generic chunks, parent records, and evidence chunks.
- Immediately migrate all rows: cleaner final state, but risky for a first foundation change and unnecessary before structured ingestion exists.

### Decision: Use one parent to many child chunks

Each `parent_documents` record represents a larger context unit, such as one project or one major project section. Each `document_chunks` record belongs to one parent through `parent_id`.

Expected parent fields:

- `id`
- `source_document_id`
- `source_file_name`
- `source_file_type`
- `parent_text`
- `metadata`
- `created_at`
- `updated_at`

Expected child fields:

- `id`
- `parent_id`
- `child_text`
- `embedding_text`
- `embedding vector(1536)`
- `metadata`
- `chunk_index`
- `created_at`
- `updated_at`

### Decision: Embed `embedding_text`, cite `child_text`

The embedding vector is generated from `embedding_text`, not necessarily from the exact text shown to users. `embedding_text` may include truthful contextual headers such as project name, role, tech stack, and section name. `child_text` remains the clean evidence text used for display, citations, and final-answer context.

This preserves retrieval quality without polluting citations with artificial formatting or duplicated headers.

### Decision: Add an evidence-specific vector search function

Add a search function for `document_chunks` instead of changing `match_documents` in place. A name such as `match_document_chunks` keeps the generic search RPC separate from evidence search while preserving the same embedding dimensionality.

The function should return the child chunk id, `parent_id`, `child_text`, metadata, and similarity score. Parent expansion can then be implemented by fetching `parent_documents` by `parent_id`.

### Decision: Keep lifecycle consistency at the data boundary

Deleting a parent document should remove its child chunks through cascade behavior or explicit deletion. This avoids stale embeddings being returned after the parent evidence record is removed.

Listing and detail views can continue to use the existing `documents` API for generic documents in this change. Evidence-specific list/detail APIs are optional unless needed to verify the new model.

### Decision: Capture roadmap, but do not implement later phases

This change creates the evidence-index foundation only. The follow-up sequence remains:

1. `add-structured-project-ingestion`
2. `add-jd-fit-evaluation`
3. `add-rag-quality-evals`

Those changes can build on the parent/child model without reopening the basic storage decision.

## Risks / Trade-offs

- Two document models may coexist temporarily -> Keep naming explicit and avoid routing generic upload/search through the evidence model until structured ingestion exists.
- Existing data will not automatically become evidence -> Accept this for the foundation change; later ingestion can reprocess source files into parent/child evidence.
- `embedding_text` can accidentally include unsupported claims -> Only allow metadata derived from source text or trusted user-provided fields.
- Parent records can become too large for downstream prompts -> Store parent context now, but let later retrieval/JD-fit changes decide how much parent text to send to the LLM.
- Supabase RPC and table schema can drift from TypeScript types -> Add implementation tasks for shared types and verification checks.

## Migration Plan

1. Add Supabase schema for `parent_documents` and `document_chunks`, including pgvector index support for child embeddings.
2. Add an evidence-specific vector search function that searches `document_chunks`.
3. Add server-side types/helpers for inserting parents and child chunks.
4. Keep the existing `documents` table, `match_documents`, `/api/upload`, `/api/search`, and `/api/documents` behavior available.
5. Verify lint/type checks and a small evidence insert/search path.

Rollback:

- Disable any evidence-specific code paths.
- Drop the new search function and new evidence tables if no production data needs preservation.
- Existing generic RAG data remains in `documents` and should continue to work.
