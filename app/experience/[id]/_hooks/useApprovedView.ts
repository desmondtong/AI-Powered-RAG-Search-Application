"use client";

import { useCallback, useEffect, useState } from "react";
import { readApiErrorMessage, type AcceptedRevisionExport } from "@/app/lib/experience/workspace/types";

export type ApprovedViewStatus = "idle" | "loading" | "ready" | "error";

/** The outcome of one export read, tagged with the revision and attempt it answers so stale results are ignored. */
interface ApprovedViewResult {
  revisionId: string;
  attempt: number;
  doc: AcceptedRevisionExport | null;
  error: string | null;
}

/**
 * Loads the latest approved revision's export for the read-only view (design Decision 4): one read per revision id
 * while `enabled`, through the same endpoint that feeds "Inspect accepted JSON" and citation quotes. "Loading" is
 * derived (no result yet for this revision and attempt) rather than set, and errors stay in the returned state;
 * nothing here raises a notice.
 */
export function useApprovedView(sourceId: string, revisionId: string | null, enabled: boolean) {
  const [result, setResult] = useState<ApprovedViewResult | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !revisionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/experiences/${sourceId}/revisions/${revisionId}/export`);
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setResult({ revisionId, attempt, doc: null, error: readApiErrorMessage(data, "The approved version could not be loaded.") });
          return;
        }
        setResult({ revisionId, attempt, doc: data as AcceptedRevisionExport, error: null });
      } catch {
        if (!cancelled) {
          setResult({
            revisionId,
            attempt,
            doc: null,
            error: "The approved version could not be loaded. Check your connection and try again.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId, revisionId, enabled, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  if (!enabled || !revisionId) return { status: "idle" as const, doc: null, error: null, retry };
  const current = result && result.revisionId === revisionId && result.attempt === attempt ? result : null;
  if (!current) return { status: "loading" as const, doc: null, error: null, retry };
  if (current.doc) return { status: "ready" as const, doc: current.doc, error: null, retry };
  return { status: "error" as const, doc: null, error: current.error, retry };
}
