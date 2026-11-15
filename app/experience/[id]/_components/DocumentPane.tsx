"use client";

import { forwardRef, type ReactNode } from "react";
import { orderedBlocks } from "@/app/lib/experience/workspace/gate";
import { REVIEW } from "@/app/lib/experience/workspace/copy";
import { segmentBlock, type HighlightRange } from "@/app/lib/experience/workspace/selection";
import type { SourceBlock } from "@/app/lib/experience/workspace/types";
import { Pill } from "../../_components/ui";

export const CITATION_KEY = "citation";

/** DOM id of the first highlighted segment of a span key, used for scroll-to-span. */
export function spanAnchorId(key: string) {
  return `span-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function blockAnchorId(blockId: string) {
  return `block-${blockId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/**
 * The retained source blocks in order. Each block's text sits alone inside `[data-block-text]` with
 * `white-space: pre-wrap`; highlights are `<mark>` elements whose concatenated text is exactly `block.text`, so DOM
 * selection offsets equal span offsets. Labels and pills sit outside that element.
 */
const DocumentPane = forwardRef<
  HTMLDivElement,
  {
    blocks: readonly SourceBlock[];
    highlights: ReadonlyMap<string, HighlightRange[]>;
    unassigned?: ReadonlySet<string>;
    emphasised?: string | null;
    title?: string;
    toolbar?: ReactNode;
    onPointerSelect?: () => void;
  }
>(function DocumentPane({ blocks, highlights, unassigned, emphasised, title = REVIEW.documentTitle, toolbar, onPointerSelect }, ref) {
  const ordered = orderedBlocks(blocks);
  return (
    <section aria-labelledby="document-pane-title" className="min-w-0 rounded-panel border border-hairline bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <h2 id="document-pane-title" className="font-heading text-title-sm text-ink">
          {title}
        </h2>
        {toolbar}
      </div>
      <div
        ref={ref}
        tabIndex={-1}
        onMouseUp={onPointerSelect}
        onKeyUp={(event) => {
          if (event.shiftKey && onPointerSelect) onPointerSelect();
        }}
        className="divide-y divide-hairline focus:outline-none"
      >
        {ordered.map((block, index) => {
          const label = `b${index + 1}`;
          const isUnassigned = unassigned?.has(block.block_id) ?? false;
          const segments = segmentBlock(block.text, highlights.get(block.block_id) ?? []);
          const anchored = new Set<string>();
          return (
            <div
              key={block.block_id}
              id={blockAnchorId(block.block_id)}
              data-block-id={block.block_id}
              className={`grid scroll-mt-24 grid-cols-[2.5rem_minmax(0,1fr)] gap-2 px-3 py-3 sm:px-4 ${isUnassigned ? "bg-sand-wash" : ""}`}
            >
              <div className="select-none pt-0.5 text-label-md text-ink-muted" aria-hidden>
                {label}
              </div>
              <div className="min-w-0">
                {isUnassigned && (
                  <div className="mb-1 select-none">
                    <Pill tone="sand">{REVIEW.unassigned}</Pill>
                  </div>
                )}
                <span className="sr-only">Block {label}: </span>
                <div data-block-id={block.block_id} data-block-text className="whitespace-pre-wrap break-words text-body-lg text-ink">
                  {segments.map((segment) => {
                    if (segment.keys.length === 0) return <span key={segment.start}>{segment.text}</span>;
                    const anchors = segment.keys.filter((key) => !anchored.has(key));
                    anchors.forEach((key) => anchored.add(key));
                    const isCitation = segment.keys.includes(CITATION_KEY);
                    const isEmphasised = isCitation || (emphasised ? segment.keys.includes(emphasised) : false);
                    return (
                      <mark
                        key={segment.start}
                        id={anchors[0] ? spanAnchorId(anchors[0]) : undefined}
                        data-span-keys={segment.keys.join(" ")}
                        className={`scroll-mt-24 rounded-sm border-b-2 border-evidence-border bg-evidence-wash text-evidence-text [box-decoration-break:clone] ${
                          isEmphasised ? "outline-2 outline-cobalt" : ""
                        }`}
                      >
                        {segment.text}
                      </mark>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
});

export default DocumentPane;
