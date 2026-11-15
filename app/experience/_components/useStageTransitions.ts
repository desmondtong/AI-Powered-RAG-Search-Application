"use client";

import { useEffect, useRef } from "react";
import type { Notice } from "@/app/components/NoticeProvider";
import { detectTransitions, transitionText, type StatusSnapshot, type TrackedSource } from "@/app/lib/experience/workspace/transitions";

/**
 * Raises one notice per background stage change in `items` (design Decision 6). The first list only sets the
 * baseline. While `suppress` is true the baseline still moves but nothing is raised, so a page never announces a
 * change it caused itself. `linkToFile` adds an Open action; the file's own page leaves it out.
 */
export function useStageTransitions(
  items: readonly TrackedSource[] | null,
  notice: Notice,
  { suppress = false, linkToFile = true }: { suppress?: boolean; linkToFile?: boolean } = {},
) {
  const seen = useRef<StatusSnapshot | null>(null);

  useEffect(() => {
    if (!items) return;
    const first = seen.current === null;
    const { events, snapshot } = detectTransitions(seen.current ?? new Map(), items);
    seen.current = snapshot;
    if (first || suppress) return;
    for (const event of events) {
      notice.info(transitionText(event), linkToFile ? { action: { label: "Open", href: `/experience/${event.id}` } } : undefined);
    }
  }, [items, notice, suppress, linkToFile]);
}
