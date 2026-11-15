import {
  ACTION_LABELS,
  FAILURE,
  STAGE_COPY,
  STAGE_NAMES,
  editApprovedLabel,
  formatTimestamp,
  type ActionId,
  type StageCopy,
  type StageName,
} from "./copy";
import { describeRevisions, draftLabel } from "./revisionLabels";
import type { SourceDetail, SourceSummary } from "./types";

export type StepState = "done" | "current" | "running" | "failed" | "upcoming" | "neutral";

export interface StepView {
  name: StageName;
  /** Shown instead of the name when the step needs more context, e.g. "Review (new draft)" or "Indexed". */
  label: string;
  state: StepState;
}

export type StageTone = "neutral" | "progress" | "attention" | "done" | "failed";

export interface StageAction {
  id: ActionId;
  label: string;
}

export interface StageView {
  steps: StepView[];
  label: string;
  /** One instruction or one fact, or "" when the state needs neither. Never an explanation. */
  helper: string;
  tone: StageTone;
  primary: StageAction | null;
  /** A visible secondary choice, used only where the spec offers one alongside the primary. */
  secondary: StageAction | null;
  overflow: StageAction[];
  /** Index of the step the stage label describes. */
  stepIndex: number | null;
  /** One dated fact for the meta line, such as "Indexed Nov 14, 2026, 11:22 AM", or null. */
  metaFact: string | null;
}

const FAILURE_STEP: Record<string, number> = { extracting: 1, parsing: 2, indexing: 5 };
const FAILURE_RETRY: Record<string, ActionId> = { extracting: "retry-extract", parsing: "retry-parse", indexing: "retry-index" };
const RECOVERABLE_RETRY: Record<string, ActionId> = {
  "retry-extract": "retry-extract",
  "retry-parse": "retry-parse",
  "retry-index": "retry-index",
  "retry-delete": "retry-delete",
};

function action(id: ActionId, label: string = ACTION_LABELS[id]): StageAction {
  return { id, label };
}

function steps(states: StepState[], labels: Partial<Record<number, string>> = {}): StepView[] {
  return STAGE_NAMES.map((name, index) => ({ name, label: labels[index] ?? name, state: states[index] ?? "upcoming" }));
}

function doneThrough(lastDone: number, next: StepState = "upcoming"): StepState[] {
  return STAGE_NAMES.map((_, index) => (index <= lastDone ? "done" : index === lastDone + 1 ? next : "upcoming"));
}

function has(source: SourceSummary, apiAction: string) {
  return Array.isArray(source.actions) && source.actions.includes(apiAction);
}

function helperOf(copy: StageCopy) {
  return copy.instruction ?? copy.fact ?? "";
}

function dated(prefix: string, value: string | null | undefined) {
  const time = formatTimestamp(value);
  return time ? `${prefix} ${time}` : null;
}

function draftCounts(detail: SourceDetail | null | undefined) {
  const draft = detail?.latest_revision?.draft_json?.canonical_revision;
  if (!draft) return null;
  const experiences = draft.experiences.length;
  const evidence = draft.experiences.reduce((total, experience) => total + experience.evidence_items.length, 0);
  const warnings = (detail?.latest_extraction?.warnings ?? detail?.latest_revision?.draft_json?.source_warnings ?? []).length;
  const unassigned = detail?.latest_revision?.draft_json?.omitted_block_coverage?.unreferencedBlocks.length ?? 0;
  return { experiences, evidence, warnings, unassigned, draftVersion: draft.revision.draft_version };
}

/** Whether "Edit" (a new draft from the latest approved revision) applies: an approved revision and no open draft. */
export function canEditApproved(source: SourceSummary, detail?: SourceDetail | null) {
  if (!source.latest_approved_revision_id) return false;
  if (detail?.latest_revision?.status === "draft") return false;
  return ["approved", "indexed"].includes(source.status) || (source.status === "failed" && source.failure?.stage === "indexing");
}

