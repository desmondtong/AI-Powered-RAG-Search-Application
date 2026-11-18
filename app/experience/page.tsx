"use client";

import Link from "next/link";
import { useNotice } from "@/app/components/NoticeProvider";
import { useWorkspaceSummary } from "@/app/components/WorkspaceSummaryProvider";
import { EXPERIENCE_PAGE } from "@/app/lib/experience/workspace/copy";
import DropZone from "./_components/DropZone";
import ExperienceRow from "./_components/ExperienceRow";
import { IN_PROGRESS_STATUSES, usePolling } from "./_components/usePolling";
import { useStageTransitions } from "./_components/useStageTransitions";
import { Button } from "./_components/ui";

export default function ExperienceListPage() {
  const { sources, status, error, refresh } = useWorkspaceSummary();
  const working = sources.some((source) => IN_PROGRESS_STATUSES.has(source.status));
  usePolling(working, refresh);
  // A file that finishes processing or indexing while the list polls gets one notice with a link to it.
  const notice = useNotice();
  useStageTransitions(status === "ready" ? sources : null, notice);

  return (
    <main className="mx-auto w-full max-w-[1040px] px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="font-heading text-headline-xl text-ink">{EXPERIENCE_PAGE.title}</h1>
      </header>

      <DropZone />

      <section aria-label="Experience files" aria-busy={status === "loading"} className="mt-6">
        {status === "loading" && sources.length === 0 ? (
          <p className="rounded-panel border border-hairline bg-card p-6 text-body-md text-ink-secondary">Loading your files…</p>
        ) : status === "error" && sources.length === 0 ? (
          <div role="alert" className="rounded-panel border border-red-border bg-red-wash p-5">
            <p className="text-body-md text-ink">
              {EXPERIENCE_PAGE.loadError} {error}
            </p>
            <Button className="mt-3" onClick={() => void refresh()}>
              Try again
            </Button>
          </div>
        ) : sources.length === 0 ? (
          <p className="rounded-panel border border-hairline bg-card p-6 text-body-md text-ink-secondary">{EXPERIENCE_PAGE.empty}</p>
        ) : (
          <ul className="space-y-3">
            {sources.map((source) => (
              <ExperienceRow key={source.id} source={source} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>

      {/* The six-stage explanation lives on the Help page; the list only links to it. */}
      <p className="mt-8 text-body-md">
        <Link href="/help#experience" className="font-semibold text-cobalt hover:text-cobalt-hover hover:underline">
          {EXPERIENCE_PAGE.howItWorks}
        </Link>
      </p>
    </main>
  );
}
