import Link from "next/link";
import { ArrowIcon, LinkIcon, WarningIcon } from "@/app/components/icons";
import type { JdFitAssessment, JdFitCitation, JdFitRequirement, JdFitResponse } from "@/app/lib/jdFit/contracts";
import {
  FIT_GROUP_ORDER,
  FIT_LABEL_DISPLAY,
  citationCaption,
  citationHref,
  countByFit,
  groupAssessmentsByFit,
  reportHeaderLine,
} from "@/app/lib/jdFit/ui";
import { FIT_CHECK } from "@/app/lib/experience/workspace/copy";

export function FitBadge({ fit }: { fit: JdFitAssessment["fit"] }) {
  const display = FIT_LABEL_DISPLAY[fit];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-label-md ${display.className}`}>{display.text}</span>;
}

function ImportancePill({ importance }: { importance: JdFitRequirement["importance"] }) {
  return (
    <span className="inline-flex items-center rounded-full border border-hairline px-2 py-0.5 text-label-md text-ink-secondary">
      {importance === "required" ? "Required" : "Preferred"}
    </span>
  );
}

function Citation({ citation }: { citation: JdFitCitation }) {
  return (
    <figure className="rounded-control border border-evidence-border bg-evidence-wash p-3">
      <blockquote className="text-body-md whitespace-pre-wrap text-evidence-text">“{citation.quote}”</blockquote>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-body-sm text-ink-secondary">
        <span className="min-w-0 break-words">{citationCaption(citation)}</span>
        <Link href={citationHref(citation)} className="inline-flex shrink-0 items-center gap-1 font-semibold text-cobalt hover:underline">
          <LinkIcon size={14} />
          Open in source
        </Link>
      </figcaption>
    </figure>
  );
}

function RequirementCard({ assessment, requirement }: { assessment: JdFitAssessment; requirement: JdFitRequirement | undefined }) {
  return (
    <li className="rounded-panel border border-hairline bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <FitBadge fit={assessment.fit} />
        {requirement && <ImportancePill importance={requirement.importance} />}
      </div>
      <p className="mt-2 font-heading text-title-sm text-ink">{requirement?.text ?? assessment.requirement_id}</p>
      <p className="mt-1 text-body-md text-ink-secondary">{assessment.rationale}</p>
      {assessment.downgraded && (
        <p className="mt-2 flex items-start gap-1.5 text-body-sm text-amber-text">
          <WarningIcon size={14} className="mt-0.5 shrink-0" />
          Adjusted: a claim without valid evidence was removed.
        </p>
      )}
      {assessment.citations.length > 0 && (
        <div className="mt-3 space-y-2">
          {assessment.citations.map((citation) => (
            <Citation key={`${citation.evidence_handle}:${citation.source_span.block_id}:${citation.source_span.start}`} citation={citation} />
          ))}
        </div>
      )}
    </li>
  );
}

function GapsPanel({ report }: { report: JdFitResponse }) {
  if (report.gaps.length === 0) return null;
  return (
    <section aria-labelledby="gaps-title" className="rounded-panel border border-hairline bg-card p-5">
      <h2 id="gaps-title" className="font-heading text-headline-md text-ink">
        {FIT_CHECK.gapsTitle(report.gaps.length)}
      </h2>
      <p className="mt-1 text-body-md text-ink-secondary">{FIT_CHECK.gapsNote}</p>
      <ul className="mt-3 divide-y divide-hairline">
        {report.gaps.map((gap) => (
          <li key={gap.requirement_id} className="flex flex-wrap items-center gap-2 py-2 text-body-md text-ink">
            <FitBadge fit={gap.fit} />
            <ImportancePill importance={gap.importance} />
            <span className="min-w-0 flex-1 break-words">{gap.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Diagnostics({ report }: { report: JdFitResponse }) {
  const { diagnostics } = report;
  return (
    <details className="rounded-panel border border-hairline bg-card p-5">
      <summary className="cursor-pointer text-body-md font-semibold text-ink-secondary">{FIT_CHECK.diagnosticsSummary}</summary>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-body-sm text-ink-secondary sm:grid-cols-2">
        <dt className="text-ink-muted">Model</dt>
        <dd className="break-words">{diagnostics.model}</dd>
        <dt className="text-ink-muted">Prompt versions</dt>
        <dd className="break-words">
          {diagnostics.requirement_prompt_version}, {diagnostics.report_prompt_version}
        </dd>
        <dt className="text-ink-muted">Validation version</dt>
        <dd>{diagnostics.validation_version}</dd>
        <dt className="text-ink-muted">Requirements</dt>
        <dd>{diagnostics.requirement_count}</dd>
        <dt className="text-ink-muted">Evidence retrieved / used</dt>
        <dd>
          {diagnostics.retrieval.retrieved_count} / {diagnostics.retrieval.context_evidence_count}
        </dd>
        <dt className="text-ink-muted">Context trimmed</dt>
        <dd>{diagnostics.retrieval.context_truncated ? `yes (${diagnostics.retrieval.trimmed_evidence_count})` : "no"}</dd>
        <dt className="text-ink-muted">Claims adjusted</dt>
        <dd>{diagnostics.validation.downgraded_claim_count}</dd>
      </dl>
    </details>
  );
}

/** Header line, four count tiles, requirement cards grouped Strong → Missing, gaps and collapsed diagnostics. */
export default function FitReport({
  report,
  filesSearched,
  elapsedMs,
}: {
  report: JdFitResponse;
  filesSearched: number | null;
  elapsedMs: number | null;
}) {
  const counts = countByFit(report);
  const groups = groupAssessmentsByFit(report).filter((group) => group.items.length > 0);
  return (
    <div className="space-y-5">
      {report.status === "no_evidence" && (
        <section role="note" className="rounded-panel border border-amber-border bg-amber-wash p-5">
          <h2 className="font-heading text-title-sm text-ink">No approved evidence available</h2>
          <p className="mt-1 text-body-md text-ink-secondary">
            None of your indexed experience matched, or nothing is indexed yet. Upload, review, approve and index a file on the{" "}
            <Link href="/experience" className="font-semibold text-cobalt hover:underline">
              Experience page
            </Link>
            .
          </p>
        </section>
      )}

      <section aria-labelledby="report-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="report-title" className="font-heading text-headline-lg text-ink">
            Fit report
          </h2>
          <p className="text-body-sm text-ink-muted">{reportHeaderLine(report.requirements.length, filesSearched, elapsedMs)}</p>
        </div>
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Requirement counts by fit">
          {FIT_GROUP_ORDER.map((fit) => (
            <li key={fit} className={`rounded-panel border-t-4 bg-card p-4 shadow-raised ${FIT_LABEL_DISPLAY[fit].tileClassName}`}>
              <div className="font-heading text-headline-xl text-ink tabular-nums">{counts[fit]}</div>
              <div className="text-label-caps uppercase text-ink-muted">{FIT_LABEL_DISPLAY[fit].text}</div>
            </li>
          ))}
        </ul>
      </section>

      {groups.map((group) => (
        <section key={group.fit} aria-labelledby={`fit-group-${group.fit}`}>
          <h3 id={`fit-group-${group.fit}`} className="mb-2 flex items-center gap-2 text-label-caps uppercase text-ink-muted">
            <FitBadge fit={group.fit} /> {group.items.length}
          </h3>
          <ol className="space-y-3">
            {group.items.map(({ assessment, requirement }) => (
              <RequirementCard key={assessment.requirement_id} assessment={assessment} requirement={requirement} />
            ))}
          </ol>
        </section>
      ))}

      <GapsPanel report={report} />
      <Diagnostics report={report} />

      {report.status === "no_evidence" && (
        <Link href="/experience" className="inline-flex items-center gap-1 text-body-md font-semibold text-cobalt hover:underline">
          Go to Experience <ArrowIcon size={14} />
        </Link>
      )}
    </div>
  );
}