/** Whether an accepted revision exists to export and inspect. */
export function canInspectJson(source: SourceSummary) {
  return Boolean(source.latest_approved_revision_id ?? source.active_revision_id);
}

function commonOverflow(source: SourceSummary, detail: SourceDetail | null | undefined, extra: StageAction[] = []): StageAction[] {
  const items: StageAction[] = [...extra];
  if (canEditApproved(source, detail)) {
    const labels = describeRevisions(source, detail);
    items.push(action("edit-approved", editApprovedLabel((labels.latestApproved?.versionNumber ?? 0) + 1)));
  }
  if (["draft", "indexed"].includes(source.status) && has(source, "parse")) {
    items.push(action("reparse"));
  }
  items.push(action("download-original"));
  if (canInspectJson(source)) items.push(action("inspect-json"));
  items.push(action("delete"));
  return items;
}

/**
 * Maps API state to what the workspace shows: six step states, one label, at most one helper sentence, at most one
 * primary action and an overflow list. Only actions the API allows (`actions`, `failure.recoverable_action`) or the
 * existing approved, cleanup and export conditions are offered.
 *
 * Passing `detail` means the file page is asking. Without it the caller is a list row, which carries no helper for
 * running or finished work and keeps dated facts on its meta line (design Decision 2).
 */
