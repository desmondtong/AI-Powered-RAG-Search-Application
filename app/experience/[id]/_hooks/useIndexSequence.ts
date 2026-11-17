"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Notice } from "@/app/components/NoticeProvider";
import { NOTICES } from "@/app/lib/experience/workspace/copy";
import { readApiErrorCode, readApiErrorMessage, type IndexProgress, type SourceDetail } from "@/app/lib/experience/workspace/types";

export type IndexStopReason = "indexed" | "no-progress" | "unmounted" | "error" | "conflict" | null;

export interface IndexConflict {
  code: string | null;
  message: string;
  /** The revision this page tried to index; shown as "Not indexed · version K". */
  attemptedRevisionId: string;
}

export interface IndexSequenceState {
  running: boolean;
  progress: IndexProgress | null;
  stopReason: IndexStopReason;
  error: string | null;
  conflict: IndexConflict | null;
  /** True while the post-conflict refresh is failing: every index action stays disabled until a refresh succeeds. */
  refreshRequired: boolean;
  refreshError: string | null;
}

const INITIAL: IndexSequenceState = {
  running: false,
  progress: null,
  stopReason: null,
  error: null,
  conflict: null,
  refreshRequired: false,
  refreshError: null,
};

type Refresh = () => Promise<{ detail: SourceDetail | null; error: string | null }>;

/**
 * One click indexes every batch (design Decision 6). `runIndexSequence` is only ever called from the "Index now",
 * "Continue indexing", "Retry indexing" and "Index version N" click handlers. It repeats the existing index request
 * for the same revision while the response says `indexing` with `next_action: "index"`, with no step ceiling, and
 * stops on `indexed`, an error, a 409, two responses with the same remaining count, or unmount. A 409 refreshes
 * state once and never re-sends.
 */
export function useIndexSequence(sourceId: string, refresh: Refresh, notice: Notice) {
  const [state, setState] = useState<IndexSequenceState>(INITIAL);
  const indexRequestInFlight = useRef(false);
  const refreshRequiredRef = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const setRefreshRequired = (value: boolean, error: string | null) => {
    refreshRequiredRef.current = value;
    setState((current) => ({ ...current, refreshRequired: value, refreshError: error }));
  };

  const runIndexSequence = useCallback(
    async (revisionId: string | null | undefined) => {
      if (!revisionId || indexRequestInFlight.current || refreshRequiredRef.current) return;
      indexRequestInFlight.current = true;
      setState((current) => ({ ...current, running: true, progress: null, stopReason: null, error: null, conflict: null }));
      let lastRemaining: number | null = null;
      let stopReason: IndexStopReason = null;
      let refreshAtEnd = true;
      try {
        while (true) {
          if (!alive.current) {
            stopReason = "unmounted";
            refreshAtEnd = false;
            break;
          }
          const response = await fetch(`/api/experiences/${sourceId}/index`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ revision_id: revisionId }),
          });
          const data = await response.json().catch(() => null);

          if (!response.ok) {
            const message = readApiErrorMessage(data, "Indexing failed.");
            if (response.status === 409) {
              // Stop, refresh once, and wait for an explicit choice. Never retry or retarget on our own.
              stopReason = "conflict";
              refreshAtEnd = false;
              setState((current) => ({ ...current, conflict: { code: readApiErrorCode(data), message, attemptedRevisionId: revisionId } }));
              const { error } = await refresh();
              setRefreshRequired(Boolean(error), error);
            } else {
              stopReason = "error";
              setState((current) => ({ ...current, error: message }));
            }
            break;
          }

          const progress: IndexProgress | null = data?.progress ?? null;
          setState((current) => ({ ...current, progress }));
          if (data?.status === "indexing" && data?.next_action === "index") {
            const remaining = typeof progress?.remaining_chunks === "number" ? progress.remaining_chunks : null;
            if (remaining !== null && remaining === lastRemaining) {
              stopReason = "no-progress";
              break;
            }
            lastRemaining = remaining;
            continue;
          }
          stopReason = data?.status === "indexed" ? "indexed" : null;
          break;
        }
      } catch {
        stopReason = "error";
        setState((current) => ({ ...current, error: "The indexing request did not reach the server. Choose Continue indexing to try again." }));
      } finally {
        indexRequestInFlight.current = false;
        if (alive.current) {
          setState((current) => ({ ...current, running: false, stopReason }));
          if (refreshAtEnd) {
            const { detail } = await refresh();
            if (stopReason === "indexed") {
              notice.success(NOTICES.searchable(detail?.source.active_version_number ?? null), {
                action: { label: NOTICES.tryJd, href: "/" },
              });
            }
          }
        }
      }
    },
    [sourceId, refresh, notice],
  );

  /** Manual refresh, the only way out of a failed post-conflict refresh. Never indexes. */
  const manualRefresh = useCallback(async () => {
    const { error } = await refresh();
    setRefreshRequired(Boolean(error), error);
    return error;
  }, [refresh]);

  const dismissConflict = useCallback(() => setState((current) => ({ ...current, conflict: null })), []);

  return { ...state, runIndexSequence, manualRefresh, dismissConflict };
}
