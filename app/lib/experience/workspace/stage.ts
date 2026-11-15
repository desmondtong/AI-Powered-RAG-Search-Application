import {
  ACTION_LABELS,
  DELETE_CONFIRM,
  FAILURE,
  INDEXING,
  PROCESSING,
  STAGE_NAMES,
  approvedCopy,
  editApprovedLabel,
  formatTimestamp,
  indexedCopy,
  indexedWithDraftCopy,
  parsedSummary,
  reviewGuidance,
  type ActionId,
  type StageName,
} from "./copy";
import { describeRevisions, draftLabel, versionLabel } from "./revisionLabels";
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
  helper: string;
  tone: StageTone;
  primary: StageAction | null;
  /** A visible secondary choice, used only where the spec offers one alongside the primary. */
  secondary: StageAction | null;
  overflow: StageAction[];
  /** Index of the step the stage label describes, for "Step N of 6". */
  stepIndex: number | null;
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
 * Maps API state to what the workspace shows: six step states, one label, one helper sentence, at most one primary
 * action and an overflow list. Only actions the API allows (`actions`, `failure.recoverable_action`) or the existing
 * approved, cleanup and export conditions are offered.
 */
export function toStageView(source: SourceSummary, detail?: SourceDetail | null): StageView {
  const labels = describeRevisions(source, detail);
  const counts = draftCounts(detail);

  switch (source.status) {
    case "uploaded":
      return {
        steps: steps(doneThrough(0)),
        label: "Uploaded · not processed yet",
        helper: "The text hasn't been read yet. Continue processing to extract it and find your projects.",
        tone: "attention",
        primary: has(source, "extract") ? action("continue-processing") : null,
        secondary: null,
        overflow: commonOverflow(source, detail),
        stepIndex: 1,
      };
    case "extracting":
      return {
        steps: steps(doneThrough(0, "running")),
        label: "Extracting text",
        helper: `${PROCESSING.extracting}. ${PROCESSING.leave}`,
        tone: "progress",
        primary: null,
        secondary: null,
        overflow: [action("download-original")],
        stepIndex: 1,
      };
    case "extracted":
      return {
        steps: steps(doneThrough(1)),
        label: "Text extracted · not parsed yet",
        helper: "The text is frozen as the source of every citation. Continue processing to find the projects and evidence in it.",
        tone: "attention",
        primary: has(source, "parse") ? action("continue-processing") : null,
        secondary: null,
        overflow: commonOverflow(source, detail),
        stepIndex: 2,
      };
    case "parsing":
      return {
        steps: steps(doneThrough(1, "running")),
        label: "Finding projects and evidence",
        helper: `${PROCESSING.parsing}. ${PROCESSING.leave}`,
        tone: "progress",
        primary: null,
        secondary: null,
        overflow: [action("download-original")],
        stepIndex: 2,
      };
    case "draft": {
      const review = has(source, "review");
      if (source.active_revision_id && labels.searchable) {
        const copy = indexedWithDraftCopy(labels.searchable.versionNumber);
        return {
          steps: steps(doneThrough(2, "current"), { 3: "Review (new draft)" }),
          label: copy.label,
          helper: copy.helper,
          tone: "attention",
          primary: review ? action("continue-review") : null,
          secondary: null,
          overflow: commonOverflow(source, detail),
          stepIndex: 3,
        };
      }
      const started = (counts?.draftVersion ?? 1) > 1;
      return {
        steps: steps(doneThrough(2, "current")),
        label: `${draftLabel(labels.latestApproved?.versionNumber)} · ready for review`,
        helper: counts
          ? started
            ? reviewGuidance(counts.experiences)
            : parsedSummary(counts.experiences, counts.evidence, counts.warnings, counts.unassigned)
          : "Projects and evidence were found. Check them against the source, then approve. Nothing is searchable until you approve.",
        tone: "attention",
        primary: review ? action(started ? "continue-review" : "start-review") : null,
        secondary: null,
        overflow: commonOverflow(source, detail),
        stepIndex: 3,
      };
    }
    case "approved": {
      const version = labels.latestApproved?.versionNumber ?? 1;
      const copy = approvedCopy(version);
      return {
        steps: steps(doneThrough(4, "current")),
        label: copy.status,
        helper: copy.body,
        tone: "attention",
        primary: has(source, "index") ? action("index-now") : null,
        secondary: null,
        overflow: commonOverflow(source, detail),
        stepIndex: 5,
      };
    }
    case "indexing": {
      const version = labels.latestApproved?.versionNumber;
      return {
        steps: steps(doneThrough(4, "running")),
        label: version ? `Indexing ${versionLabel(version).toLowerCase()}` : "Indexing",
        helper: `${INDEXING.interrupted} ${INDEXING.keepOpen}`,
        tone: "progress",
        primary: has(source, "index") ? action("continue-indexing") : null,
        secondary: null,
        overflow: [action("download-original"), ...(canInspectJson(source) ? [action("inspect-json")] : [])],
        stepIndex: 5,
      };
    }
    case "indexed": {
      const version = labels.searchable?.versionNumber ?? labels.latestApproved?.versionNumber ?? 1;
      const copy = indexedCopy(
        formatTimestamp(source.updated_at) || "indexing finished",
        version,
        counts?.experiences ?? 0,
        counts?.evidence ?? 0,
      );
      return {
        steps: steps(doneThrough(5), { 5: "Indexed" }),
        label: `Indexed · ${versionLabel(version).toLowerCase()}`,
        helper: counts ? `${copy.body} ${copy.detail}` : `Searchable in Fit Check · ${versionLabel(version).toLowerCase()}. ${copy.detail}`,
        tone: "done",
        primary: action("try-jd"),
        secondary: null,
        overflow: commonOverflow(source, detail),
        stepIndex: null,
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
      const stageName = stepIndex === undefined ? "This stage" : STAGE_NAMES[stepIndex];
      return {
        steps: steps(stepStates),
        label: FAILURE.title(stageName),
        helper: source.failure?.message || FAILURE.fallback,
        tone: "failed",
        primary: retryId ? action(retryId) : null,
        secondary: retryId === "retry-extract" ? action("upload-different") : null,
        overflow: commonOverflow(source, detail),
        stepIndex: stepIndex ?? null,
      };
    }
    case "cleanup-pending":
      return {
        steps: steps(STAGE_NAMES.map(() => "neutral")),
        label: "Deleted · cleanup pending",
        helper: source.cleanup_error?.message ? `${DELETE_CONFIRM.cleanupPending} ${source.cleanup_error.message}` : DELETE_CONFIRM.cleanupPending,
        tone: "attention",
        primary: has(source, "retry") || source.cleanup_error?.recoverable_action === "retry-delete" ? action("retry-delete") : null,
        secondary: null,
        overflow: [],
        stepIndex: null,
      };
    default:
      return {
        steps: steps(STAGE_NAMES.map(() => "neutral")),
        label: "Unavailable",
        helper: "This file can't be worked on right now.",
        tone: "neutral",
        primary: null,
        secondary: null,
        overflow: [],
        stepIndex: null,
      };
  }
}

/** Plain-language "Step 4 of 6 · Review" line for a stage view, or null when no single step applies. */
export function stepLine(view: StageView): string | null {
  if (view.stepIndex === null) return null;
  return `Step ${view.stepIndex + 1} of 6 · ${STAGE_NAMES[view.stepIndex]}`;
}
