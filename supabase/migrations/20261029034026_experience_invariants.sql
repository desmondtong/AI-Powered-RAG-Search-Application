BEGIN;
SET LOCAL search_path = public, extensions;

CREATE FUNCTION public.validate_experience_revision_source()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.experience_extractions e
    WHERE e.id = NEW.extraction_id
      AND e.source_id = NEW.source_id
  ) THEN
    RAISE EXCEPTION 'Experience revision extraction must belong to the same source';
  END IF;

  IF NEW.approved_content_hash IS NOT NULL AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'Approved revisions cannot remain in draft status';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.prevent_experience_extraction_mutation()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Experience extraction snapshots are immutable';
END;
$$;

CREATE FUNCTION public.prevent_approved_experience_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_catalog AS $$
BEGIN
  IF OLD.approved_content_hash IS NOT NULL
     AND (
       NEW.source_id IS DISTINCT FROM OLD.source_id
       OR NEW.extraction_id IS DISTINCT FROM OLD.extraction_id
       OR NEW.draft_json IS DISTINCT FROM OLD.draft_json
       OR NEW.draft_version IS DISTINCT FROM OLD.draft_version
       OR NEW.approved_json IS DISTINCT FROM OLD.approved_json
       OR NEW.approved_content_hash IS DISTINCT FROM OLD.approved_content_hash
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     ) THEN
    RAISE EXCEPTION 'Approved experience revision content is immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.validate_experience_revision_parent_source()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_catalog AS $$
DECLARE
  revision_source_id uuid;
BEGIN
  SELECT source_id INTO revision_source_id
  FROM public.experience_revisions
  WHERE id = NEW.revision_id;

  IF revision_source_id IS NULL THEN
    RAISE EXCEPTION 'Experience revision mapping references an unknown revision';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.parent_documents p
    WHERE p.id = NEW.parent_id
      AND p.source_document_id = revision_source_id::text
  ) THEN
    RAISE EXCEPTION 'Experience publication parent must belong to the revision source';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.validate_experience_source_pointers()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_catalog AS $$
BEGIN
  IF NEW.latest_extraction_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.experience_extractions e
       WHERE e.id = NEW.latest_extraction_id
         AND e.source_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'Latest extraction pointer must belong to the source';
  END IF;

  IF NEW.latest_draft_revision_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.experience_revisions r
       WHERE r.id = NEW.latest_draft_revision_id
         AND r.source_id = NEW.id
         AND r.status = 'draft'
     ) THEN
    RAISE EXCEPTION 'Latest draft pointer must reference a draft revision owned by the source';
  END IF;

  IF NEW.latest_approved_revision_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.experience_revisions r
       WHERE r.id = NEW.latest_approved_revision_id
         AND r.source_id = NEW.id
         AND r.status IN ('approved', 'indexing', 'indexed')
         AND r.approved_json IS NOT NULL
         AND r.approved_content_hash IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Latest approved pointer must reference an approved revision owned by the source';
  END IF;

  IF NEW.active_revision_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.experience_revisions r
       WHERE r.id = NEW.active_revision_id
         AND r.source_id = NEW.id
         AND r.status = 'indexed'
         AND r.approved_json IS NOT NULL
         AND r.approved_content_hash IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM public.experience_revision_parents rp
           WHERE rp.revision_id = r.id
         )
     ) THEN
    RAISE EXCEPTION 'Active revision pointer must reference a published indexed revision owned by the source';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER experience_revisions_validate_source
  BEFORE INSERT OR UPDATE OF source_id, extraction_id, approved_content_hash, status
  ON public.experience_revisions
  FOR EACH ROW EXECUTE FUNCTION public.validate_experience_revision_source();

CREATE TRIGGER experience_extractions_immutable
  BEFORE UPDATE ON public.experience_extractions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_experience_extraction_mutation();

CREATE TRIGGER experience_revisions_approved_content_immutable
  BEFORE UPDATE ON public.experience_revisions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_approved_experience_revision_mutation();

CREATE TRIGGER experience_revision_parents_validate_source
  BEFORE INSERT OR UPDATE OF revision_id, parent_id
  ON public.experience_revision_parents
  FOR EACH ROW EXECUTE FUNCTION public.validate_experience_revision_parent_source();

CREATE TRIGGER experience_sources_validate_pointers
  BEFORE INSERT OR UPDATE OF
    latest_extraction_id,
    latest_draft_revision_id,
    latest_approved_revision_id,
    active_revision_id
  ON public.experience_sources
  FOR EACH ROW EXECUTE FUNCTION public.validate_experience_source_pointers();

REVOKE ALL ON FUNCTION public.validate_experience_revision_source() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_experience_extraction_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_approved_experience_revision_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_experience_revision_parent_source() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_experience_source_pointers() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.validate_experience_revision_source() TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_experience_extraction_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION public.prevent_approved_experience_revision_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_experience_revision_parent_source() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_experience_source_pointers() TO service_role;

COMMIT;
