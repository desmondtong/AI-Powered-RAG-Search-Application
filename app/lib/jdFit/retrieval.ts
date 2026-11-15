import {
  readApprovedRevisionContent,
  searchApprovedExperienceEvidence,
  type ApprovedExperienceSearchResult,
  type ApprovedRevisionContentRow,
} from "../experience/approvedSearch";
import { JD_FIT_MATCHES_PER_REQUIREMENT, JD_FIT_MATCH_THRESHOLD, JD_FIT_RETRIEVAL_CONCURRENCY } from "./config";
import { attachCitationLabels, type EvidenceRecord } from "./context";
import { JdFitError, type JdFitRequirement } from "./contracts";
import type { JdFitDeadline } from "./generation";

/** Retrieval options JD-fit may pass. There is deliberately no source list: every eligible source is searched. */
export interface JdFitSearchOptions {
  matchCount: number;
  matchThreshold: number;
}

export type JdFitSearch = (query: string, options: JdFitSearchOptions) => Promise<ApprovedExperienceSearchResult[]>;

/** Calls the ingestion-owned approved-search helper unchanged, without `sourceIds`. */
export const approvedEvidenceSearch: JdFitSearch = (query, options) =>
  searchApprovedExperienceEvidence(query, { matchCount: options.matchCount, matchThreshold: options.matchThreshold });

export interface RequirementEvidence {
  requirement_id: string;
  hits: ApprovedExperienceSearchResult[];
}

export interface RetrieveRequirementEvidenceInput {
  requirements: JdFitRequirement[];
  deadline: JdFitDeadline;
  search?: JdFitSearch;
  matchCount?: number;
  matchThreshold?: number;
  concurrency?: number;
}

export async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

/** One approved-search lookup per requirement, at most `concurrency` at a time, within the overall deadline. */
export async function retrieveRequirementEvidence(input: RetrieveRequirementEvidenceInput): Promise<RequirementEvidence[]> {
  const search = input.search ?? approvedEvidenceSearch;
  const options: JdFitSearchOptions = {
    matchCount: input.matchCount ?? JD_FIT_MATCHES_PER_REQUIREMENT,
    matchThreshold: input.matchThreshold ?? JD_FIT_MATCH_THRESHOLD,
  };

  return mapWithConcurrency(input.requirements, input.concurrency ?? JD_FIT_RETRIEVAL_CONCURRENCY, async (requirement) => {
    try {
      const hits = await input.deadline.race(search(requirement.retrieval_query, { ...options }), "retrieval");
      return { requirement_id: requirement.requirement_id, hits };
    } catch (error) {
      if (error instanceof JdFitError) {
        throw error;
      }
      throw new JdFitError("retrieval-failed", "Approved experience evidence could not be searched.", 502, {
        requirement_id: requirement.requirement_id,
      });
    }
  });
}

/** Read-only lookup of approved content for revisions retrieval already returned. */
export type JdFitLabelLookup = (revisionIds: string[], sourceIds: string[]) => Promise<ApprovedRevisionContentRow[]>;

/** Calls the ingestion-owned read helper unchanged. */
export const approvedRevisionLabelLookup: JdFitLabelLookup = (revisionIds, sourceIds) =>
  readApprovedRevisionContent(revisionIds, sourceIds);

export interface ResolveCitationLabelsInput {
  evidence: EvidenceRecord[];
  deadline: JdFitDeadline;
  lookup?: JdFitLabelLookup;
}

/**
 * Labels context evidence with experience title, type and evidence kinds from the cited revisions' approved content,
 * in one lookup scoped to the retrieved revision and source IDs. A failed lookup leaves every citation unlabelled and
 * the report still returns; only the overall deadline is allowed to stop the evaluation.
 */
export async function resolveCitationLabels(input: ResolveCitationLabelsInput): Promise<{ resolved: boolean }> {
  if (input.evidence.length === 0) return { resolved: true };
  const lookup = input.lookup ?? approvedRevisionLabelLookup;
  const revisionIds = [...new Set(input.evidence.map((record) => record.hit.revision_id))];
  const sourceIds = [...new Set(input.evidence.map((record) => record.hit.source_id))];
  let rows: ApprovedRevisionContentRow[];
  try {
    rows = await input.deadline.race(lookup(revisionIds, sourceIds), "citation-labels");
  } catch (error) {
    if (error instanceof JdFitError && error.code === "deadline-exceeded") {
      throw error;
    }
    rows = [];
  }
  attachCitationLabels(input.evidence, rows);
  return { resolved: rows.length > 0 };
}
