import type { SourceSpan } from "./types";

/**
 * Span offsets are UTF-16 code units into `block.text`, exactly as `block.text.slice(start, end)` reads them.
 * DOM `Range.toString().length` counts the same units, so a selection maps to offsets without conversion as long as
 * the block's rendered text equals `block.text` (it is rendered with `white-space: pre-wrap` inside
 * `[data-block-text]`, with gutter labels and pills outside it).
 */

export type SpanFromSelection =
  | { ok: true; span: SourceSpan; text: string }
  | { ok: false; reason: "empty" | "outside" | "cross-block" | "mismatch" | "unknown-block" };

/**
 * Pure core: given the block's retained text, the length of the block text before the selection, and the selected
 * text, trims whitespace inward and returns offsets only if `blockText.slice(start, end)` equals the trimmed text.
 */
export function offsetsWithin(blockText: string, prefixLength: number, selectedText: string): { ok: true; start: number; end: number; text: string } | { ok: false; reason: "empty" | "mismatch" } {
  const leading = selectedText.length - selectedText.trimStart().length;
  const trimmed = selectedText.trim();
  if (!trimmed) return { ok: false, reason: "empty" };
  const start = prefixLength + leading;
  const end = start + trimmed.length;
  if (start < 0 || end > blockText.length || blockText.slice(start, end) !== trimmed) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true, start, end, text: trimmed };
}

function blockTextElement(node: Node | null, container: Element): HTMLElement | null {
  const element = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
  const block = element?.closest<HTMLElement>("[data-block-text]") ?? null;
  return block && container.contains(block) ? block : null;
}

/**
 * Maps a DOM range inside the document pane to a span. Selections outside source text, across blocks, or whose
 * offsets do not reproduce the selected characters of the retained text yield no span.
 */
export function rangeToSpan(container: Element, range: Range, blockTextFor: (blockId: string) => string | undefined): SpanFromSelection {
  if (range.collapsed) return { ok: false, reason: "empty" };
  const startBlock = blockTextElement(range.startContainer, container);
  const endBlock = blockTextElement(range.endContainer, container);
  if (!startBlock || !endBlock) {
    return startBlock || endBlock ? { ok: false, reason: "cross-block" } : { ok: false, reason: "outside" };
  }
  if (startBlock !== endBlock) return { ok: false, reason: "cross-block" };
  const blockId = startBlock.dataset.blockId ?? startBlock.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
  const blockText = blockId ? blockTextFor(blockId) : undefined;
  if (!blockId || blockText === undefined) return { ok: false, reason: "unknown-block" };

  const prefix = startBlock.ownerDocument.createRange();
  prefix.setStart(startBlock, 0);
  prefix.setEnd(range.startContainer, range.startOffset);
  const result = offsetsWithin(blockText, prefix.toString().length, range.toString());
  if (!result.ok) return result;
  return { ok: true, span: { block_id: blockId, start: result.start, end: result.end }, text: result.text };
}

export interface HighlightRange {
  key: string;
  start: number;
  end: number;
}

export interface TextSegment {
  start: number;
  end: number;
  text: string;
  /** Keys of every highlight covering this segment, outermost first. */
  keys: string[];
}

/**
 * Splits a block's text at every highlight boundary. The segments' text concatenates to exactly `text`, so the
 * rendered block keeps offsets intact. Ranges outside the text are clamped; empty ranges are ignored.
 */
export function segmentBlock(text: string, highlights: readonly HighlightRange[]): TextSegment[] {
  const valid = highlights
    .map((highlight) => ({ ...highlight, start: Math.max(0, highlight.start), end: Math.min(text.length, highlight.end) }))
    .filter((highlight) => highlight.end > highlight.start);
  const cuts = new Set<number>([0, text.length]);
  for (const highlight of valid) {
    cuts.add(highlight.start);
    cuts.add(highlight.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segments: TextSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (end <= start) continue;
    const keys = valid
      .filter((highlight) => highlight.start <= start && highlight.end >= end)
      .sort((a, b) => a.start - b.start || b.end - a.end)
      .map((highlight) => highlight.key);
    segments.push({ start, end, text: text.slice(start, end), keys });
  }
  if (segments.length === 0) segments.push({ start: 0, end: 0, text: "", keys: [] });
  return segments;
}

/** Whether `span` lies inside the block and reproduces `expectedText`, for highlighting a citation. */
export function spanMatches(blockText: string | undefined, span: SourceSpan, expectedText: string): boolean {
  if (blockText === undefined) return false;
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start) return false;
  return span.end <= blockText.length && blockText.slice(span.start, span.end) === expectedText;
}
