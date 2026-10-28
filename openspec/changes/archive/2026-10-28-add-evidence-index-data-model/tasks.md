# Tasks

## 1. Database Schema

- [x] 1.1 Add a Supabase migration for `parent_documents` with stable id, source document fields, `parent_text`, metadata, timestamps, and verify the SQL applies successfully to the target Supabase database or a local equivalent.
- [x] 1.2 Add a Supabase migration for `document_chunks` with `parent_id`, `child_text`, `embedding_text`, `embedding vector(1536)`, metadata, chunk ordering fields, timestamps, and verify parent-to-child referential integrity works.
- [x] 1.3 Add cascade or equivalent lifecycle behavior from `parent_documents` to `document_chunks` and verify deleting a parent removes or invalidates its chunks.
- [x] 1.4 Add pgvector index support for `document_chunks.embedding` and verify the index exists after migration.
- [x] 1.5 Add or update setup documentation for the new evidence tables and verify the README or schema notes mention both the existing generic `documents` model and the new evidence model.

## 2. Evidence Search RPC

- [x] 2.1 Add an evidence-specific vector search function such as `match_document_chunks` that searches `document_chunks.embedding` and verify it returns child id, `parent_id`, `child_text`, metadata, and similarity.
- [x] 2.2 Keep the existing `match_documents` RPC behavior intact and verify the current generic `/api/search` route can still call it.
- [x] 2.3 Add a minimal SQL or manual smoke check for `match_document_chunks` using a seeded parent and child chunk, and verify the expected child row is returned.

## 3. Server-Side Evidence Helpers

- [x] 3.1 Add TypeScript types for parent documents, document chunks, evidence metadata, and evidence search results, and verify `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm exec tsc -- --noEmit` passes.
- [x] 3.2 Add a server-side helper for inserting a parent document and its child chunks, including generation of embeddings from `embedding_text`, and verify a seeded evidence document creates one parent with multiple linked children.
- [x] 3.3 Add a server-side helper for evidence vector search plus parent lookup, and verify a semantic query returns matched child evidence with enough parent context identifiers for expansion.
- [x] 3.4 Add a server-side helper for deleting parent evidence and verify stale child chunks are not returned by evidence search afterward.

## 4. Compatibility Checks

- [x] 4.1 Verify existing generic upload through `/api/upload` still stores rows in the current `documents` table and returns the same response shape.
- [x] 4.2 Verify existing generic search through `/api/search` still returns answers and sources from the current `documents` table.
- [x] 4.3 Verify existing document listing, viewing, and deletion through `/api/documents` still works for generic uploaded documents.
- [x] 4.4 Verify the new evidence helpers do not require structured LLM ingestion, JD fit evaluation, or eval fixtures to be present.

## 5. Validation

- [x] 5.1 Run `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm run lint` and verify it passes.
- [x] 5.2 Run `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm exec tsc -- --noEmit` and verify it passes.
- [x] 5.3 Run `PATH=/Users/bytedance/.nvm/versions/node/v20.10.0/bin:/opt/homebrew/bin:$PATH openspec validate add-evidence-index-data-model --strict` and verify the change validates.

## Workflow follow-up

- Archive the change after implementation and review are complete.
- After archive/sync, start the next planned proposal: `add-structured-project-ingestion`.
