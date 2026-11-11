-- Remote-only: confirm MCP get_project_url equals
-- https://lwljmmfcvmbnrfstltzj.supabase.co before execution. Never run locally.
-- Uses only synthetic SQL data; no Storage API calls, migration replay, or DDL.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, extensions;
SET LOCAL ROLE service_role;
DO $check$
DECLARE
  s public.experience_sources%ROWTYPE;
  extraction_id uuid := gen_random_uuid();
  revisions uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  token uuid;
  staged jsonb;
  parent_payload jsonb;
  child_payload jsonb;
  result jsonb;
  standalone_parent uuid;
  old_parents uuid[];
  before_state jsonb;
  after_state jsonb;
  rejected boolean;
  results jsonb := '[]';
  current_check text := 'server-only access';
BEGIN
  BEGIN
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN (VALUES ('anon'),('authenticated')) AS actors(role_name)
      WHERE n.nspname='public'
        AND c.relname IN ('parent_documents','document_chunks','experience_sources','experience_extractions',
          'experience_revisions','experience_revision_parents','experience_index_staging')
        AND (NOT c.relrowsecurity
          OR has_table_privilege(actors.role_name,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(actors.role_name,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
    ) THEN RAISE EXCEPTION 'Server-only table access violated'; END IF;
    IF EXISTS (
      SELECT 1 FROM pg_proc p CROSS JOIN (VALUES ('anon'),('authenticated')) AS actors(role_name)
      WHERE p.pronamespace='public'::regnamespace
        AND p.proname IN ('publish_experience_revision','acquire_experience_source_execution',
          'complete_experience_source_execution','delete_experience_source','match_approved_experience_chunks')
        AND (p.prosecdef OR has_function_privilege(actors.role_name,p.oid,'EXECUTE'))
    ) THEN RAISE EXCEPTION 'Server-only lifecycle access violated'; END IF;
    current_check := 'fixture setup';
    SELECT * INTO s FROM public.reserve_experience_source(
      replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),'lifecycle.docx','docx',42);
    INSERT INTO public.experience_extractions(id,source_id,text_sha256,parser_version,normalization_version,blocks)
    VALUES(extraction_id,s.id,'lifecycle-text','v1','v1','[{"block_id":"b1","text":"Synthetic citation"}]');
    child_payload := jsonb_build_object('child_text','Synthetic citation','embedding_text','Synthetic citation',
      'chunk_index',0,'metadata',jsonb_build_object('logical_chunk_id','chunk-1'),
      'embedding',('[1,'||repeat('0,',1534)||'0]')::jsonb);
    result := public.insert_project_evidence(jsonb_build_object(
      'source_document_id','standalone-'||gen_random_uuid()::text,'source_file_name','standalone.docx',
      'source_file_type','docx','parent_text','Standalone synthetic citation'),jsonb_build_array(child_payload));
    standalone_parent := (result->'parent'->>'id')::uuid;

    FOR candidate IN 1..2 LOOP
      INSERT INTO public.experience_revisions(id,source_id,extraction_id,draft_json)
      VALUES(revisions[candidate],s.id,extraction_id,'{"draft":true}');
      UPDATE public.experience_sources SET latest_draft_revision_id=revisions[candidate] WHERE id=s.id;
      PERFORM public.approve_experience_revision(s.id,revisions[candidate],1,
        jsonb_build_object('approved',candidate),repeat(candidate::text,64));
      IF candidate=2 AND (SELECT count(*) FROM public.match_approved_experience_chunks(
        ('[1,'||repeat('0,',1534)||'0]')::vector,-1,10,ARRAY[s.id]) WHERE revision_id=revisions[1]) <> 2 THEN
        RAISE EXCEPTION 'Approval hid previous active evidence';
      END IF;
      SELECT execution_token INTO token FROM public.acquire_experience_source_execution(s.id,'indexing',300);
      staged := '[]';
      FOR part IN 1..2 LOOP
        parent_payload := jsonb_build_object('source_document_id',s.id::text,'source_file_name','lifecycle.docx',
          'source_file_type','docx','parent_text','Synthetic citation',
          'metadata',jsonb_build_object('logical_experience_id','experience-'||part,'logical_parent_id','parent-'||part));
        staged := staged || jsonb_build_array(jsonb_build_object(
          'revision_id',revisions[candidate],'logical_chunk_key','chunk-'||part,
          'plan_hash','lifecycle-'||candidate,'approved_content_hash',repeat(candidate::text,64),
          'chunking_version','v1','embedding_model','gemini-embedding-001',
          'embedding_task_type','RETRIEVAL_DOCUMENT','embedding_dimensions',1536,
          'parent_payload',parent_payload,'child_payload',child_payload - 'embedding',
          'embedding',child_payload->'embedding'));
      END LOOP;
      IF public.stage_experience_embeddings(s.id,revisions[candidate],token,staged) <> 2 THEN
        RAISE EXCEPTION 'Expected two staged children';
      END IF;
      IF candidate=2 THEN
        current_check := 'multi-parent failure preserves R1';
        IF (SELECT count(*) FROM public.match_approved_experience_chunks(
          ('[1,'||repeat('0,',1534)||'0]')::vector,-1,10,ARRAY[s.id]) WHERE revision_id=revisions[1]) <> 2 THEN
          RAISE EXCEPTION 'Preparation hid previous active evidence';
        END IF;
        -- First parent inserts before the second child's nonempty constraint fails.
        UPDATE public.experience_index_staging st SET child_payload=jsonb_set(st.child_payload,'{child_text}','""')
        WHERE revision_id=revisions[2] AND logical_chunk_key='chunk-2';
        SELECT jsonb_build_object(
          'source',(SELECT to_jsonb(t) FROM public.experience_sources t WHERE id=s.id),
          'revisions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.experience_revisions t WHERE source_id=s.id),
          'parents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.parent_documents t WHERE source_document_id=s.id::text),
          'chunks',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.document_chunks c JOIN public.parent_documents p ON p.id=c.parent_id WHERE p.source_document_id=s.id::text),
          'mappings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY parent_id) FROM public.experience_revision_parents t WHERE revision_id=ANY(revisions)),
          'staging',(SELECT jsonb_agg(to_jsonb(t) ORDER BY logical_chunk_key) FROM public.experience_index_staging t WHERE revision_id=revisions[2])
        ) INTO before_state;
        rejected := false;
        BEGIN
          PERFORM public.publish_experience_revision(s.id,revisions[2],'lifecycle-2',repeat('2',64),
            2,2,'v1','gemini-embedding-001','RETRIEVAL_DOCUMENT',1536,token);
        EXCEPTION WHEN check_violation THEN rejected := true;
        END;
        IF NOT rejected THEN RAISE EXCEPTION 'Invalid child did not abort publication'; END IF;
        SELECT jsonb_build_object(
          'source',(SELECT to_jsonb(t) FROM public.experience_sources t WHERE id=s.id),
          'revisions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.experience_revisions t WHERE source_id=s.id),
          'parents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.parent_documents t WHERE source_document_id=s.id::text),
          'chunks',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.document_chunks c JOIN public.parent_documents p ON p.id=c.parent_id WHERE p.source_document_id=s.id::text),
          'mappings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY parent_id) FROM public.experience_revision_parents t WHERE revision_id=ANY(revisions)),
          'staging',(SELECT jsonb_agg(to_jsonb(t) ORDER BY logical_chunk_key) FROM public.experience_index_staging t WHERE revision_id=revisions[2])
        ) INTO after_state;
        IF before_state IS DISTINCT FROM after_state OR
          (SELECT count(*) FROM public.match_approved_experience_chunks(
            ('[1,'||repeat('0,',1534)||'0]')::vector,-1,10,ARRAY[s.id]) WHERE revision_id=revisions[1]) <> 2 THEN
          RAISE EXCEPTION 'Failed publication changed state/search eligibility';
        END IF;
        UPDATE public.experience_index_staging st
        SET child_payload=jsonb_set(st.child_payload,'{child_text}','"Synthetic citation"')
        WHERE revision_id=revisions[2] AND logical_chunk_key='chunk-2';
        results := results || '["PASS: approval/preparation/failure retain R1 and exact pre-publication state"]';
      END IF;
      current_check := 'successful publication '||candidate;
      result := public.publish_experience_revision(s.id,revisions[candidate],'lifecycle-'||candidate,repeat(candidate::text,64),
        2,2,'v1','gemini-embedding-001','RETRIEVAL_DOCUMENT',1536,token);
      IF result->>'active_revision_id' IS DISTINCT FROM revisions[candidate]::text THEN
        RAISE EXCEPTION 'Wrong active publication';
      END IF;
      IF candidate=1 THEN
        SELECT array_agg(parent_id) INTO old_parents FROM public.experience_revision_parents WHERE revision_id=revisions[1];
      END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM public.parent_documents WHERE id=ANY(old_parents))
      OR EXISTS(SELECT 1 FROM public.document_chunks WHERE parent_id=ANY(old_parents))
      OR (SELECT count(*) FROM public.experience_revisions WHERE source_id=s.id AND approved_json IS NOT NULL)<>2
      OR NOT EXISTS(SELECT 1 FROM public.experience_extractions WHERE id=extraction_id)
      OR (SELECT count(*) FROM public.match_approved_experience_chunks(
        ('[1,'||repeat('0,',1534)||'0]')::vector,-1,10,ARRAY[s.id]) WHERE revision_id=revisions[2])<>2 THEN
      RAISE EXCEPTION 'Replacement or retained history failed';
    END IF;
    results := results || '["PASS: replacement removes old live evidence and retains approval history"]';

    current_check := 'delete versus indexing';
    INSERT INTO public.experience_revisions(id,source_id,extraction_id,draft_json)
    VALUES(revisions[3],s.id,extraction_id,'{"draft":true}');
    UPDATE public.experience_sources SET latest_draft_revision_id=revisions[3] WHERE id=s.id;
    PERFORM public.approve_experience_revision(s.id,revisions[3],1,'{"approved":3}',repeat('3',64));
    SELECT execution_token INTO token FROM public.acquire_experience_source_execution(s.id,'indexing',300);
    -- Prepare a newer candidate while R2 stays active, then let deletion win.
    SELECT jsonb_agg(value || jsonb_build_object('revision_id',revisions[3],
      'approved_content_hash',repeat('3',64),'plan_hash','lifecycle-3'))
    INTO staged FROM jsonb_array_elements(staged);
    PERFORM public.stage_experience_embeddings(s.id,revisions[3],token,staged);
    result := public.delete_experience_source(s.id);
    IF result->>'deleted_parent_count' IS DISTINCT FROM '2'
      OR result->>'deleted_child_count' IS DISTINCT FROM '2'
      OR result->>'deleted_revision_count' IS DISTINCT FROM '3'
      OR result->>'deleted_extraction_count' IS DISTINCT FROM '1'
      OR result->>'deleted_staging_count' IS DISTINCT FROM '2' THEN
      RAISE EXCEPTION 'Deletion counts do not match fixture';
    END IF;
    FOR deletion_phase IN 1..2 LOOP
      IF deletion_phase=2 THEN
        UPDATE public.experience_sources SET status='cleanup-pending',
          cleanup_error='{"message":"synthetic storage failure"}'::jsonb WHERE id=s.id;
      END IF;
      SELECT to_jsonb(t) INTO before_state FROM public.experience_sources t WHERE id=s.id;
      rejected := false;
      BEGIN
        PERFORM public.publish_experience_revision(s.id,revisions[2],'lifecycle-2',repeat('2',64),
          2,2,'v1','gemini-embedding-001','RETRIEVAL_DOCUMENT',1536,token);
      EXCEPTION WHEN serialization_failure THEN rejected := true;
      END;
      IF NOT rejected OR (SELECT to_jsonb(t) FROM public.experience_sources t WHERE id=s.id)
        IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'Deletion retry resurrected/changed source'; END IF;
      result := public.delete_experience_source(s.id);
      IF result->>'already_deleted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Delete is not idempotent'; END IF;
    END LOOP;
    IF EXISTS(SELECT 1 FROM public.experience_revisions WHERE source_id=s.id)
      OR EXISTS(SELECT 1 FROM public.experience_extractions WHERE source_id=s.id)
      OR EXISTS(SELECT 1 FROM public.experience_index_staging WHERE revision_id=ANY(revisions))
      OR EXISTS(SELECT 1 FROM public.experience_revision_parents WHERE revision_id=ANY(revisions))
      OR EXISTS(SELECT 1 FROM public.parent_documents WHERE source_document_id=s.id::text)
      OR NOT EXISTS(SELECT 1 FROM public.parent_documents WHERE id=standalone_parent)
      OR (SELECT count(*) FROM public.document_chunks WHERE parent_id=standalone_parent)<>1
      OR EXISTS(SELECT 1 FROM public.match_approved_experience_chunks(
        ('[1,'||repeat('0,',1534)||'0]')::vector,-1,10,NULL) WHERE source_id=s.id OR parent_id=standalone_parent) THEN
      RAISE EXCEPTION 'Deletion/standalone isolation failed';
    END IF;
    results := results || '["PASS: deletion, cleanup-pending, late retry, repeated deletion, and standalone isolation"]';
    PERFORM set_config('app.retry_lifecycle_result',jsonb_build_object('status','PASS','checks',results)::text,true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.retry_lifecycle_result',jsonb_build_object('status','FAIL',
      'check',current_check,'sqlstate',SQLSTATE,'message',SQLERRM,'completed',results)::text,true);
  END;
END;
$check$;
SELECT current_setting('app.retry_lifecycle_result')::jsonb AS outcome;
ROLLBACK;
