import { GATE } from "./copy";
import { nextVersionNumber } from "./revisionLabels";
import type { CanonicalRevision, DraftFieldError, ExperienceEntry, SourceBlock, SourceDetail, SourceSpan } from "./types";

/** Where a gate item can be fixed, so the gate can link to it. */
export type GateTarget =
  | { kind: "acknowledgement"; field: "warnings" | "unassigned_blocks" }
  | { kind: "evidence"; experienceIndex: number; evidenceIndex: number }
  | { kind: "experience"; experienceIndex: number }
  | { kind: "block"; blockId: string }
  | { kind: "reload" }
  | { kind: "none" };

export type GateItemKind = "ack-warnings" | "ack-unassigned" | "missing-spans" | "no-evidence" | "field-error";

export interface GateItem {
  kind: GateItemKind;
  key: string;
  label: string;
  done: boolean;
  /** Acknowledgement items are checkboxes the user ticks; the others are fixed elsewhere. */
  checkbox: boolean;
  target: GateTarget;
  /** Additional targets, e.g. every evidence item that lacks a span. */
  targets?: GateTarget[];
  /** A stale draft or approval version: the fix is to reload the current draft. */
  stale?: boolean;
  /** How many things this line stands for; a grouped "N evidence items" line counts N towards `remaining`. */
  count: number;
}

export type GateButtonState = "locked" | "save-and-approve" | "approve";

export interface ApprovalGate {
  items: GateItem[];
  remaining: number;
  button: { state: GateButtonState; label: string };
  footer: string;
  /** Block IDs no field of the current draft references, in document order. */
  unassignedBlockIds: string[];
}

const STALE_CODES = new Set([
  "draft-version-conflict",
  "draft-version-mismatch",
  "approval-version-conflict",
  "approval-candidate-stale",
  "draft-create-conflict",
]);

/** Server field errors the gate already represents with its own items. */
const COVERED_CODES = new Set(["warnings-unacknowledged", "unassigned-blocks-unacknowledged", "no-usable-evidence"]);

/** Blocks in document order with their 1-based "b" labels. */
export function orderedBlocks(blocks: readonly SourceBlock[]): SourceBlock[] {
  return [...blocks].sort((a, b) => a.order - b.order);
}

export function blockLabels(blocks: readonly SourceBlock[]): Map<string, string> {
  return new Map(orderedBlocks(blocks).map((block, index) => [block.block_id, `b${index + 1}`]));
}

/** Every span any field of an experience references, matching the server's coverage rule. */
export function experienceSpans(experience: ExperienceEntry): SourceSpan[] {
  return [
    ...experience.title.source_refs,
    ...experience.organization.source_refs,
    ...experience.role.source_refs,
    ...experience.period.start.source_refs,
    ...experience.period.end.source_refs,
    ...experience.technologies.source_refs,
    ...experience.context_refs,
    ...experience.evidence_items.flatMap((item) => item.source_refs),
  ];
}

/** Block IDs no field of the draft references, in document order (the server's `unreferencedBlocks`). */
export function unassignedBlocks(draft: CanonicalRevision, blocks: readonly SourceBlock[]): string[] {
  const referenced = new Set(draft.experiences.flatMap(experienceSpans).map((span) => span.block_id));
  return orderedBlocks(blocks)
    .map((block) => block.block_id)
    .filter((blockId) => !referenced.has(blockId));
}

/** Maps a server field path such as `experiences.0.evidence_items.2.summary` to the card it belongs to. */
export function targetForPath(path: string): GateTarget {
  const evidence = /^experiences\.(\d+)\.evidence_items\.(\d+)/.exec(path);
  if (evidence) return { kind: "evidence", experienceIndex: Number(evidence[1]), evidenceIndex: Number(evidence[2]) };
  const experience = /^experiences\.(\d+)/.exec(path);
  if (experience) return { kind: "experience", experienceIndex: Number(experience[1]) };
  if (path.startsWith("review_acknowledgements.warnings")) return { kind: "acknowledgement", field: "warnings" };
  if (path.startsWith("review_acknowledgements.unassigned_blocks")) return { kind: "acknowledgement", field: "unassigned_blocks" };
  return { kind: "none" };
}

