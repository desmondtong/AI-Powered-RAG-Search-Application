"use client";
import Link from "next/link";
import { useState } from "react";
import type { JdFitAssessment, JdFitResponse } from "@/app/lib/jdFit/contracts";
import {
  FIT_LABEL_DISPLAY,
  JD_FIT_ENDPOINT,
  buildJdFitRequestBody,
  countByFit,
  interpretJdFitResponse,
  networkErrorState,
  type JdFitViewState,
} from "@/app/lib/jdFit/ui";

const card = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg p-6 shadow-sm mb-6";

export default function JdFitPanel() {
  const [jdText, setJdText] = useState("");
  const [view, setView] = useState<JdFitViewState>({ kind: "idle" });
  const loading = view.kind === "loading";

  const evaluate = async () => {
    if (!jdText.trim() || loading) return;
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
      setView(interpretJdFitResponse(res.status, body));
    } catch {
      setView(networkErrorState());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      evaluate();
    }
  };

  return (
    <div>
      <div className={card}>
        <label htmlFor="jd-text" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Job description
        </label>
        <textarea
          id="jd-text"
          className="w-full p-4 border border-gray-300 dark:border-gray-700 rounded-lg shadow-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-y focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Paste a job description to compare against your approved experience..."
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={8}
        />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            onClick={evaluate}
            className="bg-blue-600 text-white px-8 py-3 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
            disabled={loading || !jdText.trim()}
          >
            {loading ? "Evaluating..." : "Evaluate fit"}
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {jdText.length.toLocaleString("en-US")} characters · Uses all indexed experience · Cmd/Ctrl + Enter
          </span>
        </div>
      </div>

      <div aria-live="polite">
        {loading && (
          <div className={card}>
            <p className="text-gray-700 dark:text-gray-300">
              Reading requirements, searching your approved experience, and writing the report. This can take up to a minute.
            </p>
          </div>
        )}

        {view.kind === "error" && (
          <div role="alert" className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-6 mb-6">
            <h2 className="font-semibold text-red-800 dark:text-red-300 mb-1">Evaluation failed</h2>
            <p className="text-red-800 dark:text-red-200">{view.message}</p>
            {view.retryable && (
              <button
                onClick={evaluate}
                className="mt-4 bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 font-medium"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {view.kind === "report" && <JdFitReport report={view.report} />}
      </div>
    </div>
  );
}

function FitBadge({ fit }: { fit: JdFitAssessment["fit"] }) {
  const display = FIT_LABEL_DISPLAY[fit];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${display.className}`}>{display.text}</span>;
}

function JdFitReport({ report }: { report: JdFitResponse }) {
  const counts = countByFit(report);
  const requirementById = new Map(report.requirements.map((requirement) => [requirement.requirement_id, requirement]));

  return (
    <div>
      {report.status === "no_evidence" && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg p-6 mb-6">
          <h2 className="font-semibold text-amber-900 dark:text-amber-200 mb-1">No approved evidence available</h2>
          <p className="text-amber-900 dark:text-amber-100">
            None of your indexed experience matched, or nothing is indexed yet. Upload, approve, and index experience on the{" "}
            <Link href="/documents" className="underline">
              Documents page
            </Link>
            .
          </p>
        </div>
      )}

      <div className={card}>
        <h2 className="text-xl font-semibold mb-3">Fit by requirement</h2>
        <ul className="flex flex-wrap gap-2 mb-6" aria-label="Requirement counts by fit">
          {(Object.keys(counts) as Array<keyof typeof counts>).map((fit) => (
            <li key={fit} className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
              <FitBadge fit={fit} /> {counts[fit]}
            </li>
          ))}
        </ul>

        <ol className="space-y-4">
          {report.assessments.map((assessment) => {
            const requirement = requirementById.get(assessment.requirement_id)!;
            return (
              <li key={assessment.requirement_id} className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <FitBadge fit={assessment.fit} />
                  <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{requirement.importance}</span>
                </div>
                <p className="font-medium text-gray-900 dark:text-gray-100">{requirement.text}</p>
                <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{assessment.rationale}</p>
                {assessment.downgraded && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Adjusted: a claim without valid evidence was removed.</p>
                )}
                {assessment.citations.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {assessment.citations.map((citation) => (
                      <figure key={citation.evidence_handle} className="border-l-4 border-blue-300 dark:border-blue-700 pl-3">
                        <blockquote className="text-sm text-gray-800 dark:text-gray-200">{citation.quote}</blockquote>
                        <figcaption className="text-xs text-gray-500 dark:text-gray-400">
                          {citation.evidence_handle} · {citation.source_file_name || "Experience file"}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {report.gaps.length > 0 && (
        <div className={card}>
          <h2 className="text-xl font-semibold mb-3">Gaps ({report.gaps.length})</h2>
          <ul className="space-y-2">
            {report.gaps.map((gap) => (
              <li key={gap.requirement_id} className="flex flex-wrap items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
                <FitBadge fit={gap.fit} /> {gap.text}
                <span className="text-xs text-gray-500 dark:text-gray-400">({gap.importance})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className={card}>
        <summary className="cursor-pointer font-medium">Diagnostics</summary>
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-700 dark:text-gray-300">
          <dt>Model</dt>
          <dd>{report.diagnostics.model}</dd>
          <dt>Prompt versions</dt>
          <dd>
            {report.diagnostics.requirement_prompt_version}, {report.diagnostics.report_prompt_version}
          </dd>
          <dt>Validation version</dt>
          <dd>{report.diagnostics.validation_version}</dd>
          <dt>Requirements</dt>
          <dd>{report.diagnostics.requirement_count}</dd>
          <dt>Evidence retrieved / used</dt>
          <dd>
            {report.diagnostics.retrieval.retrieved_count} / {report.diagnostics.retrieval.context_evidence_count}
          </dd>
          <dt>Context trimmed</dt>
          <dd>
            {report.diagnostics.retrieval.context_truncated ? `yes (${report.diagnostics.retrieval.trimmed_evidence_count})` : "no"}
          </dd>
          <dt>Claims adjusted</dt>
          <dd>{report.diagnostics.validation.downgraded_claim_count}</dd>
        </dl>
      </details>
    </div>
  );
}
