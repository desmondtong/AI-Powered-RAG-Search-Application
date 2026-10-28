-- Destructive: disable evidence callers and preserve needed evidence first.
-- Execute manually, never as part of the forward migration sequence.
BEGIN;
SET LOCAL search_path = public, extensions;

DROP FUNCTION IF EXISTS public.insert_project_evidence(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.match_document_chunks(vector, double precision, integer);
DROP TABLE IF EXISTS public.document_chunks;
DROP TABLE IF EXISTS public.parent_documents;
DROP FUNCTION IF EXISTS public.set_evidence_updated_at();

-- Keep pgvector, documents, match_documents, and storage for generic RAG.
COMMIT;
