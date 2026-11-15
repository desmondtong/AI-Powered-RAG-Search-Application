import { formatTimestamp } from "./copy";
import type { ApprovedVersion, SourceDetail, SourceSummary } from "./types";

/** "Version 3". Display only: actions always use revision IDs. */
export function versionLabel(versionNumber: number): string {
  return `Version ${versionNumber}`;
}

/** The number the next approval will receive: latest approved + 1, or 1 when nothing was approved yet. */
export function nextVersionNumber(latestApprovedVersion: number | null | undefined): number {
  return typeof latestApprovedVersion === "number" && latestApprovedVersion > 0 ? latestApprovedVersion + 1 : 1;
}

/** "Draft for version 4", or "Draft for version 1" when no revision has been approved. */
export function draftLabel(latestApprovedVersion: number | null | undefined): string {
  return `Draft for version ${nextVersionNumber(latestApprovedVersion)}`;
}

export function versionForRevision(revisionId: string | null | undefined, approvedVersions: readonly ApprovedVersion[] | undefined) {
  if (!revisionId || !approvedVersions) return null;
  return approvedVersions.find((version) => version.revision_id === revisionId) ?? null;
}

export interface RevisionDescription {
  versionNumber: number;
  label: string;
  /** Formatted approval time, shown as secondary detail. */
  approvedAt: string;
}

export interface RevisionLabels {
  searchable: RevisionDescription | null;
  latestApproved: RevisionDescription | null;
  /** Present when an open draft exists that is newer than the latest approval. */
  draft: { label: string; nextVersion: number } | null;
}

function describe(version: ApprovedVersion | null, fallbackNumber: number | null | undefined): RevisionDescription | null {
  const number = version?.version_number ?? (typeof fallbackNumber === "number" ? fallbackNumber : null);
  if (number === null) return null;
  return { versionNumber: number, label: versionLabel(number), approvedAt: formatTimestamp(version?.approved_at) };
}

/** Whether the source's latest draft revision is an open draft newer than what was approved. */
export function hasOpenDraft(source: Pick<SourceSummary, "latest_draft_revision_id" | "latest_approved_revision_id" | "status">, detail?: Pick<SourceDetail, "latest_revision"> | null) {
  if (!source.latest_draft_revision_id) return false;
  if (source.latest_draft_revision_id === source.latest_approved_revision_id) return false;
  if (detail?.latest_revision) {
    return detail.latest_revision.id === source.latest_draft_revision_id && detail.latest_revision.status === "draft";
  }
  return source.status === "draft";
}

/** Human names for the searchable, latest approved and draft revisions. Never includes a revision ID. */
export function describeRevisions(source: SourceSummary, detail?: SourceDetail | null): RevisionLabels {
  const approvedVersions = detail?.approved_versions;
  const searchable = source.active_revision_id
    ? describe(versionForRevision(source.active_revision_id, approvedVersions), source.active_version_number)
    : null;
  const latestApproved = source.latest_approved_revision_id
    ? describe(versionForRevision(source.latest_approved_revision_id, approvedVersions), source.latest_approved_version_number)
    : null;
  const draft = hasOpenDraft(source, detail)
    ? { label: draftLabel(latestApproved?.versionNumber), nextVersion: nextVersionNumber(latestApproved?.versionNumber) }
    : null;
  return { searchable, latestApproved, draft };
}
