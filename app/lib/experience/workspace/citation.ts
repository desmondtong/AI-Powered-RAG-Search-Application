import { spanMatches } from "./selection";
import type { SourceBlock, SourceSpan } from "./types";

/** A citation link's target, parsed from `?cite=<block_id>:<start>:<end>&rev=<revision_id>`. */
export interface CitationTarget {
  span: SourceSpan;
  revisionId: string | null;
}

/**
 * Parses the `cite` parameter. Block IDs may themselves contain colons, so the offsets are read from the end.
 * Returns null for anything that is not `<block_id>:<start>:<end>` with integer offsets and `end > start`.
 */
export function parseCiteParam(cite: string | null | undefined, rev?: string | null): CitationTarget | null {
  if (!cite) return null;
  const parts = cite.split(":");
  if (parts.length < 3) return null;
  const endText = parts.pop() as string;
  const startText = parts.pop() as string;
  const blockId = parts.join(":");
  if (!blockId || !/^\d+$/.test(startText) || !/^\d+$/.test(endText)) return null;
  const start = Number(startText);
  const end = Number(endText);
  if (end <= start) return null;
  return { span: { block_id: blockId, start, end }, revisionId: rev ? rev : null };
}

export type CitationResolution =
  | { kind: "highlight"; span: SourceSpan; quote: string }
  | { kind: "different-version"; quote: string | null };

/**
 * Decides whether a citation can be highlighted in the displayed extraction. It highlights only when the block is
 * shown and the displayed text at the cited offsets equals the citation's quote; otherwise the page shows the quote
 * with the "different version" notice and highlights nothing.
 */
export function resolveCitation(
  displayedBlocks: readonly SourceBlock[],
  target: CitationTarget,
  quote: string | null,
): CitationResolution {
  if (quote === null || quote === "") return { kind: "different-version", quote: null };
  const block = displayedBlocks.find((candidate) => candidate.block_id === target.span.block_id);
  if (block && spanMatches(block.text, target.span, quote)) {
    return { kind: "highlight", span: target.span, quote };
  }
  return { kind: "different-version", quote };
}

/** The cited text as the cited revision's own extraction reads it, or null when the block is absent or out of range. */
export function quoteFromBlocks(blocks: readonly SourceBlock[], span: SourceSpan): string | null {
  const block = blocks.find((candidate) => candidate.block_id === span.block_id);
  if (!block || span.end > block.text.length) return null;
  return block.text.slice(span.start, span.end);
}
