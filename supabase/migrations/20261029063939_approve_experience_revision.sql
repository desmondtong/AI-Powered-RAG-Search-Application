BEGIN;
SET LOCAL search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.approve_experience_revision(
  p_source_id uuid,
  p_revision_id uuid,
  p_expected_draft_version integer,
  p_approved_json jsonb,
  p_approved_content_hash text
)
RETURNS public.experience_revisions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog AS $$
DECLARE
  source_row public.experience_sources%ROWTYPE;
  revision_row public.experience_revisions%ROWTYPE;
  normalized_hash text := COALESCE(lower(btrim(p_approved_content_hash)), '');
  now_at timestamptz := statement_timestamp();
BEGIN
  IF p_expected_draft_version IS NULL OR p_expected_draft_version < 1 THEN
    RAISE EXCEPTION 'Expected draft version must be positive';
  END IF;
  IF p_approved_json IS NULL OR jsonb_typeof(p_approved_json) <> 'object' THEN
    RAISE EXCEPTION 'Approved JSON must be a JSON object';
  END IF;
  IF normalized_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Approved content hash must be a 64-character lowercase SHA-256 hex value';
  END IF;

  SELECT *
    INTO source_row
  FROM public.experience_sources
  WHERE id = p_source_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Experience source is not available for approval';
  END IF;

  SELECT *
    INTO revision_row
  FROM public.experience_revisions
  WHERE id = p_revision_id
    AND source_id = p_source_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Experience draft revision was not found';
  END IF;

  IF source_row.latest_draft_revision_id IS DISTINCT FROM p_revision_id THEN
    RAISE EXCEPTION 'Experience approval candidate is stale'
      USING ERRCODE = '40001';
  END IF;

  IF revision_row.status <> 'draft'
     OR revision_row.approved_content_hash IS NOT NULL
     OR revision_row.approved_json IS NOT NULL
     OR revision_row.draft_version <> p_expected_draft_version THEN
    RAISE EXCEPTION 'Experience revision approval version conflict'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.experience_revisions r
  SET status = 'approved',
      approved_json = p_approved_json,
      approved_content_hash = normalized_hash,
      approved_at = now_at
  WHERE r.id = p_revision_id
    AND r.source_id = p_source_id
    AND r.status = 'draft'
    AND r.approved_content_hash IS NULL
    AND r.draft_version = p_expected_draft_version
  RETURNING * INTO revision_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Experience revision approval version conflict'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.experience_sources s
  SET status = 'approved',
      latest_draft_revision_id = NULL,
      latest_approved_revision_id = p_revision_id,
      failure = NULL
  WHERE s.id = p_source_id
    AND s.deleted_at IS NULL;

  RETURN revision_row;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_experience_revision(uuid, uuid, integer, jsonb, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.approve_experience_revision(uuid, uuid, integer, jsonb, text)
TO service_role;

COMMIT;
