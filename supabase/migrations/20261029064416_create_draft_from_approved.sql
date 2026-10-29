BEGIN;
SET LOCAL search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.create_experience_draft_from_approved(
  p_source_id uuid,
  p_approved_revision_id uuid,
  p_new_revision_id uuid,
  p_draft_json jsonb,
  p_draft_version integer DEFAULT 1
)
RETURNS public.experience_revisions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog AS $$
DECLARE
  source_row public.experience_sources%ROWTYPE;
  approved_row public.experience_revisions%ROWTYPE;
  draft_row public.experience_revisions%ROWTYPE;
BEGIN
  IF p_new_revision_id IS NULL THEN
    RAISE EXCEPTION 'New draft revision ID is required';
  END IF;
  IF p_draft_version IS NULL OR p_draft_version < 1 THEN
    RAISE EXCEPTION 'Draft version must be positive';
  END IF;
  IF p_draft_json IS NULL OR jsonb_typeof(p_draft_json) <> 'object' THEN
    RAISE EXCEPTION 'Draft JSON must be a JSON object';
  END IF;

  SELECT *
    INTO source_row
  FROM public.experience_sources
  WHERE id = p_source_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Experience source is not available for draft creation';
  END IF;

  SELECT *
    INTO approved_row
  FROM public.experience_revisions
  WHERE id = p_approved_revision_id
    AND source_id = p_source_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved experience revision was not found';
  END IF;

  IF approved_row.status NOT IN ('approved', 'indexing', 'indexed')
     OR approved_row.approved_json IS NULL
     OR approved_row.approved_content_hash IS NULL THEN
    RAISE EXCEPTION 'Experience revision is not an approved retained revision';
  END IF;

  INSERT INTO public.experience_revisions (
    id,
    source_id,
    extraction_id,
    status,
    draft_json,
    draft_version,
    model_version,
    prompt_version,
    parse_error
  ) VALUES (
    p_new_revision_id,
    p_source_id,
    approved_row.extraction_id,
    'draft',
    p_draft_json,
    p_draft_version,
    approved_row.model_version,
    approved_row.prompt_version,
    NULL
  )
  RETURNING * INTO draft_row;

  UPDATE public.experience_sources s
  SET status = 'draft',
      latest_draft_revision_id = draft_row.id,
      failure = NULL
  WHERE s.id = p_source_id
    AND s.deleted_at IS NULL;

  RETURN draft_row;
END;
$$;

REVOKE ALL ON FUNCTION public.create_experience_draft_from_approved(uuid, uuid, uuid, jsonb, integer)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_experience_draft_from_approved(uuid, uuid, uuid, jsonb, integer)
TO service_role;

COMMIT;
