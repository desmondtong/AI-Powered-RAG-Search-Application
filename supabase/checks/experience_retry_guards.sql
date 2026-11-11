-- Remote-only: confirm MCP get_project_url equals
-- https://lwljmmfcvmbnrfstltzj.supabase.co before execution. Never run locally.
-- Failure is reported in outcome.status; the whole fixture always rolls back.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '3s';
SET LOCAL search_path = public, extensions;
SET LOCAL ROLE service_role;
DO $check$
<<fixture>>
DECLARE
  s public.experience_sources%ROWTYPE;
  other_source public.experience_sources%ROWTYPE;
  extraction_id uuid := gen_random_uuid();
  revision_id uuid := gen_random_uuid();
  token uuid;
  parent_id uuid;
  parameters jsonb;
  overrides jsonb;
  item jsonb;
  snapshot_before jsonb;
  snapshot_after jsonb;
  rejected boolean;
  failure_code text;
  failure_message text;
  results jsonb := '[]';
  current_check text := 'fixture setup';
BEGIN
  BEGIN
    SELECT * INTO s FROM public.reserve_experience_source(
      replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''), 'guards.docx','docx',42);
    SELECT * INTO other_source FROM public.reserve_experience_source(
      replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''), 'other.docx','docx',42);
    INSERT INTO public.experience_extractions(id,source_id,text_sha256,parser_version,normalization_version,blocks)
    VALUES(extraction_id,s.id,'guards-text','v1','v1','[{"block_id":"b1","text":"Synthetic citation"}]');
    INSERT INTO public.experience_revisions(id,source_id,extraction_id,draft_json)
    VALUES(revision_id,s.id,extraction_id,'{"draft":true}');
    UPDATE public.experience_sources SET latest_draft_revision_id=revision_id WHERE id=s.id;
    PERFORM public.approve_experience_revision(s.id,revision_id,1,'{"approved":true}',repeat('d',64));
    SELECT execution_token INTO token FROM public.acquire_experience_source_execution(s.id,'indexing',300);
    PERFORM public.stage_experience_embeddings(s.id,revision_id,token,jsonb_build_array(jsonb_build_object(
      'revision_id',revision_id,'logical_chunk_key','chunk-1','plan_hash','guards-plan',
      'approved_content_hash',repeat('d',64),'chunking_version','v1','embedding_model','gemini-embedding-001',
      'embedding_task_type','RETRIEVAL_DOCUMENT','embedding_dimensions',1536,
      'parent_payload',jsonb_build_object('source_document_id',s.id::text,'source_file_name','guards.docx',
        'source_file_type','docx','parent_text','Synthetic citation',
        'metadata','{"logical_experience_id":"experience-1","logical_parent_id":"parent-1"}'::jsonb),
      'child_payload','{"child_text":"Synthetic citation","embedding_text":"Synthetic citation","metadata":{"logical_chunk_id":"chunk-1"},"chunk_index":0}'::jsonb,
      'embedding',('[1,'||repeat('0,',1534)||'0]')::jsonb)));
    PERFORM public.publish_experience_revision(s.id,revision_id,'guards-plan',repeat('d',64),
      1,1,'v1','gemini-embedding-001','RETRIEVAL_DOCUMENT',1536,token);
    SELECT rp.parent_id INTO parent_id FROM public.experience_revision_parents rp WHERE rp.revision_id=fixture.revision_id;
    SELECT execution_token INTO token FROM public.acquire_experience_source_execution(s.id,'indexing',300);
    parameters := jsonb_build_object('source',s.id,'revision',revision_id,'plan','guards-plan',
      'hash',repeat('d',64),'parents',1,'children',1,'chunking','v1',
      'model','gemini-embedding-001','task','RETRIEVAL_DOCUMENT','dimensions',1536,'token',token);

    FOR item IN SELECT value FROM jsonb_array_elements('[
      {"name":"omitted token"},{"name":"null token","override":{"token":null}},
      {"name":"replaced token"},{"name":"expired token"},{"name":"wrong-stage token"},
      {"name":"wrong-source revision"},
      {"name":"wrong approved hash","override":{"hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}},
      {"name":"null approved hash","override":{"hash":null}},
      {"name":"empty approved hash","override":{"hash":""}},
      {"name":"wrong plan","override":{"plan":"other-plan"}},
      {"name":"null plan","override":{"plan":null}},
      {"name":"empty plan","override":{"plan":""}},
      {"name":"wrong parent count","override":{"parents":2}},
      {"name":"null parent count","override":{"parents":null}},
      {"name":"invalid parent count","override":{"parents":0}},
      {"name":"wrong child count","override":{"children":2}},
      {"name":"null child count","override":{"children":null}},
      {"name":"invalid child count","override":{"children":0}},
      {"name":"wrong chunking","override":{"chunking":"v2"}},
      {"name":"null chunking","override":{"chunking":null}},
      {"name":"empty chunking","override":{"chunking":""}},
      {"name":"wrong model","override":{"model":"other-model"}},
      {"name":"null model","override":{"model":null}},
      {"name":"empty model","override":{"model":""}},
      {"name":"wrong task","override":{"task":"RETRIEVAL_QUERY"}},
      {"name":"null task","override":{"task":null}},
      {"name":"wrong dimensions","override":{"dimensions":768}},
      {"name":"null dimensions","override":{"dimensions":null}},
      {"name":"missing child"},{"name":"missing mapping"},{"name":"mismatched mapping"}
    ]'::jsonb) LOOP
      current_check := item->>'name';
      -- Roll each test's deliberate fixture corruption back before the next case.
      BEGIN
        overrides := parameters || COALESCE(item->'override','{}'::jsonb);
        IF current_check='replaced token' THEN
          overrides := overrides || jsonb_build_object('token',gen_random_uuid());
        ELSIF current_check='expired token' THEN
          UPDATE public.experience_sources SET execution_token_expires_at=clock_timestamp()-interval '1 second' WHERE id=s.id;
        ELSIF current_check='wrong-stage token' THEN
          UPDATE public.experience_sources SET execution_stage='parsing' WHERE id=s.id;
        ELSIF current_check='wrong-source revision' THEN
          overrides := overrides || jsonb_build_object('source',other_source.id);
        ELSIF current_check='missing child' THEN
          DELETE FROM public.document_chunks c WHERE c.parent_id=fixture.parent_id;
        ELSIF current_check='missing mapping' THEN
          DELETE FROM public.experience_revision_parents rp WHERE rp.revision_id=fixture.revision_id;
        ELSIF current_check='mismatched mapping' THEN
          UPDATE public.experience_revision_parents rp SET metadata=rp.metadata || '{"embedding_model":"other-model"}'::jsonb WHERE rp.revision_id=fixture.revision_id;
        END IF;
        SELECT jsonb_build_object(
          'sources',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.experience_sources t WHERE id IN(s.id,other_source.id)),
          'revision',(SELECT to_jsonb(t) FROM public.experience_revisions t WHERE id=revision_id),
          'parents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.parent_documents t WHERE source_document_id=s.id::text),
          'chunks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.document_chunks t WHERE t.parent_id=fixture.parent_id),
          'mappings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.parent_id) FROM public.experience_revision_parents t WHERE t.revision_id=fixture.revision_id)
        ) INTO snapshot_before;
        rejected := false;
        BEGIN
          IF current_check='omitted token' THEN
            PERFORM public.publish_experience_revision(s.id,revision_id,'guards-plan',repeat('d',64),
              1,1,'v1','gemini-embedding-001','RETRIEVAL_DOCUMENT',1536);
          ELSE
            PERFORM public.publish_experience_revision(
              (overrides->>'source')::uuid,(overrides->>'revision')::uuid,
              overrides->>'plan',overrides->>'hash',(overrides->>'parents')::integer,
              (overrides->>'children')::integer,overrides->>'chunking',overrides->>'model',
              overrides->>'task',(overrides->>'dimensions')::integer,(overrides->>'token')::uuid);
          END IF;
        EXCEPTION WHEN OTHERS THEN
          failure_code := SQLSTATE;
          failure_message := SQLERRM;
          IF failure_code NOT IN ('40001','P0001') THEN RAISE; END IF;
          rejected := true;
        END;
        IF NOT rejected THEN RAISE EXCEPTION 'Invalid retry unexpectedly succeeded: %',current_check; END IF;
        SELECT jsonb_build_object(
          'sources',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.experience_sources t WHERE id IN(s.id,other_source.id)),
          'revision',(SELECT to_jsonb(t) FROM public.experience_revisions t WHERE id=revision_id),
          'parents',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.parent_documents t WHERE source_document_id=s.id::text),
          'chunks',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.document_chunks t WHERE t.parent_id=fixture.parent_id),
          'mappings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.parent_id) FROM public.experience_revision_parents t WHERE t.revision_id=fixture.revision_id)
        ) INTO snapshot_after;
        IF snapshot_before IS DISTINCT FROM snapshot_after THEN
          RAISE EXCEPTION 'Rejected retry changed state: %',current_check;
        END IF;
        results := results || jsonb_build_array(jsonb_build_object(
          'check',current_check,'status','PASS','sqlstate',failure_code,'message',failure_message));
        RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='Undo test-only corruption';
      EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
      END;
    END LOOP;
    PERFORM set_config('app.retry_guard_result',jsonb_build_object('status','PASS','checks',results)::text,true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.retry_guard_result',jsonb_build_object('status','FAIL',
      'check',current_check,'sqlstate',SQLSTATE,'message',SQLERRM,'completed',results)::text,true);
  END;
END;
$check$;
SELECT current_setting('app.retry_guard_result')::jsonb AS outcome;
ROLLBACK;
