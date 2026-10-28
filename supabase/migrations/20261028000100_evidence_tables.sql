BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

CREATE TABLE public.parent_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id text NOT NULL CHECK (btrim(source_document_id) <> ''),
  source_file_name text NOT NULL CHECK (btrim(source_file_name) <> ''),
  source_file_type text NOT NULL CHECK (btrim(source_file_type) <> ''),
  parent_text text NOT NULL CHECK (btrim(parent_text) <> ''),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A source file can contain multiple projects or project sections.
CREATE INDEX parent_documents_source_document_id_idx
  ON public.parent_documents (source_document_id);

CREATE TABLE public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES public.parent_documents(id) ON DELETE CASCADE,
  child_text text NOT NULL CHECK (btrim(child_text) <> ''),
  embedding_text text NOT NULL CHECK (btrim(embedding_text) <> ''),
  embedding vector(1536) NOT NULL CHECK (vector_norm(embedding) > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_id, chunk_index)
);

CREATE INDEX document_chunks_embedding_idx
  ON public.document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE FUNCTION public.set_evidence_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER parent_documents_updated_at
  BEFORE UPDATE ON public.parent_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_evidence_updated_at();
CREATE TRIGGER document_chunks_updated_at
  BEFORE UPDATE ON public.document_chunks
  FOR EACH ROW EXECUTE FUNCTION public.set_evidence_updated_at();

ALTER TABLE public.parent_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parent_documents, public.document_chunks FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parent_documents, public.document_chunks TO service_role;

COMMIT;
