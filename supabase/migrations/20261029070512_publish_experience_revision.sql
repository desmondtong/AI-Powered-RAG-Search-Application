BEGIN;
SET LOCAL search_path = public, extensions;

CREATE FUNCTION public.publish_experience_revision(
  p_source_id uuid,
  p_revision_id uuid,
  p_plan_hash text,
  p_approved_content_hash text,
  p_expected_parent_count integer,
  p_expected_child_count integer,
  p_chunking_version text,
  p_embedding_model text,
  p_embedding_task_type text DEFAULT 'RETRIEVAL_DOCUMENT',
  p_embedding_dimensions integer DEFAULT 1536
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, extensions AS $$
DECLARE
  source_row public.experience_sources%ROWTYPE;
  revision_row public.experience_revisions%ROWTYPE;
  child_count integer;
  parent_count integer;
  payload_parent_count integer;
  published_parent_count integer := 0;
  published_child_count integer := 0;
  previous_active_revision_id uuid;
  parent_record record;
  inserted jsonb;
  inserted_parent_id uuid;
BEGIN
  IF p_plan_hash IS NULL OR btrim(p_plan_hash) = '' THEN
    RAISE EXCEPTION 'plan_hash is required';
  END IF;
  IF p_approved_content_hash IS NULL OR btrim(p_approved_content_hash) = '' THEN
    RAISE EXCEPTION 'approved_content_hash is required';
  END IF;
  IF p_expected_parent_count IS NULL OR p_expected_parent_count < 1 THEN
    RAISE EXCEPTION 'expected_parent_count must be positive';
  END IF;
  IF p_expected_child_count IS NULL OR p_expected_child_count < 1 THEN
    RAISE EXCEPTION 'expected_child_count must be positive';
  END IF;
  IF p_chunking_version IS NULL OR btrim(p_chunking_version) = '' THEN
    RAISE EXCEPTION 'chunking_version is required';
  END IF;
  IF p_embedding_model IS NULL OR btrim(p_embedding_model) = '' THEN
    RAISE EXCEPTION 'embedding_model is required';
  END IF;
  IF p_embedding_task_type <> 'RETRIEVAL_DOCUMENT' THEN
    RAISE EXCEPTION 'embedding_task_type must be RETRIEVAL_DOCUMENT';
  END IF;
  IF p_embedding_dimensions <> 1536 THEN
    RAISE EXCEPTION 'embedding_dimensions must be 1536';
  END IF;

  SELECT * INTO source_row
  FROM public.experience_sources
  WHERE id = p_source_id
  FOR UPDATE;
  IF NOT FOUND OR source_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Experience source is unavailable for publication'
      USING ERRCODE = '40001';
  END IF;

  SELECT * INTO revision_row
  FROM public.experience_revisions
  WHERE id = p_revision_id
    AND source_id = p_source_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Experience revision is unavailable for publication'
      USING ERRCODE = '40001';
  END IF;

  IF source_row.active_revision_id = p_revision_id
     AND revision_row.status = 'indexed' THEN
    RETURN jsonb_build_object(
      'status', 'indexed',
      'already_published', true,
      'revision_id', p_revision_id,
      'active_revision_id', source_row.active_revision_id,
      'parent_count', (
        SELECT count(*)
        FROM public.experience_revision_parents
        WHERE revision_id = p_revision_id
      ),
      'child_count', p_expected_child_count
    );
  END IF;

  IF source_row.latest_approved_revision_id IS DISTINCT FROM p_revision_id THEN
    RAISE EXCEPTION 'Experience publication candidate is stale'
      USING ERRCODE = '40001';
  END IF;
  IF revision_row.status NOT IN ('approved', 'indexing') THEN
    RAISE EXCEPTION 'Experience revision is not publishable'
      USING ERRCODE = '40001';
  END IF;
  IF revision_row.approved_content_hash IS DISTINCT FROM lower(btrim(p_approved_content_hash)) THEN
    RAISE EXCEPTION 'Approved content hash does not match retained revision'
      USING ERRCODE = '40001';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.experience_revision_parents
    WHERE revision_id = p_revision_id
  ) THEN
    RAISE EXCEPTION 'Experience revision already has publication mappings but is not active'
      USING ERRCODE = '40001';
  END IF;

  SELECT count(*),
         count(DISTINCT parent_payload->'metadata'->>'logical_parent_id')
    INTO child_count, parent_count
  FROM public.experience_index_staging
  WHERE revision_id = p_revision_id
    AND plan_hash = p_plan_hash
    AND approved_content_hash = lower(btrim(p_approved_content_hash))
    AND chunking_version = p_chunking_version
    AND embedding_model = p_embedding_model
    AND embedding_task_type = p_embedding_task_type
    AND embedding_dimensions = p_embedding_dimensions
    AND prepared_at IS NOT NULL
    AND embedding IS NOT NULL;

  IF child_count <> p_expected_child_count THEN
    RAISE EXCEPTION 'Prepared child count mismatch: expected %, found %', p_expected_child_count, child_count;
  END IF;
  IF parent_count <> p_expected_parent_count THEN
    RAISE EXCEPTION 'Prepared parent count mismatch: expected %, found %', p_expected_parent_count, parent_count;
  END IF;

  SELECT count(*) INTO payload_parent_count
  FROM (
    SELECT DISTINCT
      parent_payload->'metadata'->>'logical_parent_id' AS logical_parent_id,
      parent_payload
    FROM public.experience_index_staging
    WHERE revision_id = p_revision_id
      AND plan_hash = p_plan_hash
      AND approved_content_hash = lower(btrim(p_approved_content_hash))
      AND chunking_version = p_chunking_version
      AND embedding_model = p_embedding_model
      AND embedding_task_type = p_embedding_task_type
      AND embedding_dimensions = p_embedding_dimensions
      AND prepared_at IS NOT NULL
      AND embedding IS NOT NULL
  ) parent_payloads;
  IF payload_parent_count <> p_expected_parent_count THEN
    RAISE EXCEPTION 'Prepared parent payloads are inconsistent with expected parent count';
  END IF;

  UPDATE public.experience_revisions
  SET status = 'indexing'
  WHERE id = p_revision_id;

  previous_active_revision_id := source_row.active_revision_id;

  FOR parent_record IN
    SELECT
      parent_payload,
      parent_payload->'metadata'->>'logical_experience_id' AS logical_experience_id,
      parent_payload->'metadata'->>'logical_parent_id' AS logical_parent_id,
      jsonb_agg(
        child_payload || jsonb_build_object('embedding', embedding::text)
        ORDER BY COALESCE((child_payload->>'chunk_index')::integer, 0), logical_chunk_key
      ) AS chunks
    FROM public.experience_index_staging
    WHERE revision_id = p_revision_id
      AND plan_hash = p_plan_hash
      AND approved_content_hash = lower(btrim(p_approved_content_hash))
      AND chunking_version = p_chunking_version
      AND embedding_model = p_embedding_model
      AND embedding_task_type = p_embedding_task_type
      AND embedding_dimensions = p_embedding_dimensions
      AND prepared_at IS NOT NULL
      AND embedding IS NOT NULL
    GROUP BY
      parent_payload,
      parent_payload->'metadata'->>'logical_experience_id',
      parent_payload->'metadata'->>'logical_parent_id'
    ORDER BY parent_payload->'metadata'->>'logical_parent_id'
  LOOP
    IF parent_record.logical_experience_id IS NULL
       OR parent_record.logical_parent_id IS NULL THEN
      RAISE EXCEPTION 'Prepared parent payload is missing logical lineage';
    END IF;

    inserted := public.insert_project_evidence(parent_record.parent_payload, parent_record.chunks);
    inserted_parent_id := (inserted->'parent'->>'id')::uuid;
    IF inserted_parent_id IS NULL THEN
      RAISE EXCEPTION 'Evidence insertion did not return a parent id';
    END IF;

    INSERT INTO public.experience_revision_parents (
      revision_id, parent_id, logical_experience_id, logical_parent_id, plan_hash, metadata
    ) VALUES (
      p_revision_id,
      inserted_parent_id,
      parent_record.logical_experience_id,
      parent_record.logical_parent_id,
      p_plan_hash,
      jsonb_build_object(
        'plan_hash', p_plan_hash,
        'approved_content_hash', lower(btrim(p_approved_content_hash)),
        'chunking_version', p_chunking_version,
        'embedding_model', p_embedding_model,
        'embedding_task_type', p_embedding_task_type,
        'embedding_dimensions', p_embedding_dimensions
      )
    );

    published_parent_count := published_parent_count + 1;
    published_child_count := published_child_count + (inserted->>'chunkCount')::integer;
  END LOOP;

  IF published_parent_count <> p_expected_parent_count
     OR published_child_count <> p_expected_child_count THEN
    RAISE EXCEPTION 'Published count mismatch after insertion';
  END IF;

  IF previous_active_revision_id IS NOT NULL
     AND previous_active_revision_id <> p_revision_id THEN
    DELETE FROM public.parent_documents p
    USING public.experience_revision_parents rp
    WHERE rp.revision_id = previous_active_revision_id
      AND rp.parent_id = p.id;
  END IF;

  UPDATE public.experience_revisions
  SET status = 'indexed'
  WHERE id = p_revision_id;

  UPDATE public.experience_sources
  SET active_revision_id = p_revision_id,
      status = 'indexed',
      failure = NULL
  WHERE id = p_source_id;

  DELETE FROM public.experience_index_staging
  WHERE revision_id = p_revision_id;

  RETURN jsonb_build_object(
    'status', 'indexed',
    'already_published', false,
    'revision_id', p_revision_id,
    'active_revision_id', p_revision_id,
    'previous_active_revision_id', previous_active_revision_id,
    'parent_count', published_parent_count,
    'child_count', published_child_count,
    'plan_hash', p_plan_hash
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_experience_revision(
  uuid, uuid, text, text, integer, integer, text, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_experience_revision(
  uuid, uuid, text, text, integer, integer, text, text, text, integer
) TO service_role;

COMMIT;
