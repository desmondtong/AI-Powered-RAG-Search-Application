import Link from "next/link";
import type { ReactNode } from "react";
import type { StageView } from "@/app/lib/experience/workspace/stage";
import { TONE_TEXT } from "../../_components/ExperienceRow";
import OverflowMenu, { type OverflowItem } from "../../_components/OverflowMenu";
import { PillStepper } from "../../_components/Stepper";

/**
 * One header for every stage: stepper pills, the stage label, one guidance sentence, one primary action and
 * everything else in the overflow menu.
 */
export default function StageHeader({
  fileName,
  meta,
  view,
  label,
  guidance,
  detail,
  primary,
  secondary,
  status,
  overflow,
}: {
  fileName: string;
  meta: string;
  view: StageView;
  label: string;
  guidance: string;
  detail?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  status?: ReactNode;
  overflow: OverflowItem[];
}) {
  return (
    <header className="rounded-panel border border-hairline bg-card p-4 sm:p-6">
      <nav aria-label="Breadcrumb" className="text-body-sm text-ink-muted">
        <Link href="/experience" className="hover:text-cobalt">
          Experience
        </Link>
        <span aria-hidden> / </span>
        <span className="text-ink-secondary">{fileName}</span>
      </nav>
      <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="break-words font-heading text-headline-lg text-ink">{fileName}</h1>
          <p className="text-body-sm text-ink-muted">{meta}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {status}
          {secondary}
          {primary}
          <OverflowMenu items={overflow} label={`More actions for ${fileName}`} />
        </div>
      </div>
      <div className="mt-4">
        <PillStepper steps={view.steps} />
      </div>
      <p className={`mt-4 text-title-sm font-semibold ${TONE_TEXT[view.tone]}`}>{label}</p>
      <p className="mt-1 max-w-3xl text-body-md text-ink-secondary">{guidance}</p>
      {detail}
    </header>
  );
}
