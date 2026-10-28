BEGIN;
SET LOCAL search_path = public, extensions;

CREATE FUNCTION public.match_document_chunks(
  query_embedding vector(1536),
  match_threshold double precision DEFAULT -1,
  match_count integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  parent_id uuid,
  child_text text,
  embedding_text text,
  metadata jsonb,
  chunk_index integer,
  similarity double precision
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions AS $$
BEGIN
  IF query_embedding IS NULL OR vector_dims(query_embedding) <> 1536
     OR vector_norm(query_embedding) = 0 THEN
    RAISE EXCEPTION 'Expected a nonzero 1536-dimensional query vector';
  END IF;
  IF match_count IS NULL OR match_count NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'match_count must be between 1 and 100';
  END IF;
  IF match_threshold IS NULL OR match_threshold NOT BETWEEN -1 AND 1 THEN
    RAISE EXCEPTION 'match_threshold must be between -1 and 1';
  END IF;

  RETURN QUERY
  SELECT c.id, c.parent_id, c.child_text, c.embedding_text, c.metadata,
         c.chunk_index, 1 - (c.embedding <=> query_embedding)
  FROM public.document_chunks c
  WHERE 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

REVOKE ALL ON FUNCTION public.match_document_chunks(vector, double precision, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_document_chunks(vector, double precision, integer)
  TO service_role;

COMMIT;
