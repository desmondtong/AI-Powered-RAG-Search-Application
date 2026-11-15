export interface ApprovedRevisionRow {
  id: string;
  approved_at: string | null;
}

export interface ApprovedVersion {
  revision_id: string;
  version_number: number;
  approved_at: string;
}

/**
 * Sort key for a Postgres timestamptz string. `Date.parse` keeps only
 * milliseconds, so the sub-millisecond digits are added back to keep two
 * approvals within the same millisecond in their true order.
 */
function timestampKey(value: string): [number, number] {
  const millis = Date.parse(value);
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? "";
  const subMillis = Number((fraction.slice(3, 6) || "0").padEnd(3, "0"));
  return [Number.isNaN(millis) ? Number.POSITIVE_INFINITY : millis, subMillis];
}

function compareApproved(a: ApprovedRevisionRow & { approved_at: string }, b: ApprovedRevisionRow & { approved_at: string }) {
  const [aMillis, aSub] = timestampKey(a.approved_at);
  const [bMillis, bSub] = timestampKey(b.approved_at);
  if (aMillis !== bMillis) {
    return aMillis < bMillis ? -1 : 1;
  }
  if (aSub !== bSub) {
    return aSub - bSub;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}

/**
 * Numbers one source's approved revisions from 1 in approval order
 * (`approved_at`, then `id`). Rows without `approved_at` were never approved
 * and get no number. Display-only: actions keep using revision IDs.
 */
export function numberApprovedVersions(rows: readonly ApprovedRevisionRow[]): ApprovedVersion[] {
  const seen = new Set<string>();
  const approved: Array<ApprovedRevisionRow & { approved_at: string }> = [];
  for (const row of rows) {
    if (row.approved_at === null || row.approved_at === undefined || seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    approved.push({ id: row.id, approved_at: row.approved_at });
  }
  return approved.sort(compareApproved).map((row, index) => ({
    revision_id: row.id,
    version_number: index + 1,
    approved_at: row.approved_at,
  }));
}

export function versionNumberMap(versions: readonly ApprovedVersion[]): Map<string, number> {
  return new Map(versions.map((version) => [version.revision_id, version.version_number]));
}
