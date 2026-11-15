"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { countIndexed } from "@/app/lib/experience/workspace/summary";
import type { SourceSummary } from "@/app/lib/experience/workspace/types";

export type WorkspaceSummaryStatus = "loading" | "ready" | "error";

export interface WorkspaceSummary {
  sources: SourceSummary[];
  /** Sources with an active indexed revision, or null when the list could not be loaded. Never a fake zero. */
  indexedCount: number | null;
  status: WorkspaceSummaryStatus;
  error: string | null;
  /** Re-reads `GET /api/experiences`. Resolves to the new list, or null when the read failed. */
  refresh: () => Promise<SourceSummary[] | null>;
}

const WorkspaceSummaryContext = createContext<WorkspaceSummary | null>(null);

function readMessage(data: unknown, fallback: string) {
  const error = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
  if (typeof error === "string") return error;
  const message = error && typeof error === "object" ? (error as Record<string, unknown>).message : null;
  return typeof message === "string" && message ? message : fallback;
}

/** Shared source list for the top-bar pill, the Fit Check empty state and the Experience list. */
export function WorkspaceSummaryProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [status, setStatus] = useState<WorkspaceSummaryStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const response = await fetch("/api/experiences", { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as { sources?: SourceSummary[] } | null;
      if (!response.ok || !data || !Array.isArray(data.sources)) {
        throw new Error(readMessage(data, "Your experience files could not be loaded."));
      }
      if (request === latestRequest.current) {
        setSources(data.sources);
        setStatus("ready");
        setError(null);
      }
      return data.sources;
    } catch (loadError) {
      if (request === latestRequest.current) {
        setStatus("error");
        setError(loadError instanceof Error ? loadError.message : "Your experience files could not be loaded.");
      }
      return null;
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  const value = useMemo<WorkspaceSummary>(
    () => ({
      sources,
      indexedCount: status === "ready" ? countIndexed(sources) : null,
      status,
      error,
      refresh,
    }),
    [sources, status, error, refresh],
  );

  return <WorkspaceSummaryContext.Provider value={value}>{children}</WorkspaceSummaryContext.Provider>;
}

export function useWorkspaceSummary(): WorkspaceSummary {
  const context = useContext(WorkspaceSummaryContext);
  if (!context) {
    throw new Error("useWorkspaceSummary must be used inside WorkspaceSummaryProvider.");
  }
  return context;
}
