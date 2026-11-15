import { RefreshIcon, WarningIcon } from "@/app/components/icons";
import { CONFLICT, conflictCopy } from "@/app/lib/experience/workspace/copy";
import { Button } from "../../_components/ui";

/**
 * Shown after an index request returned 409. For `index-candidate-stale` it names the searchable, latest approved
 * and not-indexed versions and waits for an explicit choice; for any other 409 it shows the server's reason. It
 * never re-sends anything itself.
 */
export default function ConflictPanel({
  stale,
  message,
  searchable,
  latest,
  notIndexed,
  refreshRequired,
  refreshError,
  canIndexLatest,
  busy,
  onIndexLatest,
  onLookFirst,
  onRefresh,
  onDismiss,
}: {
  stale: boolean;
  message: string;
  searchable: number | null;
  latest: number | null;
  notIndexed: number | null;
  refreshRequired: boolean;
  refreshError: string | null;
  canIndexLatest: boolean;
  busy: boolean;
  onIndexLatest: () => void;
  onLookFirst: () => void;
  onRefresh: () => void;
  onDismiss: () => void;
}) {
  const copy = conflictCopy({ latest, notIndexed, searchable });
  return (
    <section role="alert" aria-labelledby="conflict-title" className="mt-4 rounded-panel border border-amber-border bg-amber-wash p-4">
      <div className="flex items-start gap-3">
        <WarningIcon size={18} className="mt-0.5 shrink-0 text-amber" />
        <div className="min-w-0 flex-1">
          <h2 id="conflict-title" className="font-heading text-title-sm text-ink">
            {stale ? copy.title : "Indexing stopped"}
          </h2>
          <p className="mt-1 text-body-md text-ink-secondary">{stale ? copy.body : message}</p>
          {stale && <p className="mt-1 text-body-sm text-ink-muted">{message}</p>}

          {refreshRequired ? (
            <>
              <p className="mt-3 text-body-md font-semibold text-red">{CONFLICT.refreshFailed(refreshError ?? "")}</p>
              <Button className="mt-3" onClick={onRefresh} disabled={busy}>
                <RefreshIcon size={16} />
                {CONFLICT.refresh}
              </Button>
            </>
          ) : (
            <>
              {stale && (
                <dl className="mt-3 grid gap-2 sm:grid-cols-3">
                  {[copy.searchableNow, copy.latestApproved, copy.notIndexedFact].map((fact) => {
                    const [term, value] = fact.split(" · ");
                    return (
                      <div key={fact} className="rounded-control border border-hairline bg-card px-3 py-2">
                        <dt className="text-label-caps uppercase text-ink-muted">{term}</dt>
                        <dd className="text-body-md font-semibold text-ink">{value}</dd>
                      </div>
                    );
                  })}
                </dl>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {stale && canIndexLatest && (
                  <Button variant="primary" onClick={onIndexLatest} disabled={busy}>
                    {copy.indexLatest}
                  </Button>
                )}
                {stale && (
                  <Button onClick={onLookFirst} disabled={busy}>
                    {copy.lookFirst}
                  </Button>
                )}
                <Button variant="ghost" onClick={onDismiss}>
                  Dismiss
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
