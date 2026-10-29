-- Run after the experience registry migration as a database administrator.
-- All seeded data is rolled back, including on assertion failure.
BEGIN;
SET LOCAL search_path = public, extensions;

DO $$
DECLARE
  source_a uuid := gen_random_uuid();
  source_b uuid := gen_random_uuid();
  extraction_a uuid := gen_random_uuid();
  extraction_b uuid := gen_random_uuid();
  revision_a uuid := gen_random_uuid();
  revision_b uuid := gen_random_uuid();
  unpublished_revision uuid := gen_random_uuid();
  publish_source uuid := gen_random_uuid();
  publish_extraction uuid := gen_random_uuid();
  previous_publish_revision uuid := gen_random_uuid();
  previous_publish_parent uuid := gen_random_uuid();
  previous_publish_child uuid := gen_random_uuid();
  publish_revision uuid := gen_random_uuid();
  parent_a uuid := gen_random_uuid();
  reservation_hash text := repeat('a', 64);
  reserved_source public.experience_sources%ROWTYPE;
  retried_source public.experience_sources%ROWTYPE;
  reconciled_source public.experience_sources%ROWTYPE;
  execution_a record;
  execution_b record;
  execution_extraction uuid := gen_random_uuid();
  execution_revision uuid := gen_random_uuid();
  updated_revision public.experience_revisions%ROWTYPE;
  query_vector vector(1536) := ('[1,' || repeat('0,', 1534) || '0]')::vector;
  publish_result jsonb;
  approved_search_result record;
  approved_search_count integer;
  rejected boolean;
