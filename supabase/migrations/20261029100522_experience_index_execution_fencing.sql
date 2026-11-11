BEGIN;
SET LOCAL search_path = public, extensions;

CREATE FUNCTION public.stage_experience_embeddings(
  p_source_id uuid,
  p_revision_id uuid,
  p_execution_token uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, extensions, pg_catalog AS $$
DECLARE
  source_row public.experience_sources%ROWTYPE;
  revision_row public.experience_revisions%ROWTYPE;
  row_count integer;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'Embedding staging batch must contain between 1 and 3 rows';
  END IF;

  SELECT * INTO source_row
  FROM public.experience_sources WHERE id = p_source_id FOR UPDATE;
  SELECT * INTO revision_row
  FROM public.experience_revisions
  WHERE id = p_revision_id AND source_id = p_source_id FOR UPDATE;

  IF source_row.id IS NULL OR source_row.deleted_at IS NOT NULL
     OR p_execution_token IS NULL
     OR source_row.execution_token IS DISTINCT FROM p_execution_token
     OR source_row.execution_stage IS DISTINCT FROM 'indexing'
     OR source_row.execution_token_expires_at IS NULL
     OR source_row.execution_token_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'Experience indexing execution token is stale or expired'
      USING ERRCODE = '40001';
  END IF;
  IF revision_row.id IS NULL OR revision_row.status NOT IN ('approved', 'indexing')
     OR revision_row.approved_content_hash IS NULL
     OR source_row.latest_approved_revision_id IS DISTINCT FROM p_revision_id THEN
    RAISE EXCEPTION 'Experience staging candidate is stale'
      USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) row_data
    WHERE row_data->>'revision_id' IS DISTINCT FROM p_revision_id::text
       OR row_data->>'approved_content_hash' IS DISTINCT FROM revision_row.approved_content_hash
       OR row_data->'parent_payload'->>'source_document_id' IS DISTINCT FROM p_source_id::text
       OR row_data->>'embedding_task_type' IS DISTINCT FROM 'RETRIEVAL_DOCUMENT'
       OR row_data->>'embedding_dimensions' IS DISTINCT FROM '1536'
       OR jsonb_typeof(row_data->'embedding') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION 'Embedding staging ownership or configuration mismatch';
  END IF;
  IF (SELECT count(DISTINCT row_data->>'logical_chunk_key')
      FROM jsonb_array_elements(p_rows) row_data) <> jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION 'Embedding staging chunk keys must be unique';
  END IF;
  IF (SELECT count(DISTINCT (
        row_data->>'plan_hash', row_data->>'chunking_version', row_data->>'embedding_model'
      )) FROM jsonb_array_elements(p_rows) row_data) <> 1 THEN
    RAISE EXCEPTION 'Embedding staging batch mixes preparation configurations';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.experience_index_staging st
    WHERE st.revision_id = p_revision_id
      AND (
        st.plan_hash IS DISTINCT FROM p_rows->0->>'plan_hash'
        OR st.chunking_version IS DISTINCT FROM p_rows->0->>'chunking_version'
        OR st.embedding_model IS DISTINCT FROM p_rows->0->>'embedding_model'
        OR st.approved_content_hash IS DISTINCT FROM revision_row.approved_content_hash
      )
  ) THEN
    RAISE EXCEPTION 'Embedding staging configuration conflicts with retained checkpoints'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.experience_index_staging (
    revision_id, logical_chunk_key, plan_hash, approved_content_hash,
    chunking_version, embedding_model, embedding_task_type, embedding_dimensions,
    parent_payload, child_payload, embedding, prepared_at
  )
  SELECT p_revision_id, x.logical_chunk_key, x.plan_hash, x.approved_content_hash,
    x.chunking_version, x.embedding_model, x.embedding_task_type, x.embedding_dimensions,
    x.parent_payload, x.child_payload, (x.embedding::text)::vector(1536), clock_timestamp()
  FROM jsonb_to_recordset(p_rows) AS x(
    logical_chunk_key text, plan_hash text, approved_content_hash text,
    chunking_version text, embedding_model text, embedding_task_type text,
    embedding_dimensions integer, parent_payload jsonb, child_payload jsonb, embedding jsonb
  )
  ON CONFLICT (revision_id, logical_chunk_key) DO UPDATE
  SET plan_hash = EXCLUDED.plan_hash,
      approved_content_hash = EXCLUDED.approved_content_hash,
      chunking_version = EXCLUDED.chunking_version,
      embedding_model = EXCLUDED.embedding_model,
      embedding_task_type = EXCLUDED.embedding_task_type,
      embedding_dimensions = EXCLUDED.embedding_dimensions,
      parent_payload = EXCLUDED.parent_payload,
      child_payload = EXCLUDED.child_payload,
      embedding = EXCLUDED.embedding,
      prepared_at = EXCLUDED.prepared_at;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count;
