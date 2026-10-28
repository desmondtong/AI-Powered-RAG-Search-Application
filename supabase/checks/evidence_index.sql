-- Run after the evidence migrations as a database administrator.
-- All seeded data is rolled back, including on assertion failure.
BEGIN;
SET LOCAL search_path = public, extensions;

DO $$
DECLARE
  parent uuid;
  child uuid;
  result record;
  query_vector vector(1536) := ('[1,' || repeat('0,', 1534) || '0]')::vector;
BEGIN
  INSERT INTO public.parent_documents (
    source_document_id, source_file_name, source_file_type, parent_text
  ) VALUES (
    'evidence-index-smoke', 'evidence-index-smoke.txt', 'text/plain', 'Project context'
  ) RETURNING id INTO parent;

  INSERT INTO public.document_chunks (
    parent_id, child_text, embedding_text, embedding, metadata, chunk_index
  ) VALUES (
    parent, 'Exact citation', 'Project: Exact citation', query_vector,
    '{"section":"impact"}', 0
  ) RETURNING id INTO child;

  SELECT * INTO result
  FROM public.match_document_chunks(query_vector, 0.99, 10)
  WHERE id = child;

  IF result.id IS DISTINCT FROM child
     OR result.parent_id IS DISTINCT FROM parent
     OR result.child_text IS DISTINCT FROM 'Exact citation'
     OR result.embedding_text IS DISTINCT FROM 'Project: Exact citation'
     OR result.metadata->>'section' IS DISTINCT FROM 'impact'
     OR abs(result.similarity - 1) > 0.000001 THEN
    RAISE EXCEPTION 'Evidence search contract failed';
  END IF;

  BEGIN
    INSERT INTO public.document_chunks (
      parent_id, child_text, embedding_text, embedding, chunk_index
    ) VALUES (gen_random_uuid(), 'Orphan', 'Orphan', query_vector, 0);
    RAISE EXCEPTION 'Orphan child was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  DELETE FROM public.parent_documents WHERE id = parent;
  IF EXISTS (SELECT 1 FROM public.document_chunks WHERE id = child)
     OR EXISTS (
       SELECT 1 FROM public.match_document_chunks(query_vector, -1, 100)
       WHERE id = child
     ) THEN
    RAISE EXCEPTION 'Deleted evidence is still searchable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'document_chunks_embedding_idx'
      AND indexdef LIKE '%hnsw%vector_cosine_ops%'
  ) THEN
    RAISE EXCEPTION 'Missing evidence cosine HNSW index';
  END IF;

  IF has_function_privilege('anon', 'public.match_document_chunks(vector,double precision,integer)', 'EXECUTE')
     OR has_table_privilege('authenticated', 'public.document_chunks', 'SELECT') THEN
    RAISE EXCEPTION 'Evidence access is not server-only';
  END IF;
END;
$$;

ROLLBACK;