BEGIN
  IF to_regclass('public.experience_sources') IS NULL
     OR to_regclass('public.experience_extractions') IS NULL
     OR to_regclass('public.experience_revisions') IS NULL
     OR to_regclass('public.experience_revision_parents') IS NULL
     OR to_regclass('public.experience_index_staging') IS NULL THEN
    RAISE EXCEPTION 'Experience registry tables are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid IN (
      'public.experience_sources'::regclass,
      'public.experience_extractions'::regclass,
      'public.experience_revisions'::regclass,
      'public.experience_revision_parents'::regclass,
      'public.experience_index_staging'::regclass
    )
      AND NOT relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Experience registry RLS is not enabled';
  END IF;

  IF has_table_privilege('anon', 'public.experience_sources', 'SELECT')
     OR has_table_privilege('authenticated', 'public.experience_revisions', 'SELECT')
     OR has_table_privilege('anon', 'public.experience_index_staging', 'INSERT') THEN
    RAISE EXCEPTION 'Experience registry is not server-only';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.conrelid IN (
        'public.experience_sources'::regclass,
        'public.experience_extractions'::regclass,
        'public.experience_revisions'::regclass,
        'public.experience_revision_parents'::regclass,
        'public.experience_index_staging'::regclass
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index i
        WHERE i.indrelid = c.conrelid
          AND i.indisvalid
          AND i.indkey[0] = a.attnum
      )
  ) THEN
    RAISE EXCEPTION 'Experience registry foreign key columns are missing leading indexes';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.experience_sources', 'INSERT')
     OR NOT has_table_privilege('service_role', 'public.experience_revisions', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.experience_index_staging', 'DELETE') THEN
    RAISE EXCEPTION 'Service role is missing experience registry privileges';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'experience-sources'
      AND name = 'experience-sources'
      AND "public" = false
  ) THEN
    RAISE EXCEPTION 'Private experience-sources storage bucket is missing';
  END IF;

  IF has_function_privilege('anon', 'public.reserve_experience_source(text,text,text,bigint,text,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reconcile_experience_source_storage(uuid,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.acquire_experience_source_execution(uuid,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.update_experience_revision_draft(uuid,integer,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.publish_experience_revision(uuid,uuid,text,text,integer,integer,text,text,text,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.match_approved_experience_chunks(vector,double precision,integer,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'Experience source registry RPCs are exposed to browser roles';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.reserve_experience_source(text,text,text,bigint,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.reconcile_experience_source_storage(uuid,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.acquire_experience_source_execution(uuid,text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.complete_experience_source_execution(uuid,uuid,text,text,uuid,uuid,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.update_experience_revision_draft(uuid,integer,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.publish_experience_revision(uuid,uuid,text,text,integer,integer,text,text,text,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.match_approved_experience_chunks(vector,double precision,integer,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'Service role is missing experience source registry RPC privileges';
  END IF;

  SELECT * INTO reserved_source
  FROM public.reserve_experience_source(
    reservation_hash,
    'reserved.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    42,
    'experience-sources',
    'sources/sha256/aa/' || reservation_hash || '/original.docx'
  );

  SELECT * INTO retried_source
  FROM public.reserve_experience_source(
    reservation_hash,
    'renamed.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    42,
    'experience-sources',
    'sources/sha256/aa/' || reservation_hash || '/renamed.docx'
  );

  IF retried_source.id <> reserved_source.id
     OR retried_source.storage_path <> reserved_source.storage_path
     OR retried_source.storage_uploaded_at IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate source reservation did not resolve to the original unconfirmed source';
  END IF;

  SELECT * INTO reconciled_source
  FROM public.reconcile_experience_source_storage(
    reserved_source.id,
    reservation_hash,
    reserved_source.storage_bucket,
    reserved_source.storage_path
  );

  IF reconciled_source.id <> reserved_source.id
     OR reconciled_source.storage_uploaded_at IS NULL THEN
    RAISE EXCEPTION 'Experience source storage reconciliation did not confirm the original source';
  END IF;

  SELECT * INTO retried_source
  FROM public.reserve_experience_source(
    reservation_hash,
    'response-loss-retry.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    42,
    'experience-sources',
    'sources/sha256/aa/' || reservation_hash || '/response-loss-retry.docx'
  );

  IF retried_source.id <> reserved_source.id
     OR retried_source.storage_uploaded_at IS NULL THEN
    RAISE EXCEPTION 'Response-loss retry did not return the reconciled source';
  END IF;

  SELECT * INTO execution_a
  FROM public.acquire_experience_source_execution(reserved_source.id, 'extracting', 300);

  rejected := false;
  BEGIN
    PERFORM public.acquire_experience_source_execution(reserved_source.id, 'parsing', 300);
  EXCEPTION WHEN lock_not_available THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Competing source execution request acquired an active lease';
  END IF;

  UPDATE public.experience_sources
  SET execution_token_expires_at = now() - interval '1 second'
  WHERE id = reserved_source.id;

  SELECT * INTO execution_b
  FROM public.acquire_experience_source_execution(reserved_source.id, 'extracting', 300);

  IF execution_b.execution_token = execution_a.execution_token THEN
    RAISE EXCEPTION 'Expired source execution did not receive a new token';
  END IF;

  INSERT INTO public.experience_extractions (
    id, source_id, text_sha256, parser_version, normalization_version, blocks
  ) VALUES (
    execution_extraction, reserved_source.id, 'execution-text-hash', 'parser-v1', 'normalize-v1',
    '[{"block_id":"b1","order":0,"text":"hello","text_start":0,"text_end":5}]'::jsonb
  );

  SELECT * INTO reconciled_source
  FROM public.complete_experience_source_execution(
    reserved_source.id,
    execution_b.execution_token,
    'extracting',
    'extracted',
    execution_extraction,
    NULL,
    NULL
  );

  IF reconciled_source.status <> 'extracted'
     OR reconciled_source.latest_extraction_id <> execution_extraction
     OR reconciled_source.execution_token IS NOT NULL THEN
    RAISE EXCEPTION 'Execution completion did not atomically clear the lease and persist progress';
  END IF;

  rejected := false;
  BEGIN
    PERFORM public.complete_experience_source_execution(
      reserved_source.id,
      execution_a.execution_token,
      'extracting',
      'failed',
      NULL,
      NULL,
      '{"code":"stale-token"}'::jsonb
    );
  EXCEPTION WHEN serialization_failure THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Expired stale execution token overwrote newer completed work';
  END IF;

  INSERT INTO public.experience_revisions (
    id, source_id, extraction_id, status, draft_json, draft_version
  ) VALUES (
    execution_revision, reserved_source.id, execution_extraction, 'draft',
    '{"schema_version":"1","experiences":[{"draft":1}]}'::jsonb, 1
  );

  SELECT * INTO updated_revision
  FROM public.update_experience_revision_draft(
    execution_revision,
    1,
    '{"schema_version":"1","experiences":[{"draft":2}]}'::jsonb
  );

  IF updated_revision.draft_version <> 2 THEN
    RAISE EXCEPTION 'Draft update did not increment the optimistic version';
  END IF;

  rejected := false;
  BEGIN
    PERFORM public.update_experience_revision_draft(
      execution_revision,
      1,
      '{"schema_version":"1","experiences":[{"stale":true}]}'::jsonb
    );
  EXCEPTION WHEN serialization_failure THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Stale optimistic draft save was accepted';
  END IF;

  INSERT INTO public.experience_sources (
    id, original_byte_sha256, original_file_name, original_file_type,
    original_file_size, storage_path
  ) VALUES (
    source_a, 'registry-byte-hash', 'experience.docx', 'docx', 128,
    'sources/registry-byte-hash/experience.docx'
  );

  BEGIN
    INSERT INTO public.experience_sources (
      original_byte_sha256, original_file_name, original_file_type,
      original_file_size, storage_path
    ) VALUES (
      'registry-byte-hash', 'duplicate.docx', 'docx', 128,
      'sources/registry-byte-hash/duplicate.docx'
    );
    RAISE EXCEPTION 'Duplicate live source hash was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.experience_extractions (
      source_id, text_sha256, parser_version, normalization_version, blocks
    ) VALUES (
      gen_random_uuid(), 'missing-source-text', 'parser-v1', 'normalize-v1',
      '[{"block_id":"b1","text":"hello"}]'::jsonb
    );
    RAISE EXCEPTION 'Extraction without a valid source was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  INSERT INTO public.experience_extractions (
    id, source_id, text_sha256, parser_version, normalization_version, blocks
  ) VALUES (
    extraction_a, source_a, 'registry-text-hash', 'parser-v1', 'normalize-v1',
    '[{"block_id":"b1","order":0,"text":"hello","text_start":0,"text_end":5}]'::jsonb
  );

  INSERT INTO public.experience_revisions (
    id, source_id, extraction_id, status, draft_json, draft_version,
    approved_json, approved_content_hash, approved_at, model_version, prompt_version
  ) VALUES (
    revision_a, source_a, extraction_a, 'approved',
    '{"schema_version":"1","experiences":[]}'::jsonb, 1,
    '{"schema_version":"1","experiences":[]}'::jsonb, 'approved-hash', now(),
    'gemini-test', 'prompt-v1'
  );

  UPDATE public.experience_sources
  SET latest_extraction_id = extraction_a,
      latest_approved_revision_id = revision_a,
      status = 'approved'
  WHERE id = source_a;

  INSERT INTO public.parent_documents (
    id, source_document_id, source_file_name, source_file_type, parent_text
  ) VALUES (
    parent_a, source_a::text, 'experience.docx', 'docx', 'Project parent'
  );

  INSERT INTO public.experience_revision_parents (
    revision_id, parent_id, logical_experience_id, logical_parent_id, plan_hash
  ) VALUES (
    revision_a, parent_a, 'revision-experience-0001', 'revision-parent-0001', 'plan-hash'
  );

  UPDATE public.experience_revisions
  SET status = 'indexed'
  WHERE id = revision_a;

  UPDATE public.experience_sources
  SET active_revision_id = revision_a,
      status = 'indexed'
  WHERE id = source_a;

  INSERT INTO public.experience_index_staging (
    revision_id, logical_chunk_key, plan_hash, approved_content_hash,
    chunking_version, embedding_model, parent_payload, child_payload, embedding,
    prepared_at
  ) VALUES (
    revision_a, 'revision-parent-0001:chunk-0001', 'plan-hash', 'approved-hash',
    'chunking-v1', 'gemini-embedding-001',
    '{"parent_text":"Project parent"}'::jsonb,
    '{"child_text":"Exact citation"}'::jsonb,
    query_vector, now()
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.experience_revision_parents rp
    JOIN public.experience_revisions r ON r.id = rp.revision_id
    JOIN public.experience_sources s ON s.active_revision_id = r.id
    WHERE rp.parent_id = parent_a AND s.id = source_a
  ) THEN
    RAISE EXCEPTION 'Experience revision publication mapping is not joinable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname IN ('insert_project_evidence', 'match_document_chunks')
      AND pronargs NOT IN (2, 3)
  ) THEN
    RAISE EXCEPTION 'Foundation evidence RPC signatures changed unexpectedly';
  END IF;

  INSERT INTO public.experience_sources (
    id, original_byte_sha256, original_file_name, original_file_type,
    original_file_size, storage_path, status
  ) VALUES (
    publish_source, 'publish-byte-hash', 'publish.docx', 'docx', 128,
    'sources/publish-byte-hash/publish.docx', 'approved'
  );

  INSERT INTO public.experience_extractions (
    id, source_id, text_sha256, parser_version, normalization_version, blocks
  ) VALUES (
    publish_extraction, publish_source, 'publish-text-hash', 'parser-v1', 'normalize-v1',
    '[{"block_id":"b1","order":0,"text":"Exact citation","text_start":0,"text_end":14}]'::jsonb
  );

  INSERT INTO public.experience_revisions (
    id, source_id, extraction_id, status, draft_json, draft_version,
    approved_json, approved_content_hash, approved_at, model_version, prompt_version
  ) VALUES (
    publish_revision, publish_source, publish_extraction, 'approved',
    '{"schema_version":"1","experiences":[{"approved":true}]}'::jsonb, 1,
    '{"schema_version":"1","experiences":[{"approved":true}]}'::jsonb, 'publish-hash', now(),
    'gemini-test', 'prompt-v1'
  );

  INSERT INTO public.experience_revisions (
    id, source_id, extraction_id, status, draft_json, draft_version,
    approved_json, approved_content_hash, approved_at, model_version, prompt_version
  ) VALUES (
    previous_publish_revision, publish_source, publish_extraction, 'indexed',
    '{"schema_version":"1","experiences":[{"previous":true}]}'::jsonb, 1,
    '{"schema_version":"1","experiences":[{"previous":true}]}'::jsonb, 'previous-publish-hash', now(),
    'gemini-test', 'prompt-v1'
  );

  INSERT INTO public.parent_documents (
    id, source_document_id, source_file_name, source_file_type, parent_text, metadata
  ) VALUES (
    previous_publish_parent, publish_source::text, 'publish.docx', 'docx', 'Previous active parent',
    '{"logical_parent_id":"previous-publish-parent"}'::jsonb
  );

  INSERT INTO public.document_chunks (
    id, parent_id, child_text, embedding_text, embedding, metadata, chunk_index
  ) VALUES (
    previous_publish_child, previous_publish_parent, 'Previous active citation',
    'Previous active citation', query_vector, '{}'::jsonb, 0
  );

  INSERT INTO public.experience_revision_parents (
    revision_id, parent_id, logical_experience_id, logical_parent_id, plan_hash
  ) VALUES (
    previous_publish_revision, previous_publish_parent,
    'previous-publish-experience', 'previous-publish-parent', 'previous-publish-plan'
  );

  UPDATE public.experience_sources
  SET latest_extraction_id = publish_extraction,
      latest_approved_revision_id = publish_revision,
      active_revision_id = previous_publish_revision,
      status = 'indexed'
  WHERE id = publish_source;

  INSERT INTO public.experience_index_staging (
    revision_id, logical_chunk_key, plan_hash, approved_content_hash,
    chunking_version, embedding_model, parent_payload, child_payload, embedding,
    prepared_at
  ) VALUES (
    publish_revision, 'publish-parent-0001:chunk-0001', 'publish-plan', 'publish-hash',
    'publish-chunking-v1', 'gemini-embedding-001',
    jsonb_build_object(
      'source_document_id', publish_source::text,
      'source_file_name', 'publish.docx',
      'source_file_type', 'docx',
      'parent_text', 'Project parent',
      'metadata', jsonb_build_object(
        'logical_experience_id', 'publish-experience-0001',
        'logical_parent_id', 'publish-parent-0001'
      )
    ),
    jsonb_build_object(
      'child_text', '',
      'embedding_text', 'Project parent Exact citation',
      'metadata', jsonb_build_object(
        'logical_chunk_id', 'publish-parent-0001:chunk-0001'
      ),
      'chunk_index', 0
    ),
    query_vector, now()
  );

  rejected := false;
  BEGIN
    PERFORM public.publish_experience_revision(
      publish_source,
      publish_revision,
      'publish-plan',
      'publish-hash',
      1,
      1,
      'publish-chunking-v1',
      'gemini-embedding-001',
      'RETRIEVAL_DOCUMENT',
      1536
    );
  EXCEPTION WHEN check_violation OR not_null_violation OR raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Invalid child publication was accepted';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.parent_documents
    WHERE source_document_id = publish_source::text
      AND parent_text = 'Project parent'
  ) OR EXISTS (
    SELECT 1 FROM public.experience_revision_parents WHERE revision_id = publish_revision
  ) THEN
    RAISE EXCEPTION 'Failed publication left partial parent or mapping rows';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.parent_documents p
    JOIN public.document_chunks c ON c.parent_id = p.id
    WHERE p.id = previous_publish_parent
      AND c.id = previous_publish_child
  ) THEN
    RAISE EXCEPTION 'Failed publication removed the previous active evidence';
  END IF;

  UPDATE public.experience_index_staging
  SET child_payload = jsonb_build_object(
        'child_text', 'Exact citation',
        'embedding_text', 'Project parent Exact citation',
        'metadata', jsonb_build_object(
          'logical_chunk_id', 'publish-parent-0001:chunk-0001'
        ),
        'chunk_index', 0
      )
  WHERE revision_id = publish_revision;

  SELECT public.publish_experience_revision(
    publish_source,
    publish_revision,
    'publish-plan',
    'publish-hash',
    1,
    1,
    'publish-chunking-v1',
    'gemini-embedding-001',
    'RETRIEVAL_DOCUMENT',
    1536
  ) INTO publish_result;

  IF publish_result->>'status' <> 'indexed'
     OR (publish_result->>'parent_count')::integer <> 1
     OR (publish_result->>'child_count')::integer <> 1 THEN
    RAISE EXCEPTION 'Publication RPC returned unexpected counts';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.experience_sources s
    JOIN public.experience_revisions r ON r.id = s.active_revision_id
    JOIN public.experience_revision_parents rp ON rp.revision_id = r.id
    JOIN public.document_chunks c ON c.parent_id = rp.parent_id
    WHERE s.id = publish_source
      AND r.id = publish_revision
      AND c.child_text = 'Exact citation'
  ) THEN
    RAISE EXCEPTION 'Publication RPC did not create active mapped evidence';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.parent_documents
    WHERE id = previous_publish_parent
  ) OR EXISTS (
    SELECT 1
    FROM public.document_chunks
    WHERE id = previous_publish_child
  ) THEN
    RAISE EXCEPTION 'Publication RPC did not remove previous active evidence';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.experience_index_staging WHERE revision_id = publish_revision
  ) THEN
    RAISE EXCEPTION 'Publication RPC did not clear compatible staging rows';
  END IF;

  SELECT * INTO approved_search_result
  FROM public.match_approved_experience_chunks(query_vector, 0.99, 10, NULL)
  WHERE source_id = publish_source;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved experience search did not return active publication lineage';
  END IF;

  IF approved_search_result.revision_id IS DISTINCT FROM publish_revision
     OR approved_search_result.child_text IS DISTINCT FROM 'Exact citation'
     OR approved_search_result.logical_experience_id IS DISTINCT FROM 'publish-experience-0001'
     OR approved_search_result.logical_parent_id IS DISTINCT FROM 'publish-parent-0001'
     OR approved_search_result.logical_chunk_id IS DISTINCT FROM 'publish-parent-0001:chunk-0001'
     OR approved_search_result.parent_text IS DISTINCT FROM 'Project parent' THEN
    RAISE EXCEPTION 'Approved experience search did not return active publication lineage';
  END IF;

  SELECT count(*) INTO approved_search_count
  FROM public.match_approved_experience_chunks(query_vector, 0.99, 10, ARRAY[publish_source]::uuid[]);
  IF approved_search_count <> 1 THEN
    RAISE EXCEPTION 'Approved experience search selected-source filter failed';
  END IF;

  SELECT count(*) INTO approved_search_count
  FROM public.match_approved_experience_chunks(query_vector, 0.99, 10, ARRAY[]::uuid[]);
  IF approved_search_count <> 0 THEN
    RAISE EXCEPTION 'Approved experience search empty selection should return no rows';
  END IF;

  rejected := false;
  BEGIN
    PERFORM public.match_approved_experience_chunks(query_vector, 0.99, 10, ARRAY[gen_random_uuid()]::uuid[]);
  EXCEPTION WHEN serialization_failure THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Approved experience search accepted an ineligible selected source';
  END IF;

  INSERT INTO public.experience_sources (
    id, original_byte_sha256, original_file_name, original_file_type,
    original_file_size, storage_path
  ) VALUES (
    source_b, 'registry-byte-hash-b', 'experience-b.docx', 'docx', 128,
    'sources/registry-byte-hash-b/experience-b.docx'
  );

  INSERT INTO public.experience_extractions (
    id, source_id, text_sha256, parser_version, normalization_version, blocks
  ) VALUES (
    extraction_b, source_b, 'registry-text-hash-b', 'parser-v1', 'normalize-v1',
    '[{"block_id":"b1","order":0,"text":"hello","text_start":0,"text_end":5}]'::jsonb
  );

  INSERT INTO public.experience_revisions (
    id, source_id, extraction_id, status, draft_json, draft_version,
    approved_json, approved_content_hash, approved_at
  ) VALUES (
    revision_b, source_b, extraction_b, 'approved',
    '{"schema_version":"1","experiences":[]}'::jsonb, 1,
    '{"schema_version":"1","experiences":[]}'::jsonb, 'approved-hash-b', now()
  );

  rejected := false;
  BEGIN
    UPDATE public.experience_sources
    SET latest_approved_revision_id = revision_b
    WHERE id = source_a;
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Cross-source approved pointer was accepted';
  END IF;

  INSERT INTO public.experience_revisions (
    id, source_id, extraction_id, status, draft_json, draft_version,
    approved_json, approved_content_hash, approved_at
  ) VALUES (
    unpublished_revision, source_a, extraction_a, 'indexed',
    '{"schema_version":"1","experiences":[]}'::jsonb, 1,
    '{"schema_version":"1","experiences":[]}'::jsonb, 'unpublished-approved-hash', now()
  );

  rejected := false;
  BEGIN
    UPDATE public.experience_sources
    SET active_revision_id = unpublished_revision
    WHERE id = source_a;
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Unpublished active pointer was accepted';
  END IF;

  rejected := false;
  BEGIN
    UPDATE public.experience_extractions
    SET blocks = '[{"block_id":"changed","order":0,"text":"changed","text_start":0,"text_end":7}]'::jsonb
    WHERE id = extraction_a;
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Immutable extraction was mutated';
  END IF;

  rejected := false;
  BEGIN
    UPDATE public.experience_revisions
    SET approved_json = '{"schema_version":"1","experiences":[{"changed":true}]}'::jsonb
    WHERE id = revision_a;
  EXCEPTION WHEN raise_exception THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'Approved revision content was mutated';
  END IF;
END;
$$;

ROLLBACK;
