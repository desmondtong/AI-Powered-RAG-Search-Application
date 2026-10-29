BEGIN;
SET LOCAL search_path = public, extensions;

CREATE FUNCTION public.match_approved_experience_chunks(
  query_embedding vector(1536),
  match_threshold double precision DEFAULT -1,
  match_count integer DEFAULT 10,
  source_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  parent_id uuid,
  child_text text,
  embedding_text text,
  metadata jsonb,
  chunk_index integer,
  similarity double precision,
  source_id uuid,
  revision_id uuid,
  approved_content_hash text,
  logical_experience_id text,
  logical_parent_id text,
  logical_chunk_id text,
  parent_source_document_id text,
  parent_source_file_name text,
  parent_source_file_type text,
  parent_text text,
  parent_metadata jsonb,
  parent_created_at timestamptz,
  parent_updated_at timestamptz
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

  IF source_ids IS NOT NULL AND COALESCE(array_length(source_ids, 1), 0) = 0 THEN
    RETURN;
  END IF;

  IF source_ids IS NOT NULL AND EXISTS (
    WITH selected_sources AS (
      SELECT DISTINCT unnest(source_ids) AS id
    ),
    eligible_sources AS (
      SELECT s.id
      FROM public.experience_sources s
      JOIN public.experience_revisions r
        ON r.id = s.active_revision_id
       AND r.source_id = s.id
      WHERE s.deleted_at IS NULL
        AND r.status = 'indexed'
        AND r.approved_json IS NOT NULL
        AND r.approved_content_hash IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.experience_revision_parents rp
          WHERE rp.revision_id = r.id
        )
    )
    SELECT 1
    FROM selected_sources ss
    LEFT JOIN eligible_sources es ON es.id = ss.id
    WHERE es.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Selected experience source is not eligible for approved search'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.parent_id,
    c.child_text,
    c.embedding_text,
    c.metadata,
    c.chunk_index,
    1 - (c.embedding <=> query_embedding) AS similarity,
    s.id AS source_id,
    r.id AS revision_id,
    r.approved_content_hash,
    rp.logical_experience_id,
    rp.logical_parent_id,
    c.metadata->>'logical_chunk_id' AS logical_chunk_id,
    p.source_document_id AS parent_source_document_id,
    p.source_file_name AS parent_source_file_name,
    p.source_file_type AS parent_source_file_type,
    p.parent_text,
    p.metadata AS parent_metadata,
    p.created_at AS parent_created_at,
    p.updated_at AS parent_updated_at
  FROM public.document_chunks c
  JOIN public.parent_documents p
    ON p.id = c.parent_id
  JOIN public.experience_revision_parents rp
    ON rp.parent_id = p.id
  JOIN public.experience_revisions r
    ON r.id = rp.revision_id
  JOIN public.experience_sources s
    ON s.active_revision_id = r.id
   AND s.id = r.source_id
  WHERE s.deleted_at IS NULL
    AND r.status = 'indexed'
    AND r.approved_json IS NOT NULL
    AND r.approved_content_hash IS NOT NULL
    AND (source_ids IS NULL OR s.id = ANY(source_ids))
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

REVOKE ALL ON FUNCTION public.match_approved_experience_chunks(
  vector, double precision, integer, uuid[]
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_approved_experience_chunks(
  vector, double precision, integer, uuid[]
) TO service_role;

COMMIT;
