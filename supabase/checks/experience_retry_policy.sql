-- Remote-only: confirm MCP get_project_url is exactly
-- https://lwljmmfcvmbnrfstltzj.supabase.co immediately before execution.
-- SQL project_ref is unavailable on this deployment; the MCP binding is the
-- target authority. Never execute against a local database or via db push.
-- All fixture writes roll back, including failed assertions. Read outcome:
-- a successfully executed SQL request can still report status FAIL.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, extensions;
SET LOCAL ROLE service_role;

DO $check$
DECLARE
  s public.experience_sources%ROWTYPE;
  extraction_id uuid := gen_random_uuid();
  revisions uuid[] := ARRAY[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  hashes text[] := ARRAY[repeat('a', 64), repeat('b', 64), repeat('c', 64)];
  token uuid;
  used_token uuid;
  staged jsonb;
  result jsonb;
  results jsonb := '[]';
  before_source jsonb;
  before_evidence jsonb;
  after_evidence jsonb;
  original_parent uuid;
  original_child uuid;
  rejected boolean;
  retry_window integer;
  target integer;
  current_check text := 'fixture setup';
BEGIN
  -- This exception block is a subtransaction; any failure undoes every fixture.
  BEGIN
    SELECT * INTO s FROM public.reserve_experience_source(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'retry-policy-synthetic.docx', 'docx', 42
    );
    INSERT INTO public.experience_extractions
      (id, source_id, text_sha256, parser_version, normalization_version, blocks)
    VALUES (extraction_id, s.id, 'retry-policy-text', 'v1', 'v1',
      '[{"block_id":"b1","text":"Synthetic citation"}]');

    -- Revision 1 stays unpublished; revision 2 is R1; revision 3 is R2.
    FOR target IN 1..3 LOOP
      INSERT INTO public.experience_revisions(id, source_id, extraction_id, draft_json)
      VALUES (revisions[target], s.id, extraction_id, '{"draft":true}');
      UPDATE public.experience_sources
      SET latest_draft_revision_id = revisions[target] WHERE id = s.id;
      PERFORM public.approve_experience_revision(
        s.id, revisions[target], 1, jsonb_build_object('approved', target), hashes[target]
      );
      SELECT execution_token INTO token
      FROM public.acquire_experience_source_execution(s.id, 'indexing', 300);
      staged := jsonb_build_array(jsonb_build_object(
        'revision_id', revisions[target], 'logical_chunk_key', 'chunk-1',
        'plan_hash', 'retry-plan-' || target, 'approved_content_hash', hashes[target],
        'chunking_version', 'v1', 'embedding_model', 'gemini-embedding-001',
        'embedding_task_type', 'RETRIEVAL_DOCUMENT', 'embedding_dimensions', 1536,
        'parent_payload', jsonb_build_object(
          'source_document_id', s.id::text, 'source_file_name', 'retry-policy-synthetic.docx',
          'source_file_type', 'docx', 'parent_text', 'Synthetic citation',
          'metadata', jsonb_build_object('logical_experience_id', 'experience-1',
            'logical_parent_id', 'parent-1')
        ),
        'child_payload', '{"child_text":"Synthetic citation","embedding_text":"Synthetic citation","metadata":{"logical_chunk_id":"chunk-1"},"chunk_index":0}'::jsonb,
        'embedding', ('[1,' || repeat('0,', 1534) || '0]')::jsonb
      ));
      IF public.stage_experience_embeddings(s.id, revisions[target], token, staged) <> 1 THEN
        RAISE EXCEPTION 'Expected one staged child';
      END IF;
      IF target = 1 THEN
        PERFORM public.complete_experience_source_execution(s.id, token, 'indexing', 'approved');
        CONTINUE;
      END IF;

      -- After R2 approval and again after publication, both older revisions
      -- must be rejected even with the currently valid source indexing token.
      IF target = 3 THEN
        FOR retry_window IN 1..2 LOOP
          current_check := 'outdated rejection window ' || retry_window;
          SELECT to_jsonb(src) INTO before_source FROM public.experience_sources src WHERE id = s.id;
          SELECT jsonb_build_object(
            'parents', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.parent_documents p WHERE p.source_document_id = s.id::text),
            'chunks', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.document_chunks c JOIN public.parent_documents p ON p.id=c.parent_id WHERE p.source_document_id=s.id::text),
            'mappings', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.parent_id) FROM public.experience_revision_parents m WHERE m.revision_id=ANY(revisions)),
            'revisions', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.experience_revisions r WHERE r.source_id=s.id),
            'staging', (SELECT jsonb_agg(to_jsonb(st) ORDER BY st.revision_id, st.logical_chunk_key) FROM public.experience_index_staging st WHERE st.revision_id=ANY(revisions))
          ) INTO before_evidence;
          FOR older IN 1..2 LOOP
            rejected := false;
            BEGIN
              PERFORM public.publish_experience_revision(s.id, revisions[older],
                'retry-plan-' || older, hashes[older], 1, 1, 'v1',
                'gemini-embedding-001', 'RETRIEVAL_DOCUMENT', 1536, token);
            EXCEPTION WHEN serialization_failure THEN
              IF SQLERRM <> 'Experience publication candidate is stale' THEN
                RAISE EXCEPTION 'Wrong conflict reason: %', SQLERRM;
              END IF;
              rejected := true;
            END;
            IF NOT rejected THEN RAISE EXCEPTION 'Outdated revision % succeeded', older; END IF;
          END LOOP;
          IF (SELECT to_jsonb(src) FROM public.experience_sources src WHERE id=s.id)
             IS DISTINCT FROM before_source THEN RAISE EXCEPTION 'Rejected request changed source/lease'; END IF;
          SELECT jsonb_build_object(
            'parents', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.parent_documents p WHERE p.source_document_id = s.id::text),
            'chunks', (SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.document_chunks c JOIN public.parent_documents p ON p.id=c.parent_id WHERE p.source_document_id=s.id::text),
            'mappings', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.parent_id) FROM public.experience_revision_parents m WHERE m.revision_id=ANY(revisions)),
            'revisions', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.experience_revisions r WHERE r.source_id=s.id),
            'staging', (SELECT jsonb_agg(to_jsonb(st) ORDER BY st.revision_id, st.logical_chunk_key) FROM public.experience_index_staging st WHERE st.revision_id=ANY(revisions))
          ) INTO after_evidence;
          IF after_evidence IS DISTINCT FROM before_evidence THEN
            RAISE EXCEPTION 'Rejected request changed evidence/history/staging';
          END IF;
          IF (SELECT count(*) FROM public.match_approved_experience_chunks(
            ('[1,' || repeat('0,', 1534) || '0]')::vector, -1, 10, ARRAY[s.id])
            WHERE revision_id=revisions[retry_window + 1]) <> 1 THEN
            RAISE EXCEPTION 'Wrong active search eligibility in window %', retry_window;
          END IF;
          results := results || jsonb_build_array('PASS: published and unpublished outdated rejection window ' || retry_window);
          IF retry_window = 1 THEN
            result := public.publish_experience_revision(s.id, revisions[3], 'retry-plan-3', hashes[3],
              1, 1, 'v1', 'gemini-embedding-001', 'RETRIEVAL_DOCUMENT', 1536, token);
            IF result->>'already_published' IS DISTINCT FROM 'false'
               OR result->>'previous_active_revision_id' IS DISTINCT FROM revisions[2]::text
               OR result->>'active_revision_id' IS DISTINCT FROM revisions[3]::text
               OR EXISTS (SELECT 1 FROM public.parent_documents WHERE id=original_parent)
               OR EXISTS (SELECT 1 FROM public.document_chunks WHERE id=original_child)
               OR EXISTS (SELECT 1 FROM public.experience_revision_parents WHERE revision_id=revisions[2])
               OR (SELECT count(*) FROM public.experience_revisions WHERE id=ANY(revisions) AND approved_json IS NOT NULL) <> 3
               OR NOT EXISTS (SELECT 1 FROM public.experience_extractions WHERE id=extraction_id) THEN
              RAISE EXCEPTION 'Replacement/history retention failed';
            END IF;
            SELECT execution_token INTO token FROM public.acquire_experience_source_execution(s.id, 'indexing', 300);
          END IF;
        END LOOP;
        EXIT;
      END IF;

      current_check := 'first publication';
      result := public.publish_experience_revision(s.id, revisions[2], 'retry-plan-2', hashes[2],
        1, 1, 'v1', 'gemini-embedding-001', 'RETRIEVAL_DOCUMENT', 1536, token);
      IF result->>'status' IS DISTINCT FROM 'indexed'
         OR result->>'already_published' IS DISTINCT FROM 'false'
         OR result->>'revision_id' IS DISTINCT FROM revisions[2]::text
         OR result->>'active_revision_id' IS DISTINCT FROM revisions[2]::text
         OR result->>'parent_count' IS DISTINCT FROM '1'
         OR result->>'child_count' IS DISTINCT FROM '1'
         OR result->>'plan_hash' IS DISTINCT FROM 'retry-plan-2'
         OR EXISTS (SELECT 1 FROM public.experience_sources WHERE id=s.id AND
           (execution_token IS NOT NULL OR execution_stage IS NOT NULL OR execution_started_at IS NOT NULL OR execution_token_expires_at IS NOT NULL))
         OR EXISTS (SELECT 1 FROM public.experience_index_staging WHERE revision_id=revisions[2]) THEN
        RAISE EXCEPTION 'First publication response/lease/staging mismatch';
      END IF;
      SELECT parent_id INTO original_parent FROM public.experience_revision_parents WHERE revision_id=revisions[2];
      SELECT id INTO original_child FROM public.document_chunks WHERE parent_id=original_parent;
      results := results || '["PASS: first publication"]'::jsonb;

      current_check := 'current-version retry';
      SELECT execution_token INTO token FROM public.acquire_experience_source_execution(s.id, 'indexing', 300);
      used_token := token;
      result := public.publish_experience_revision(s.id, revisions[2], 'retry-plan-2', hashes[2],
        1, 1, 'v1', 'gemini-embedding-001', 'RETRIEVAL_DOCUMENT', 1536, token);
      IF result IS DISTINCT FROM jsonb_build_object('status','indexed','already_published',true,
        'revision_id',revisions[2],'active_revision_id',revisions[2],'parent_count',1,'child_count',1,'plan_hash','retry-plan-2')
        OR (SELECT count(*) FROM public.parent_documents WHERE source_document_id=s.id::text) <> 1
        OR (SELECT count(*) FROM public.document_chunks WHERE parent_id=original_parent) <> 1
        OR NOT EXISTS (SELECT 1 FROM public.document_chunks WHERE id=original_child AND parent_id=original_parent)
        OR EXISTS (SELECT 1 FROM public.experience_sources WHERE id=s.id AND
          (execution_token IS NOT NULL OR execution_stage IS NOT NULL OR execution_started_at IS NOT NULL OR execution_token_expires_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'Current retry response/identity/lease mismatch';
      END IF;
      SELECT to_jsonb(src) INTO before_source FROM public.experience_sources src WHERE id=s.id;
      rejected := false;
      BEGIN
        PERFORM public.publish_experience_revision(s.id, revisions[2], 'retry-plan-2', hashes[2],
          1, 1, 'v1', 'gemini-embedding-001', 'RETRIEVAL_DOCUMENT', 1536, used_token);
      EXCEPTION WHEN serialization_failure THEN rejected := true;
      END;
      IF NOT rejected OR (SELECT to_jsonb(src) FROM public.experience_sources src WHERE id=s.id)
         IS DISTINCT FROM before_source THEN RAISE EXCEPTION 'Consumed token accepted or changed source'; END IF;
      results := results || '["PASS: current-version retry and consumed-token rejection"]'::jsonb;
    END LOOP;
    PERFORM set_config('app.retry_policy_result', jsonb_build_object('status','PASS','checks',results)::text, true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.retry_policy_result', jsonb_build_object('status','FAIL',
      'check',current_check,'sqlstate',SQLSTATE,'message',SQLERRM,'completed',results)::text, true);
  END;
END;
$check$;
SELECT current_setting('app.retry_policy_result')::jsonb AS outcome;
ROLLBACK;
