BEGIN;
SET LOCAL search_path = public, extensions;

CREATE TABLE public.experience_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_byte_sha256 text NOT NULL CHECK (btrim(original_byte_sha256) <> ''),
  original_file_name text NOT NULL CHECK (btrim(original_file_name) <> ''),
  original_file_type text NOT NULL CHECK (btrim(original_file_type) <> ''),
  original_file_size bigint NOT NULL CHECK (original_file_size > 0),
  storage_bucket text NOT NULL DEFAULT 'experience-sources' CHECK (btrim(storage_bucket) <> ''),
  storage_path text NOT NULL CHECK (btrim(storage_path) <> ''),
  status text NOT NULL DEFAULT 'uploaded' CHECK (
    status IN (
      'uploaded', 'extracting', 'extracted', 'parsing', 'draft',
      'approved', 'indexing', 'indexed', 'failed', 'deleted', 'cleanup-pending'
    )
  ),
  latest_extraction_id uuid,
  latest_draft_revision_id uuid,
  latest_approved_revision_id uuid,
  active_revision_id uuid,
  failure jsonb CHECK (failure IS NULL OR jsonb_typeof(failure) = 'object'),
  cleanup_error jsonb CHECK (cleanup_error IS NULL OR jsonb_typeof(cleanup_error) = 'object'),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX experience_sources_live_byte_sha256_key
  ON public.experience_sources (original_byte_sha256)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX experience_sources_live_storage_path_key
  ON public.experience_sources (storage_bucket, storage_path)
  WHERE deleted_at IS NULL;
CREATE INDEX experience_sources_latest_extraction_id_idx
  ON public.experience_sources (latest_extraction_id)
  WHERE latest_extraction_id IS NOT NULL;
CREATE INDEX experience_sources_latest_draft_revision_id_idx
  ON public.experience_sources (latest_draft_revision_id)
  WHERE latest_draft_revision_id IS NOT NULL;
CREATE INDEX experience_sources_latest_approved_revision_id_idx
  ON public.experience_sources (latest_approved_revision_id)
  WHERE latest_approved_revision_id IS NOT NULL;
CREATE INDEX experience_sources_active_revision_id_idx
  ON public.experience_sources (active_revision_id)
  WHERE active_revision_id IS NOT NULL;

CREATE TABLE public.experience_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.experience_sources(id) ON DELETE CASCADE,
  text_sha256 text NOT NULL CHECK (btrim(text_sha256) <> ''),
  parser_version text NOT NULL CHECK (btrim(parser_version) <> ''),
  normalization_version text NOT NULL CHECK (btrim(normalization_version) <> ''),
  blocks jsonb NOT NULL CHECK (jsonb_typeof(blocks) = 'array' AND jsonb_array_length(blocks) > 0),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(warnings) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, text_sha256, parser_version, normalization_version)
);

CREATE INDEX experience_extractions_source_id_idx
  ON public.experience_extractions (source_id, created_at DESC);

