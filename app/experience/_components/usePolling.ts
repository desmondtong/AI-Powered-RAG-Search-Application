"use client";

import { useEffect, useRef } from "react";

export const POLL_INITIAL_MS = 3_000;
export const POLL_MAX_MS = 10_000;

/** Statuses whose work runs on the server and settles on its own. */
export const IN_PROGRESS_STATUSES: ReadonlySet<string> = new Set(["extracting", "parsing", "indexing"]);

/**
 * Re-runs `poll` while `active`: first after 3 s, then backing off to 10 s. Pauses while the tab is hidden and
 * stops as soon as `active` turns false (the state settled, or this page started its own request).
 */
export function usePolling(active: boolean, poll: () => Promise<unknown> | void) {
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    if (!active) return;
    let delay = POLL_INITIAL_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(async () => {
        if (cancelled) return;
        if (document.hidden) {
          schedule();
          return;
        }
        try {
          await pollRef.current();
        } finally {
          delay = Math.min(POLL_MAX_MS, Math.round(delay * 1.6));
          schedule();
        }
      }, delay);
    };

    const onVisibility = () => {
      if (!document.hidden && !cancelled) {
        if (timer) clearTimeout(timer);
        delay = POLL_INITIAL_MS;
        schedule();
      }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active]);
}
