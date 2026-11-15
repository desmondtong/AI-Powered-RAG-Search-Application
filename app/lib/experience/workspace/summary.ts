import type { SourceSummary } from "./types";

/** Number of sources Fit Check can search: those with an active (indexed and published) revision. */
export function countIndexed(sources: ReadonlyArray<Pick<SourceSummary, "active_revision_id">> | null | undefined): number {
  if (!Array.isArray(sources)) return 0;
  return sources.filter((source) => typeof source?.active_revision_id === "string" && source.active_revision_id.length > 0).length;
}