CREATE TABLE public.experience_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.experience_sources(id) ON DELETE CASCADE,
  extraction_id uuid NOT NULL REFERENCES public.experience_extractions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'indexing', 'indexed', 'failed')),
  draft_json jsonb NOT NULL CHECK (jsonb_typeof(draft_json) = 'object'),
  draft_version integer NOT NULL DEFAULT 1 CHECK (draft_version > 0),
  approved_json jsonb CHECK (approved_json IS NULL OR jsonb_typeof(approved_json) = 'object'),
  approved_content_hash text CHECK (approved_content_hash IS NULL OR btrim(approved_content_hash) <> ''),
  approved_at timestamptz,
  model_version text CHECK (model_version IS NULL OR btrim(model_version) <> ''),
  prompt_version text CHECK (prompt_version IS NULL OR btrim(prompt_version) <> ''),
  parse_error jsonb CHECK (parse_error IS NULL OR jsonb_typeof(parse_error) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (approved_json IS NULL AND approved_content_hash IS NULL AND approved_at IS NULL)
    OR (approved_json IS NOT NULL AND approved_content_hash IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE INDEX experience_revisions_source_id_idx
  ON public.experience_revisions (source_id, created_at DESC);
CREATE INDEX experience_revisions_extraction_id_idx
  ON public.experience_revisions (extraction_id);
CREATE UNIQUE INDEX experience_revisions_approved_hash_key
  ON public.experience_revisions (source_id, approved_content_hash)
  WHERE approved_content_hash IS NOT NULL;

CREATE TABLE public.experience_revision_parents (
  revision_id uuid NOT NULL REFERENCES public.experience_revisions(id) ON DELETE CASCADE,
  parent_id uuid NOT NULL REFERENCES public.parent_documents(id) ON DELETE CASCADE,
  logical_experience_id text NOT NULL CHECK (btrim(logical_experience_id) <> ''),
  logical_parent_id text NOT NULL CHECK (btrim(logical_parent_id) <> ''),
  plan_hash text NOT NULL CHECK (btrim(plan_hash) <> ''),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (revision_id, parent_id),
  UNIQUE (parent_id),
  UNIQUE (revision_id, logical_parent_id)
);

CREATE INDEX experience_revision_parents_revision_id_idx
  ON public.experience_revision_parents (revision_id);

CREATE TABLE public.experience_index_staging (
  revision_id uuid NOT NULL REFERENCES public.experience_revisions(id) ON DELETE CASCADE,
  logical_chunk_key text NOT NULL CHECK (btrim(logical_chunk_key) <> ''),
  plan_hash text NOT NULL CHECK (btrim(plan_hash) <> ''),
  approved_content_hash text NOT NULL CHECK (btrim(approved_content_hash) <> ''),
  chunking_version text NOT NULL CHECK (btrim(chunking_version) <> ''),
  embedding_model text NOT NULL CHECK (btrim(embedding_model) <> ''),
  embedding_task_type text NOT NULL DEFAULT 'RETRIEVAL_DOCUMENT' CHECK (embedding_task_type = 'RETRIEVAL_DOCUMENT'),
  embedding_dimensions integer NOT NULL DEFAULT 1536 CHECK (embedding_dimensions = 1536),
  parent_payload jsonb NOT NULL CHECK (jsonb_typeof(parent_payload) = 'object'),
  child_payload jsonb NOT NULL CHECK (jsonb_typeof(child_payload) = 'object'),
  embedding vector(1536) CHECK (embedding IS NULL OR vector_norm(embedding) > 0),
  prepared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (revision_id, logical_chunk_key)
);

CREATE INDEX experience_index_staging_revision_id_idx
  ON public.experience_index_staging (revision_id, prepared_at NULLS FIRST);

ALTER TABLE public.experience_sources
  ADD CONSTRAINT experience_sources_latest_extraction_fk
    FOREIGN KEY (latest_extraction_id) REFERENCES public.experience_extractions(id) ON DELETE SET NULL,
  ADD CONSTRAINT experience_sources_latest_draft_revision_fk
    FOREIGN KEY (latest_draft_revision_id) REFERENCES public.experience_revisions(id) ON DELETE SET NULL,
  ADD CONSTRAINT experience_sources_latest_approved_revision_fk
    FOREIGN KEY (latest_approved_revision_id) REFERENCES public.experience_revisions(id) ON DELETE SET NULL,
  ADD CONSTRAINT experience_sources_active_revision_fk
    FOREIGN KEY (active_revision_id) REFERENCES public.experience_revisions(id) ON DELETE SET NULL;

CREATE TRIGGER experience_sources_updated_at
  BEFORE UPDATE ON public.experience_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_evidence_updated_at();
CREATE TRIGGER experience_revisions_updated_at
  BEFORE UPDATE ON public.experience_revisions
  FOR EACH ROW EXECUTE FUNCTION public.set_evidence_updated_at();
CREATE TRIGGER experience_index_staging_updated_at
  BEFORE UPDATE ON public.experience_index_staging
  FOR EACH ROW EXECUTE FUNCTION public.set_evidence_updated_at();

ALTER TABLE public.experience_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_revision_parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experience_index_staging ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON
  public.experience_sources,
  public.experience_extractions,
  public.experience_revisions,
  public.experience_revision_parents,
  public.experience_index_staging
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.experience_sources,
  public.experience_extractions,
  public.experience_revisions,
  public.experience_revision_parents,
  public.experience_index_staging
TO service_role;

COMMIT;