export function isStaleVersionError(error: Pick<DraftFieldError, "code">) {
  return STALE_CODES.has(error.code);
}

/**
 * The single "Before you can approve" checklist: acknowledgements (only when relevant), evidence items without a
 * span, the no-usable-evidence condition and server errors from the last save or approval. Approve is enabled only
 * when nothing remains; with unsaved edits the button saves first ("Save & approve").
 */
export function buildApprovalGate(
  draft: CanonicalRevision,
  detail: Pick<SourceDetail, "latest_extraction" | "latest_revision" | "source"> | null,
  fieldErrors: readonly DraftFieldError[],
  dirty: boolean,
): ApprovalGate {
  const blocks = detail?.latest_extraction?.blocks ?? [];
  const labels = blockLabels(blocks);
  const warnings = detail?.latest_extraction?.warnings ?? detail?.latest_revision?.draft_json?.source_warnings ?? [];
  const unassigned = unassignedBlocks(draft, blocks);
  const items: GateItem[] = [];

  if (warnings.length > 0) {
    items.push({
      kind: "ack-warnings",
      key: "ack-warnings",
      label: GATE.warnings(warnings.length),
      done: draft.review_acknowledgements.warnings,
      checkbox: true,
      target: { kind: "acknowledgement", field: "warnings" },
      count: 1,
    });
  }

  if (unassigned.length > 0) {
    items.push({
      kind: "ack-unassigned",
      key: "ack-unassigned",
      label: GATE.unassigned(unassigned.length, unassigned.map((blockId) => labels.get(blockId) ?? blockId)),
      done: draft.review_acknowledgements.unassigned_blocks,
      checkbox: true,
      target: { kind: "acknowledgement", field: "unassigned_blocks" },
      targets: unassigned.map((blockId) => ({ kind: "block", blockId })),
      count: 1,
    });
  }

  const missing: GateTarget[] = [];
  let evidenceTotal = 0;
  draft.experiences.forEach((experience, experienceIndex) => {
    experience.evidence_items.forEach((item, evidenceIndex) => {
      evidenceTotal += 1;
      if (item.source_refs.length === 0) missing.push({ kind: "evidence", experienceIndex, evidenceIndex });
    });
  });
  if (missing.length > 0) {
    items.push({
      kind: "missing-spans",
      key: "missing-spans",
      label: GATE.missingSpans(missing.length),
      done: false,
      checkbox: false,
      target: missing[0],
      targets: missing,
      count: missing.length,
    });
  }

  if (evidenceTotal === 0) {
    items.push({ kind: "no-evidence", key: "no-evidence", label: GATE.nothingToIndex, done: false, checkbox: false, target: { kind: "none" }, count: 1 });
  }

  fieldErrors.forEach((error, index) => {
    if (COVERED_CODES.has(error.code)) return;
    const stale = isStaleVersionError(error);
    items.push({
      kind: "field-error",
      key: `field-error-${index}-${error.path}-${error.code}`,
      label: stale ? GATE.staleVersion : error.message,
      done: false,
      checkbox: false,
      target: stale ? { kind: "reload" } : targetForPath(error.path),
      stale,
      count: 1,
    });
  });

  const remaining = items.filter((item) => !item.done).reduce((total, item) => total + item.count, 0);
  const state: GateButtonState = remaining > 0 ? "locked" : dirty ? "save-and-approve" : "approve";
  const label = state === "locked" ? GATE.approveLocked(remaining) : state === "save-and-approve" ? GATE.saveAndApprove : GATE.approve;
  return {
    items,
    remaining,
    button: { state, label },
    footer: GATE.footer(nextVersionNumber(detail?.source.latest_approved_version_number)),
    unassignedBlockIds: unassigned,
  };
}
