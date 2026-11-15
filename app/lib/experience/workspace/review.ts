import { orderedBlocks } from "./gate";
import type { HighlightRange } from "./selection";
import type { CanonicalRevision, DraftFieldError, SourceBlock, SourceSpan } from "./types";

/** Stable key for one span of one evidence item, used for highlights, scroll targets and emphasis. */
export function evidenceSpanKey(experienceIndex: number, evidenceIndex: number, spanIndex: number) {
  return `ev:${experienceIndex}:${evidenceIndex}:${spanIndex}`;
}

/** Every evidence span of the draft grouped by block, so the document pane can mark each one. */
export function evidenceHighlights(draft: CanonicalRevision | null): Map<string, HighlightRange[]> {
  const byBlock = new Map<string, HighlightRange[]>();
  draft?.experiences.forEach((experience, experienceIndex) => {
    experience.evidence_items.forEach((item, evidenceIndex) => {
      item.source_refs.forEach((span, spanIndex) => {
        const list = byBlock.get(span.block_id) ?? [];
        list.push({ key: evidenceSpanKey(experienceIndex, evidenceIndex, spanIndex), start: span.start, end: span.end });
        byBlock.set(span.block_id, list);
      });
    });
  });
  return byBlock;
}

/** 1-based position of each block in document order ("block N", "bN"). */
export function blockNumbers(blocks: readonly SourceBlock[]): Map<string, number> {
  return new Map(orderedBlocks(blocks).map((block, index) => [block.block_id, index + 1]));
}

/** The block number of the first span, for "from source, block N" captions, or null when nothing is referenced. */
export function firstBlockNumber(spans: readonly SourceSpan[], numbers: ReadonlyMap<string, number>): number | null {
  for (const span of spans) {
    const number = numbers.get(span.block_id);
    if (number !== undefined) return number;
  }
  return null;
}

export interface EvidenceTarget {
  experienceIndex: number;
  evidenceIndex: number;
  /** "Experience title · kind · (no span)" */
  label: string;
  hasSpan: boolean;
}

/** Evidence items the span popover can attach to, with items lacking a span first, each group in draft order. */
export function evidenceTargets(draft: CanonicalRevision | null, noSpanLabel = "(no span)"): EvidenceTarget[] {
  if (!draft) return [];
  const targets: EvidenceTarget[] = [];
  draft.experiences.forEach((experience, experienceIndex) => {
    const title = experience.title.value?.trim() || (experience.type === "general-experience" ? "General experience" : `Experience ${experienceIndex + 1}`);
    experience.evidence_items.forEach((item, evidenceIndex) => {
      const hasSpan = item.source_refs.length > 0;
      const summary = item.summary.trim();
      const parts = [title, item.kind, summary ? truncate(summary, 60) : null, hasSpan ? null : noSpanLabel].filter(Boolean);
      targets.push({ experienceIndex, evidenceIndex, label: parts.join(" · "), hasSpan });
    });
  });
  return [...targets.filter((target) => !target.hasSpan), ...targets.filter((target) => target.hasSpan)];
}

/** Server field errors that belong to one evidence item (`experiences.X.evidence_items.Y…`). */
export function evidenceErrors(errors: readonly DraftFieldError[], experienceIndex: number, evidenceIndex: number) {
  const prefix = `experiences.${experienceIndex}.evidence_items.${evidenceIndex}`;
  return errors.filter((error) => error.path === prefix || error.path.startsWith(`${prefix}.`));
}

/** Server field errors on an experience's own fields, excluding those of its evidence items. */
export function experienceErrors(errors: readonly DraftFieldError[], experienceIndex: number) {
  const prefix = `experiences.${experienceIndex}`;
  return errors.filter(
    (error) => (error.path === prefix || error.path.startsWith(`${prefix}.`)) && !error.path.startsWith(`${prefix}.evidence_items.`),
  );
}

/** A short excerpt of a span's text for span chips. */
export function spanExcerpt(blockText: string | undefined, span: SourceSpan, max = 48): string {
  if (blockText === undefined) return "";
  return truncate(blockText.slice(span.start, span.end).replace(/\s+/g, " ").trim(), max);
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
