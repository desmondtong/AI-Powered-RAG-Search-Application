import {
  approveExperienceRevision,
  createDraftFromApprovedRevision,
  deleteExperienceSource,
  extractExperienceSource,
  getExperienceSourceDetail,
  indexExperienceRevision,
  listExperienceSources,
  parseExperienceSource,
  saveExperienceDraft,
  uploadExperienceSourceFromFile,
  type ExperienceServiceClient,
} from "../../experience/apiService";
import type { IngestionPort } from "./commands";

/** Binds the corpus commands to the accepted ingestion service functions. Called only after the guards pass. */
export function defaultIngestionPort(client?: ExperienceServiceClient): IngestionPort {
  return {
    upload: (file) => uploadExperienceSourceFromFile(file, client),
    extract: (sourceId) => extractExperienceSource(sourceId, client),
    parse: (sourceId) => parseExperienceSource(sourceId, client),
    getDraft: async (sourceId, revisionId) => {
      const detail = await getExperienceSourceDetail(sourceId, client);
      const row = detail.revisions.find((revision) => revision.id === revisionId);
      const canonical = (row?.draft_json as { canonical_revision?: Record<string, unknown> } | null)?.canonical_revision;
      if (!row || !canonical) throw new Error(`Draft ${revisionId} of source ${sourceId} was not found.`);
      return { canonical_revision: canonical, draft_version: row.draft_version };
    },
    saveDraft: (sourceId, body) => saveExperienceDraft(sourceId, body, client),
    approve: (sourceId, body) => approveExperienceRevision(sourceId, body, client),
    index: (sourceId, body) => indexExperienceRevision(sourceId, body, client),
    createDraftFromApproved: (sourceId, body) => createDraftFromApprovedRevision(sourceId, body, client),
    deleteSource: (sourceId) => deleteExperienceSource(sourceId, client),
    listSources: () => listExperienceSources(client),
  };
}
