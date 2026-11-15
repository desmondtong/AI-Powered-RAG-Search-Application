import { CheckIcon, CloseIcon } from "@/app/components/icons";
import type { StepState, StepView } from "@/app/lib/experience/workspace/stage";
import { Hint } from "./ui";

const STATE_TEXT: Record<StepState, string> = {
  done: "done",
  current: "current",
  running: "in progress",
  failed: "failed",
  upcoming: "not started",
  neutral: "not applicable",
};

const DOT: Record<StepState, string> = {
  done: "bg-green",
  current: "bg-cobalt ring-2 ring-evidence-border ring-offset-2 ring-offset-card",
  running: "bg-cobalt animate-pulse",
  failed: "bg-red",
  upcoming: "bg-hairline",
  neutral: "bg-hairline",
};

/** Compact six-dot stepper for list rows. The step names and states are available to screen readers. */
export function DotStepper({ steps }: { steps: StepView[] }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Pipeline stages">
      {steps.map((step) => (
        <li key={step.name} className="flex items-center">
          <Hint label={`${step.label}: ${STATE_TEXT[step.state]}`}>
            <span aria-hidden className={`block size-2.5 rounded-full ${DOT[step.state]}`} />
          </Hint>
          <span className="sr-only">
            {step.label}: {STATE_TEXT[step.state]}
          </span>
        </li>
      ))}
    </ol>
  );
}

const PILL: Record<StepState, string> = {
  done: "border-green-border bg-green-wash text-green",
  current: "border-cobalt bg-evidence-wash text-evidence-text",
  running: "border-cobalt bg-evidence-wash text-evidence-text",
  failed: "border-red-border bg-red-wash text-red",
  upcoming: "border-hairline bg-card text-ink-muted",
  neutral: "border-hairline bg-subtle text-ink-muted",
};

/** Labelled stepper pills for the file-page header. */
export function PillStepper({ steps }: { steps: StepView[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Pipeline stages">
      {steps.map((step, index) => (
        <li
          key={step.name}
          aria-current={step.state === "current" || step.state === "running" ? "step" : undefined}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label-md ${PILL[step.state]}`}
        >
          {step.state === "done" ? (
            <CheckIcon size={12} />
          ) : step.state === "failed" ? (
            <CloseIcon size={12} />
          ) : step.state === "running" ? (
            <span aria-hidden className="size-2 animate-pulse rounded-full bg-cobalt" />
          ) : (
            <span aria-hidden className="tabular-nums">
              {index + 1}
            </span>
          )}
          {step.label}
          <span className="sr-only">: {STATE_TEXT[step.state]}</span>
        </li>
      ))}
    </ol>
  );
}
