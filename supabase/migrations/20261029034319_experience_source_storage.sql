BEGIN;
SET LOCAL search_path = public, extensions;

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'Supabase Storage buckets table is missing';
  END IF;
END;
$$;

INSERT INTO storage.buckets (id, name, "public")
VALUES ('experience-sources', 'experience-sources', false)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    "public" = false
WHERE storage.buckets.name IS DISTINCT FROM EXCLUDED.name
   OR storage.buckets."public" IS DISTINCT FROM false;

ALTER TABLE public.experience_sources
  ADD COLUMN IF NOT EXISTS storage_uploaded_at timestamptz;

CREATE OR REPLACE FUNCTION public.reserve_experience_source(
  p_original_byte_sha256 text,
  p_original_file_name text,
  p_original_file_type text,
  p_original_file_size bigint,
  p_storage_bucket text DEFAULT 'experience-sources',
  p_storage_path text DEFAULT NULL
)
RETURNS public.experience_sources
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog AS $$
DECLARE
  source_row public.experience_sources%ROWTYPE;
  normalized_hash text := COALESCE(lower(btrim(p_original_byte_sha256)), '');
  normalized_file_name text := COALESCE(btrim(p_original_file_name), '');
  normalized_file_type text := COALESCE(btrim(p_original_file_type), '');
  normalized_bucket text := COALESCE(NULLIF(btrim(p_storage_bucket), ''), 'experience-sources');
  normalized_path text := NULLIF(btrim(p_storage_path), '');
BEGIN
  IF normalized_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Original byte SHA-256 must be 64 lowercase hex characters';
  END IF;
  IF normalized_file_name = '' THEN
    RAISE EXCEPTION 'Original file name is required';
  END IF;
  IF normalized_file_type = '' THEN
    RAISE EXCEPTION 'Original file type is required';
  END IF;
  IF p_original_file_size IS NULL OR p_original_file_size <= 0 THEN
    RAISE EXCEPTION 'Original file size must be positive';
  END IF;
  IF normalized_bucket <> 'experience-sources' THEN
    RAISE EXCEPTION 'Experience sources must use the private experience-sources bucket';
  END IF;

  normalized_path := COALESCE(
    normalized_path,
    'sources/sha256/' || substr(normalized_hash, 1, 2) || '/' || normalized_hash || '/original.bin'
  );
  IF normalized_path LIKE '/%' OR normalized_path LIKE '%..%' OR normalized_path = '' THEN
    RAISE EXCEPTION 'Experience source storage path is invalid';
  END IF;

  SELECT *
    INTO source_row
  FROM public.experience_sources
  WHERE original_byte_sha256 = normalized_hash
    AND deleted_at IS NULL
  FOR UPDATE;

  IF FOUND THEN
    RETURN source_row;
  END IF;

  BEGIN
    INSERT INTO public.experience_sources (
      original_byte_sha256,
      original_file_name,
      original_file_type,
      original_file_size,
      storage_bucket,
      storage_path
    ) VALUES (
      normalized_hash,
      normalized_file_name,
      normalized_file_type,
      p_original_file_size,
      normalized_bucket,
      normalized_path
    )
    RETURNING * INTO source_row;

    RETURN source_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT *
      INTO source_row
    FROM public.experience_sources
    WHERE original_byte_sha256 = normalized_hash
      AND deleted_at IS NULL
    FOR UPDATE;

    IF FOUND THEN
      RETURN source_row;
    END IF;

    RAISE;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_experience_source_storage(
  p_source_id uuid,
  p_original_byte_sha256 text,
  p_storage_bucket text,
  p_storage_path text
)
RETURNS public.experience_sources
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog AS $$
DECLARE
  source_row public.experience_sources%ROWTYPE;
  normalized_hash text := COALESCE(lower(btrim(p_original_byte_sha256)), '');
  normalized_bucket text := COALESCE(btrim(p_storage_bucket), '');
  normalized_path text := COALESCE(btrim(p_storage_path), '');
BEGIN
  IF normalized_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Original byte SHA-256 must be 64 lowercase hex characters';
  END IF;
  IF normalized_bucket <> 'experience-sources' THEN
    RAISE EXCEPTION 'Experience sources must use the private experience-sources bucket';
  END IF;
  IF normalized_path LIKE '/%' OR normalized_path LIKE '%..%' OR normalized_path = '' THEN
    RAISE EXCEPTION 'Experience source storage path is invalid';
  END IF;

  UPDATE public.experience_sources
  SET storage_uploaded_at = COALESCE(storage_uploaded_at, clock_timestamp()),
      status = CASE WHEN status = 'failed' THEN 'uploaded' ELSE status END,
      failure = CASE WHEN status = 'failed' THEN NULL ELSE failure END
  WHERE id = p_source_id
    AND original_byte_sha256 = normalized_hash
    AND storage_bucket = normalized_bucket
    AND storage_path = normalized_path
    AND deleted_at IS NULL
  RETURNING * INTO source_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Experience source storage reconciliation target was not found';
  END IF;

  RETURN source_row;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_experience_source(text, text, text, bigint, text, text)
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_experience_source_storage(uuid, text, text, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reserve_experience_source(text, text, text, bigint, text, text)
TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_experience_source_storage(uuid, text, text, text)
TO service_role;

COMMIT;
