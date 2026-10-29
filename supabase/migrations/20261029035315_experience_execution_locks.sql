BEGIN;
SET LOCAL search_path = public, extensions;

ALTER TABLE public.experience_sources
  ADD COLUMN IF NOT EXISTS execution_stage text CHECK (
    execution_stage IS NULL OR execution_stage IN ('extracting', 'parsing', 'indexing', 'deleting')
  ),
  ADD COLUMN IF NOT EXISTS execution_token uuid,
  ADD COLUMN IF NOT EXISTS execution_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS execution_started_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'experience_sources_execution_token_consistency'
      AND conrelid = 'public.experience_sources'::regclass
  ) THEN
    ALTER TABLE public.experience_sources
      ADD CONSTRAINT experience_sources_execution_token_consistency CHECK (
        (
          execution_stage IS NULL
          AND execution_token IS NULL
          AND execution_token_expires_at IS NULL
          AND execution_started_at IS NULL
        )
        OR (
          execution_stage IS NOT NULL
          AND execution_token IS NOT NULL
          AND execution_token_expires_at IS NOT NULL
          AND execution_started_at IS NOT NULL
        )
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS experience_sources_execution_token_idx
  ON public.experience_sources (execution_token)
  WHERE execution_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS experience_sources_execution_expiry_idx
  ON public.experience_sources (execution_token_expires_at)
  WHERE execution_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.acquire_experience_source_execution(
  p_source_id uuid,
  p_stage text,
  p_lease_seconds integer
)
RETURNS TABLE (
  source_id uuid,
  execution_token uuid,
  execution_stage text,
  execution_token_expires_at timestamptz,
  status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog AS $$
DECLARE
  normalized_stage text := COALESCE(btrim(p_stage), '');
  now_at timestamptz := statement_timestamp();
  expires_at timestamptz;
BEGIN
  IF normalized_stage NOT IN ('extracting', 'parsing', 'indexing') THEN
    RAISE EXCEPTION 'Unsupported experience execution stage: %', normalized_stage;
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 3600 THEN
    RAISE EXCEPTION 'Experience execution lease must be between 1 and 3600 seconds';
  END IF;

  expires_at := now_at + make_interval(secs => p_lease_seconds);

  RETURN QUERY
  UPDATE public.experience_sources s
  SET execution_stage = normalized_stage,
      execution_token = gen_random_uuid(),
      execution_started_at = now_at,
      execution_token_expires_at = expires_at,
      status = normalized_stage,
      failure = NULL
  WHERE s.id = p_source_id
    AND s.deleted_at IS NULL
    AND (
      s.execution_token IS NULL
      OR s.execution_token_expires_at <= now_at
    )
  RETURNING
    s.id,
    s.execution_token,
    s.execution_stage,
    s.execution_token_expires_at,
    s.status;

  IF FOUND THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.experience_sources s
    WHERE s.id = p_source_id
      AND s.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Experience source is not available for execution';
  END IF;

  RAISE EXCEPTION 'Experience source execution is already leased'
    USING ERRCODE = '55P03';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_experience_source_execution(
  p_source_id uuid,
  p_execution_token uuid,
  p_stage text,
  p_next_status text,
  p_latest_extraction_id uuid DEFAULT NULL,
  p_latest_draft_revision_id uuid DEFAULT NULL,
  p_failure jsonb DEFAULT NULL
)
RETURNS public.experience_sources
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog AS $$
DECLARE
  source_row public.experience_sources%ROWTYPE;
  normalized_stage text := COALESCE(btrim(p_stage), '');
  normalized_status text := COALESCE(btrim(p_next_status), '');
  now_at timestamptz := statement_timestamp();
BEGIN
  IF normalized_stage NOT IN ('extracting', 'parsing', 'indexing') THEN
    RAISE EXCEPTION 'Unsupported experience execution stage: %', normalized_stage;
  END IF;
  IF normalized_status NOT IN (
    'uploaded', 'extracting', 'extracted', 'parsing', 'draft',
    'approved', 'indexing', 'indexed', 'failed', 'deleted', 'cleanup-pending'
  ) THEN
    RAISE EXCEPTION 'Unsupported experience source status: %', normalized_status;
  END IF;
  IF p_failure IS NOT NULL AND jsonb_typeof(p_failure) <> 'object' THEN
    RAISE EXCEPTION 'Experience execution failure must be a JSON object';
  END IF;

  UPDATE public.experience_sources s
  SET status = normalized_status,
      latest_extraction_id = COALESCE(p_latest_extraction_id, s.latest_extraction_id),
      latest_draft_revision_id = COALESCE(p_latest_draft_revision_id, s.latest_draft_revision_id),
      failure = p_failure,
      execution_stage = NULL,
      execution_token = NULL,
      execution_token_expires_at = NULL,
      execution_started_at = NULL
  WHERE s.id = p_source_id
    AND s.deleted_at IS NULL
    AND s.execution_token = p_execution_token
    AND s.execution_stage = normalized_stage
    AND s.execution_token_expires_at > now_at
  RETURNING * INTO source_row;

  IF FOUND THEN
    RETURN source_row;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.experience_sources s
    WHERE s.id = p_source_id
      AND s.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Experience source is not available for completion';
  END IF;

  RAISE EXCEPTION 'Experience execution token is stale or expired'
    USING ERRCODE = '40001';
END;
$$;

CREATE OR REPLACE FUNCTION public.update_experience_revision_draft(
  p_revision_id uuid,
  p_expected_draft_version integer,
  p_draft_json jsonb
)
RETURNS public.experience_revisions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog AS $$
DECLARE
  revision_row public.experience_revisions%ROWTYPE;
BEGIN
  IF p_expected_draft_version IS NULL OR p_expected_draft_version < 1 THEN
    RAISE EXCEPTION 'Expected draft version must be positive';
  END IF;
  IF p_draft_json IS NULL OR jsonb_typeof(p_draft_json) <> 'object' THEN
    RAISE EXCEPTION 'Draft JSON must be a JSON object';
  END IF;

  UPDATE public.experience_revisions r
  SET draft_json = p_draft_json,
      draft_version = r.draft_version + 1
  WHERE r.id = p_revision_id
    AND r.status = 'draft'
    AND r.approved_content_hash IS NULL
    AND r.draft_version = p_expected_draft_version
  RETURNING * INTO revision_row;

  IF FOUND THEN
    RETURN revision_row;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.experience_revisions r
    WHERE r.id = p_revision_id
  ) THEN
    RAISE EXCEPTION 'Experience revision draft was not found';
  END IF;

  RAISE EXCEPTION 'Experience revision draft version conflict'
    USING ERRCODE = '40001';
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_experience_source_execution(uuid, text, integer)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_experience_source_execution(uuid, uuid, text, text, uuid, uuid, jsonb)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_experience_revision_draft(uuid, integer, jsonb)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.acquire_experience_source_execution(uuid, text, integer)
TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_experience_source_execution(uuid, uuid, text, text, uuid, uuid, jsonb)
TO service_role;
GRANT EXECUTE ON FUNCTION public.update_experience_revision_draft(uuid, integer, jsonb)
TO service_role;

COMMIT;
