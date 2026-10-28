BEGIN;
SET LOCAL search_path = public, extensions;

-- Both inserts share one transaction; a bad child rolls the parent back too.
CREATE FUNCTION public.insert_project_evidence(parent_input jsonb, chunks_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, extensions AS $$
DECLARE
  parent public.parent_documents;
BEGIN
  IF parent_input IS NULL OR jsonb_typeof(parent_input) <> 'object' THEN
    RAISE EXCEPTION 'parent_input must be an object';
  END IF;
  IF chunks_input IS NULL OR jsonb_typeof(chunks_input) <> 'array' THEN
    RAISE EXCEPTION 'chunks_input must be an array';
  END IF;
  IF jsonb_array_length(chunks_input) = 0 THEN
    RAISE EXCEPTION 'At least one evidence chunk is required';
  END IF;

  INSERT INTO public.parent_documents (
    source_document_id, source_file_name, source_file_type, parent_text, metadata
  ) VALUES (
    parent_input->>'source_document_id', parent_input->>'source_file_name',
    parent_input->>'source_file_type', parent_input->>'parent_text',
    coalesce(parent_input->'metadata', '{}'::jsonb)
  ) RETURNING * INTO parent;

  INSERT INTO public.document_chunks (
    parent_id, child_text, embedding_text, embedding, metadata, chunk_index
  )
  SELECT parent.id, chunk->>'child_text', chunk->>'embedding_text',
         (chunk->>'embedding')::vector(1536),
         coalesce(chunk->'metadata', '{}'::jsonb), (position - 1)::integer
  FROM jsonb_array_elements(chunks_input) WITH ORDINALITY AS input(chunk, position);

  RETURN jsonb_build_object(
    'parent', to_jsonb(parent), 'chunkCount', jsonb_array_length(chunks_input)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.insert_project_evidence(jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_project_evidence(jsonb, jsonb) TO service_role;

COMMIT;
