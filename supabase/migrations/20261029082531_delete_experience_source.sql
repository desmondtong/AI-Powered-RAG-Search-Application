BEGIN;
SET LOCAL search_path = public, extensions;

CREATE FUNCTION public.delete_experience_source(p_source_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, extensions AS $$
DECLARE
  source_row public.experience_sources%ROWTYPE;
  parent_ids uuid[] := ARRAY[]::uuid[];
  mapped_parent_count integer := 0;
  mapped_child_count integer := 0;
  staging_count integer := 0;
  revision_count integer := 0;
  extraction_count integer := 0;
  deleted_parent_count integer := 0;
BEGIN
  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'source_id is required';
  END IF;

  SELECT * INTO source_row
  FROM public.experience_sources
  WHERE id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Experience source is unavailable for deletion'
      USING ERRCODE = '40001';
  END IF;

  IF source_row.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'source_id', source_row.id,
      'status', source_row.status,
      'already_deleted', true,
      'storage_bucket', source_row.storage_bucket,
      'storage_path', source_row.storage_path,
      'cleanup_error', source_row.cleanup_error,
      'deleted_parent_count', 0,
      'deleted_child_count', 0,
      'deleted_revision_count', 0,
      'deleted_extraction_count', 0,
      'deleted_staging_count', 0
    );
  END IF;

  SELECT COALESCE(array_agg(DISTINCT rp.parent_id), ARRAY[]::uuid[]),
         count(DISTINCT rp.parent_id)::integer,
         count(c.id)::integer
    INTO parent_ids, mapped_parent_count, mapped_child_count
  FROM public.experience_revisions r
  JOIN public.experience_revision_parents rp
    ON rp.revision_id = r.id
  LEFT JOIN public.document_chunks c
    ON c.parent_id = rp.parent_id
  WHERE r.source_id = p_source_id;

  SELECT count(*)::integer INTO staging_count
  FROM public.experience_index_staging st
  JOIN public.experience_revisions r
    ON r.id = st.revision_id
  WHERE r.source_id = p_source_id;

  SELECT count(*)::integer INTO revision_count
  FROM public.experience_revisions
  WHERE source_id = p_source_id;

  SELECT count(*)::integer INTO extraction_count
  FROM public.experience_extractions
  WHERE source_id = p_source_id;

  UPDATE public.experience_sources
  SET latest_extraction_id = NULL,
      latest_draft_revision_id = NULL,
      latest_approved_revision_id = NULL,
      active_revision_id = NULL,
      status = 'deleted',
      failure = NULL,
      cleanup_error = NULL,
      deleted_at = clock_timestamp()
  WHERE id = p_source_id;

  IF COALESCE(array_length(parent_ids, 1), 0) > 0 THEN
    DELETE FROM public.parent_documents p
    WHERE p.id = ANY(parent_ids);
    GET DIAGNOSTICS deleted_parent_count = ROW_COUNT;
  END IF;

  DELETE FROM public.experience_revisions
  WHERE source_id = p_source_id;

  DELETE FROM public.experience_extractions
  WHERE source_id = p_source_id;

  RETURN jsonb_build_object(
    'source_id', p_source_id,
    'status', 'deleted',
    'already_deleted', false,
    'storage_bucket', source_row.storage_bucket,
    'storage_path', source_row.storage_path,
    'deleted_parent_count', deleted_parent_count,
    'deleted_child_count', mapped_child_count,
    'deleted_revision_count', revision_count,
    'deleted_extraction_count', extraction_count,
    'deleted_staging_count', staging_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_experience_source(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_experience_source(uuid) TO service_role;

COMMIT;