END;
$$;

-- Retain the atomic publication algorithm while fencing it after both locks.
DO $migration$
DECLARE
  body text;
BEGIN
  SELECT prosrc INTO STRICT body FROM pg_proc
  WHERE oid = 'public.publish_experience_revision(uuid,uuid,text,text,integer,integer,text,text,text,integer)'::regprocedure;
  IF strpos(body, 'IF source_row.latest_approved_revision_id') = 0
     OR strpos(body, 'SET active_revision_id = p_revision_id,') = 0 THEN
    RAISE EXCEPTION 'Publication function differs from the expected migration; aborting';
  END IF;
  body := replace(body, 'IF source_row.latest_approved_revision_id', $guard$
IF p_execution_token IS NULL
   OR source_row.execution_token IS DISTINCT FROM p_execution_token
   OR source_row.execution_stage IS DISTINCT FROM 'indexing'
   OR source_row.execution_token_expires_at IS NULL
   OR source_row.execution_token_expires_at <= clock_timestamp() THEN
  RAISE EXCEPTION 'Experience indexing execution token is stale or expired'
    USING ERRCODE = '40001';
END IF;
IF source_row.latest_approved_revision_id$guard$);
  body := replace(body, 'SET active_revision_id = p_revision_id,',
    'SET active_revision_id = p_revision_id, execution_token = NULL, execution_stage = NULL, execution_token_expires_at = NULL, execution_started_at = NULL,');
  body := replace(body, 'RETURN jsonb_build_object', $completion$
UPDATE public.experience_sources
SET execution_token = NULL, execution_stage = NULL,
    execution_token_expires_at = NULL, execution_started_at = NULL, status = 'indexed'
WHERE id = p_source_id;
RETURN jsonb_build_object$completion$);
  EXECUTE format($definition$
    CREATE FUNCTION public.publish_experience_revision(
      p_source_id uuid, p_revision_id uuid, p_plan_hash text, p_approved_content_hash text,
      p_expected_parent_count integer, p_expected_child_count integer,
      p_chunking_version text, p_embedding_model text,
      p_embedding_task_type text DEFAULT 'RETRIEVAL_DOCUMENT',
      p_embedding_dimensions integer DEFAULT 1536,
      p_execution_token uuid DEFAULT NULL
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
      SET search_path = public, extensions AS %L
  $definition$, body);
END;
$migration$;

DROP FUNCTION public.publish_experience_revision(
  uuid, uuid, text, text, integer, integer, text, text, text, integer
);

REVOKE ALL ON FUNCTION public.stage_experience_embeddings(uuid, uuid, uuid, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stage_experience_embeddings(uuid, uuid, uuid, jsonb)
TO service_role;
REVOKE ALL ON FUNCTION public.publish_experience_revision(
  uuid, uuid, text, text, integer, integer, text, text, text, integer, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_experience_revision(
  uuid, uuid, text, text, integer, integer, text, text, text, integer, uuid
) TO service_role;

COMMIT;
