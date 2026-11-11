BEGIN;
SET LOCAL search_path = public, extensions;
SET LOCAL ROLE service_role;

DO $$
DECLARE
  s public.experience_sources%ROWTYPE;
  extraction_id uuid := gen_random_uuid();
  revision_id uuid := gen_random_uuid();
  token_a uuid;
  token_b uuid;
  rows jsonb;
  result jsonb;
  rejected boolean;
BEGIN
  SELECT * INTO s FROM public.reserve_experience_source(repeat('e', 64), 'fencing.docx', 'docx', 42);
  INSERT INTO public.experience_extractions(id, source_id, text_sha256, parser_version, normalization_version, blocks)
  VALUES(extraction_id, s.id, 'fencing-text', 'v1', 'v1', '[{"block_id":"b1","text":"Citation"}]');
  INSERT INTO public.experience_revisions(id, source_id, extraction_id, draft_json)
  VALUES(revision_id, s.id, extraction_id, '{"draft":true}');
  UPDATE public.experience_sources SET latest_draft_revision_id = revision_id WHERE id = s.id;
  PERFORM public.approve_experience_revision(s.id, revision_id, 1, '{"approved":true}', repeat('f', 64));
  SELECT execution_token INTO token_a FROM public.acquire_experience_source_execution(s.id, 'indexing', 300);
  rows := jsonb_build_array(jsonb_build_object(
    'revision_id', revision_id, 'logical_chunk_key', 'chunk-1', 'plan_hash', 'fencing-plan',
    'approved_content_hash', repeat('f', 64), 'chunking_version', 'v1',
    'embedding_model', 'gemini-embedding-001', 'embedding_task_type', 'RETRIEVAL_DOCUMENT',
    'embedding_dimensions', 1536,
    'parent_payload', jsonb_build_object('source_document_id', s.id::text,
      'source_file_name', 'fencing.docx', 'source_file_type', 'docx', 'parent_text', 'Citation',
      'metadata', jsonb_build_object('logical_experience_id', 'experience-1', 'logical_parent_id', 'parent-1')),
    'child_payload', '{"child_text":"Citation","embedding_text":"Citation","metadata":{"logical_chunk_id":"chunk-1"},"chunk_index":0}'::jsonb,
    'embedding', ('[1,' || repeat('0,', 1534) || '0]')::jsonb
  ));
  UPDATE public.experience_sources
  SET execution_token_expires_at = clock_timestamp() - interval '1 second' WHERE id = s.id;
  rejected := false;
  BEGIN PERFORM public.stage_experience_embeddings(s.id, revision_id, token_a, rows);
  EXCEPTION WHEN serialization_failure THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expired token staged embeddings'; END IF;
  rejected := false;
  BEGIN
    PERFORM public.publish_experience_revision(s.id, revision_id, 'fencing-plan', repeat('f', 64), 1, 1, 'v1', 'gemini-embedding-001', 'RETRIEVAL_DOCUMENT', 1536, token_a);
  EXCEPTION WHEN serialization_failure THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Expired token published'; END IF;
  SELECT execution_token INTO token_b FROM public.acquire_experience_source_execution(s.id, 'indexing', 300);
  rejected := false;
  BEGIN PERFORM public.stage_experience_embeddings(s.id, revision_id, token_a, rows);
  EXCEPTION WHEN serialization_failure THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Replaced token staged embeddings'; END IF;
  IF public.stage_experience_embeddings(s.id, revision_id, token_b, rows) <> 1 THEN
    RAISE EXCEPTION 'Current token did not stage embeddings';
  END IF;
  rejected := false;
  BEGIN
    PERFORM public.publish_experience_revision(s.id, revision_id, 'fencing-plan', repeat('f', 64), 1, 1, 'v1', 'gemini-embedding-001', 'RETRIEVAL_DOCUMENT', 1536, token_a);
  EXCEPTION WHEN serialization_failure THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Replaced token published'; END IF;
  rejected := false;
  BEGIN
    PERFORM public.publish_experience_revision(s.id, revision_id, 'fencing-plan', repeat('f', 64), 1, 1, 'v1', 'gemini-embedding-001');
  EXCEPTION WHEN serialization_failure THEN rejected := true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'Tokenless publication succeeded'; END IF;
  result := public.publish_experience_revision(s.id, revision_id, 'fencing-plan', repeat('f', 64), 1, 1, 'v1', 'gemini-embedding-001', 'RETRIEVAL_DOCUMENT', 1536, token_b);
  IF result->>'status' IS DISTINCT FROM 'indexed'
     OR EXISTS(SELECT 1 FROM public.experience_sources WHERE id = s.id AND execution_token IS NOT NULL) THEN
    RAISE EXCEPTION 'Publication did not consume the lease atomically';
  END IF;
  SELECT execution_token INTO token_b FROM public.acquire_experience_source_execution(s.id, 'indexing', 300);
  result := public.publish_experience_revision(s.id, revision_id, 'fencing-plan', repeat('f', 64), 1, 1, 'v1', 'gemini-embedding-001', 'RETRIEVAL_DOCUMENT', 1536, token_b);
  IF result->>'already_published' IS DISTINCT FROM 'true'
     OR EXISTS(SELECT 1 FROM public.experience_sources WHERE id = s.id AND execution_token IS NOT NULL) THEN
    RAISE EXCEPTION 'Publication retry did not consume the lease';
  END IF;
END;
$$;

ROLLBACK;
