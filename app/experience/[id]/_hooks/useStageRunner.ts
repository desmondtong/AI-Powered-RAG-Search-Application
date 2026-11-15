"use client";

import { useCallback, useRef, useState } from "react";
import { PROCESSING } from "@/app/lib/experience/workspace/copy";
import { readApiErrorMessage, type SourceDetail } from "@/app/lib/experience/workspace/types";

export type RunnerStage = "extract" | "parse";

export interface StageRunnerState {
  running: RunnerStage | null;
  errors: Partial<Record<RunnerStage, string>>;
  /** Set when another execution owned the stage; the page refreshes and polls instead of re-sending. */
  notice: string | null;
}

/**
 * Client-side extract→parse chain (design Decision 5). Each step is the existing API call; parse is requested only
 * after a refresh confirms the source is `extracted`. A 409 means another execution holds the lease: the page
 * refreshes and lets polling follow it, and never re-sends the request on its own.
 */
export function useStageRunner(sourceId: string, refresh: () => Promise<{ detail: SourceDetail | null; error: string | null }>) {
  const [state, setState] = useState<StageRunnerState>({ running: null, errors: {}, notice: null });
  const inFlight = useRef(false);

  const post = useCallback(
    async (stage: RunnerStage) => {
      setState((current) => ({ ...current, running: stage, errors: { ...current.errors, [stage]: undefined }, notice: null }));
      try {
        const response = await fetch(`/api/experiences/${sourceId}/${stage}`, { method: "POST" });
        const data = await response.json().catch(() => null);
        if (response.ok) return "ok" as const;
        if (response.status === 409) {
          setState((current) => ({ ...current, notice: PROCESSING.alreadyRunning }));
          return "conflict" as const;
        }
        const fallback = stage === "extract" ? "Extraction failed." : "Parsing failed.";
        setState((current) => ({ ...current, errors: { ...current.errors, [stage]: readApiErrorMessage(data, fallback) } }));
        return "failed" as const;
      } catch {
        setState((current) => ({
          ...current,
          errors: { ...current.errors, [stage]: "The request did not reach the server. Check your connection and try again." },
        }));
        return "failed" as const;
      }
    },
    [sourceId],
  );

  const runChain = useCallback(
    async (from: RunnerStage) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        if (from === "extract") {
          const extracted = await post("extract");
          const { detail } = await refresh();
          if (extracted !== "ok") return;
          // Parse only when the refreshed state confirms extraction finished.
          if (detail?.source.status !== "extracted") return;
        }
        await post("parse");
        await refresh();
      } finally {
        inFlight.current = false;
        setState((current) => ({ ...current, running: null }));
      }
    },
    [post, refresh],
  );

  return { ...state, runChain, busy: state.running !== null };
}
