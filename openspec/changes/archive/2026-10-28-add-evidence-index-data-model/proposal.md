# Proposal

## Why

The current RAG index stores every uploaded file as flat chunk rows in one `documents` table, which is enough for generic document Q&A but too weak for project-experience evidence retrieval. JD-fit analysis needs a durable evidence model that can retrieve precise child chunks while preserving the broader parent project context used for downstream reasoning.

## What Changes

- Introduce parent/child evidence storage for project experience documents.
- Define parent documents as the larger project or project-section context used for reasoning and child chunks as the focused evidence units used for semantic search.
- Store `child_text`, `embedding_text`, `embedding`, `parent_id`, and metadata separately enough that display/citation text, retrieval text, and vector data do not collapse into one field.
- Define compatibility behavior for the existing `documents` table and generic upload/search flow, preferring coexistence during the first change unless migration is explicitly required by implementation constraints.
- Preserve current upload/search behavior as much as possible while adding the foundation for structured project evidence.
- Capture the broader phased roadmap without implementing later phases in this change:
  1. `add-evidence-index-data-model`
  2. `add-structured-project-ingestion`
  3. `add-jd-fit-evaluation`
  4. `add-rag-quality-evals`

Out of scope for this first change:

- Structured LLM ingestion or project JSON extraction.
- JD fit evaluation flows, prompts, or UI.
- Formal RAG evaluation fixtures or scoring.

## Capabilities

### New Capabilities

- `project-evidence-index`: Stores project experience evidence as parent context records and searchable child chunks, with explicit fields for evidence text, embedding input text, vector embeddings, parent linkage, and metadata.

### Modified Capabilities

- None. There are no existing OpenSpec capabilities in this project yet.

## Impact

- Affected code areas: upload ingestion in `app/api/upload/route.ts`, vector retrieval in `app/api/search/route.ts`, document listing/deletion in `app/api/documents/route.ts`, Gemini embedding helpers in `app/lib/gemini.ts`, and Supabase access in `app/lib/supabaseServer.ts`.
- Affected data systems: Supabase Postgres/pgvector schema and any `match_documents`-style RPC used for vector search.
- Affected behavior: project evidence can be modeled with one parent to many child chunks while generic document upload/search should remain usable during the transition.
- No new LLM parsing framework, JD-fit API, or eval harness is introduced by this change.
