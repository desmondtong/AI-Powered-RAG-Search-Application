"use client";

import { useRef, useState } from "react";
import { BoltIcon, ErrorIcon, UploadIcon } from "@/app/components/icons";
import { useWorkspaceSummary } from "@/app/components/WorkspaceSummaryProvider";
import { ButtonLink, Button } from "@/app/experience/_components/ui";
import { FIT_CHECK, STAGE_LEGEND } from "@/app/lib/experience/workspace/copy";
import { JD_FIT_ENDPOINT, buildJdFitRequestBody, interpretJdFitResponse, networkErrorState, type JdFitViewState } from "@/app/lib/jdFit/ui";
import FitReport from "./FitReport";

/** Shown, with the input disabled, only when the source list loaded and no file is indexed. */
function FitEmptyState() {
  return (
    <section aria-labelledby="fit-empty-title" className="rounded-panel border border-hairline bg-card p-6">
      <span aria-hidden className="grid size-11 place-items-center rounded-panel bg-evidence-wash text-cobalt">
        <UploadIcon size={22} />
      </span>
      <h2 id="fit-empty-title" className="mt-3 font-heading text-headline-md text-ink">
        {FIT_CHECK.emptyTitle}
      </h2>
      <p className="mt-1 max-w-2xl text-body-md text-ink-secondary">{FIT_CHECK.emptyBody}</p>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {STAGE_LEGEND.map((stage, index) => (
          <li key={stage.name} className="text-body-sm text-ink-secondary">
            <span className="font-semibold text-ink">
              {index + 1} · {stage.name}.
            </span>{" "}
            {stage.description}
          </li>
        ))}
      </ol>
      <ButtonLink href="/experience" variant="primary" className="mt-5">
        <UploadIcon size={16} />
        {FIT_CHECK.emptyAction}
      </ButtonLink>
    </section>
  );
}

/**
 * The JD card and every report state. It sends exactly one `POST /api/jd-fit` with `{ jdText }` per evaluation and
 * reads the indexed-file count from the shared workspace summary.
 */
export default function JdFitPanel() {
  const { indexedCount } = useWorkspaceSummary();
  const [jdText, setJdText] = useState("");
  const [view, setView] = useState<JdFitViewState>({ kind: "idle" });
  const [run, setRun] = useState<{ filesSearched: number | null; elapsedMs: number | null }>({ filesSearched: null, elapsedMs: null });
  const inFlight = useRef(false);
  const loading = view.kind === "loading";
  const empty = indexedCount === 0;

  const evaluate = async () => {
    if (!jdText.trim() || inFlight.current || empty) return;
    inFlight.current = true;
    const filesSearched = indexedCount;
    const started = performance.now();
    setView({ kind: "loading" });
    try {
      const res = await fetch(JD_FIT_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buildJdFitRequestBody(jdText),
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      setRun({ filesSearched, elapsedMs: performance.now() - started });
      setView(interpretJdFitResponse(res.status, body));
    } catch {
      setView(networkErrorState());
    } finally {
      inFlight.current = false;
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void evaluate();
    }
  };

  const scope =
    indexedCount === null ? "evaluates against all indexed files" : `evaluates against all ${indexedCount} indexed ${indexedCount === 1 ? "file" : "files"}`;

  return (
    <div className="space-y-6">
      {empty && <FitEmptyState />}

      <section aria-labelledby="jd-card-title" className="rounded-panel border border-hairline bg-card p-5">
        <label id="jd-card-title" htmlFor="jd-text" className="block font-heading text-title-sm text-ink">
          Job description
        </label>
        <textarea
          id="jd-text"
          className="mt-2 w-full resize-y rounded-control border border-hairline-strong bg-card p-3 text-body-lg text-ink placeholder:text-ink-muted focus:border-cobalt focus:outline-none disabled:bg-disabled-bg disabled:text-disabled-text"
          placeholder="Paste the full job description here…"
          value={jdText}
          onChange={(event) => setJdText(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={8}
          disabled={empty}
        />
        <div className="mt-3 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-body-sm text-ink-muted">
            {jdText.length.toLocaleString("en-US")} characters · {scope} · Cmd/Ctrl + Enter
          </span>
          <Button variant="primary" onClick={() => void evaluate()} disabled={empty || loading || !jdText.trim()}>
            <BoltIcon size={16} />
            {loading ? "Evaluating…" : "Evaluate fit"}
          </Button>
        </div>
      </section>

      <div aria-live="polite" className="space-y-6">
        {loading && (
          <p className="rounded-panel border border-hairline bg-card p-5 text-body-md text-ink-secondary">
            Reading requirements, searching your approved experience and writing the report. This can take up to a minute.
          </p>
        )}

        {view.kind === "error" && (
          <section role="alert" className="rounded-panel border border-red-border bg-red-wash p-5">
            <h2 className="flex items-center gap-2 font-heading text-title-sm text-ink">
              <ErrorIcon size={18} className="text-red" />
              Evaluation failed
            </h2>
            <p className="mt-1 text-body-md text-ink-secondary">{view.message}</p>
            {view.retryable && (
              <Button className="mt-3" onClick={() => void evaluate()}>
                Try again
              </Button>
            )}
          </section>
        )}

        {view.kind === "report" && <FitReport report={view.report} filesSearched={run.filesSearched} elapsedMs={run.elapsedMs} />}
      </div>
    </div>
  );
}