export function toStageView(source: SourceSummary, detail?: SourceDetail | null): StageView {
  const onPage = Boolean(detail);
  const labels = describeRevisions(source, detail);
  const counts = draftCounts(detail);

  switch (source.status) {
    case "uploaded": {
      const copy = STAGE_COPY.uploaded;
      return {
        steps: steps(doneThrough(0)),
        label: copy.label,
        helper: helperOf(copy),
        tone: "attention",
        primary: has(source, "extract") ? action("continue-processing") : null,
        secondary: null,
        overflow: commonOverflow(source, detail),
        stepIndex: 1,
        metaFact: dated("Uploaded", source.created_at),
      };
    }
    case "extracting":
    case "parsing": {
      const extracting = source.status === "extracting";
      const copy = extracting ? STAGE_COPY.extracting : STAGE_COPY.parsing;
      return {
        steps: steps(extracting ? doneThrough(0, "running") : doneThrough(1, "running")),
        label: copy.label,
        helper: onPage ? helperOf(copy) : "",
        tone: "progress",
        primary: null,
        secondary: null,
        overflow: [action("download-original")],
        stepIndex: extracting ? 1 : 2,
        metaFact: null,
      };
    }
    case "extracted": {
      const copy = STAGE_COPY.extracted;
      return {
        steps: steps(doneThrough(1)),
        label: copy.label,
        helper: helperOf(copy),
        tone: "attention",
        primary: has(source, "parse") ? action("continue-processing") : null,
        secondary: null,
        overflow: commonOverflow(source, detail),
        stepIndex: 2,
        metaFact: null,
      };
    }
    case "draft": {
      const review = has(source, "review");
      if (source.active_revision_id && labels.searchable) {
        const copy = STAGE_COPY.indexedWithDraft(labels.searchable.versionNumber);
        return {
          steps: steps(doneThrough(2, "current"), { 3: "Review (new draft)" }),
          label: copy.label,
          helper: helperOf(copy),
          tone: "attention",
          primary: review ? action("continue-review") : null,
          secondary: null,
          overflow: commonOverflow(source, detail),
          stepIndex: 3,
          metaFact: null,
        };
      }
      const started = (counts?.draftVersion ?? 1) > 1;
      const name = draftLabel(labels.latestApproved?.versionNumber);
      const copy = started ? STAGE_COPY.draftStarted(name) : STAGE_COPY.draftNew(name, counts);
      return {
        steps: steps(doneThrough(2, "current")),
        label: copy.label,
        helper: helperOf(copy),
        tone: "attention",
        primary: review ? action(started ? "continue-review" : "start-review") : null,
        secondary: null,
        overflow: commonOverflow(source, detail),
        stepIndex: 3,
        metaFact: null,
      };
    }
    case "approved": {
      const copy = STAGE_COPY.approved(labels.latestApproved?.versionNumber ?? 1);
      return {
        steps: steps(doneThrough(4, "current")),
        label: copy.label,
        helper: helperOf(copy),
        tone: "attention",
        primary: has(source, "index") ? action("index-now") : null,
        secondary: null,
        overflow: commonOverflow(source, detail),
        stepIndex: 5,
        metaFact: labels.latestApproved?.approvedAt ? `Approved ${labels.latestApproved.approvedAt}` : dated("Approved", source.updated_at),
      };
    }
    case "indexing": {
      const copy = STAGE_COPY.indexing(labels.latestApproved?.versionNumber ?? null);
      return {
        steps: steps(doneThrough(4, "running")),
        label: copy.label,
        helper: helperOf(copy),
        tone: "progress",
        primary: has(source, "index") ? action("continue-indexing") : null,
        secondary: null,
        overflow: [action("download-original"), ...(canInspectJson(source) ? [action("inspect-json")] : [])],
        stepIndex: 5,
        metaFact: null,
      };
    }
    case "indexed": {
      const version = labels.searchable?.versionNumber ?? labels.latestApproved?.versionNumber ?? 1;
      const since = formatTimestamp(source.updated_at) || "indexing finished";
      const copy = STAGE_COPY.indexed(version, onPage && counts ? { experiences: counts.experiences, evidence: counts.evidence, since } : null);
      return {
        steps: steps(doneThrough(5), { 5: "Indexed" }),
        label: copy.label,
        helper: helperOf(copy),
        tone: "done",
        primary: action("try-jd"),
        secondary: null,
        overflow: commonOverflow(source, detail),
        stepIndex: null,
        metaFact: onPage
          ? labels.latestApproved?.approvedAt
            ? `Approved ${labels.latestApproved.approvedAt}`
            : null
          : dated("Indexed", source.updated_at),
      };
    }
    case "failed": {
      const stage = source.failure?.stage ?? "";
      const stepIndex = FAILURE_STEP[stage];
      const stepStates: StepState[] =
        stepIndex === undefined
          ? doneThrough(0)
          : STAGE_NAMES.map((_, index) => (index < stepIndex ? "done" : index === stepIndex ? "failed" : "upcoming"));
      const recoverable = source.failure?.recoverable_action;
      const retryId = (recoverable && RECOVERABLE_RETRY[recoverable]) || (has(source, "retry") ? FAILURE_RETRY[stage] : undefined);
      const copy = STAGE_COPY.failed(stepIndex === undefined ? "This stage" : STAGE_NAMES[stepIndex]);
      return {
        steps: steps(stepStates),
        label: copy.label,
        helper: source.failure?.message || FAILURE.fallback,
        tone: "failed",
        primary: retryId ? action(retryId) : null,
        secondary: retryId === "retry-extract" ? action("upload-different") : null,
        overflow: commonOverflow(source, detail),
        stepIndex: stepIndex ?? null,
        metaFact: null,
      };
    }
    case "cleanup-pending": {
      const copy = STAGE_COPY.cleanupPending;
      return {
        steps: steps(STAGE_NAMES.map(() => "neutral")),
        label: copy.label,
        helper: source.cleanup_error?.message || helperOf(copy),
        tone: "attention",
        primary: has(source, "retry") || source.cleanup_error?.recoverable_action === "retry-delete" ? action("retry-delete") : null,
        secondary: null,
        overflow: [],
        stepIndex: null,
        metaFact: null,
      };
    }
    default: {
      const copy = STAGE_COPY.unavailable;
      return {
        steps: steps(STAGE_NAMES.map(() => "neutral")),
        label: copy.label,
        helper: helperOf(copy),
        tone: "neutral",
        primary: null,
        secondary: null,
        overflow: [],
        stepIndex: null,
        metaFact: null,
      };
    }
  }
}
