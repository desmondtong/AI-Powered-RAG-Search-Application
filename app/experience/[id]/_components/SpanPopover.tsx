"use client";

import { Popover } from "@base-ui/react/popover";
import { useCallback, useRef, useState, type RefObject } from "react";
import { CloseIcon } from "@/app/components/icons";
import { REVIEW } from "@/app/lib/experience/workspace/copy";
import type { EvidenceTarget } from "@/app/lib/experience/workspace/review";
import type { SourceSpan } from "@/app/lib/experience/workspace/types";
import { Button } from "../../_components/ui";

export type PopoverState =
  | { kind: "attach"; span: SourceSpan; text: string; blockLabel: string; anchor: DOMRect | null }
  | { kind: "cross-block"; anchor: DOMRect | null };

function targetKey(target: Pick<EvidenceTarget, "experienceIndex" | "evidenceIndex">) {
  return `${target.experienceIndex}:${target.evidenceIndex}`;
}

/**
 * Anchored to the selection on Base UI Popover (design Decision 8), flipping to the side where it fits and never
 * leaving the viewport; on a short viewport it scrolls inside the available height instead of clipping. Lists evidence items (unspanned first) and adds the selected span to the chosen one. A
 * selection across blocks only explains the one-block rule. Escape, Cancel or a press outside close it with the
 * draft unchanged; focus lands on the checked target on open and returns to the document on close.
 */
export default function SpanPopover({
  state,
  targets,
  preferred,
  documentRef,
  onAdd,
  onClose,
}: {
  state: PopoverState;
  targets: EvidenceTarget[];
  preferred: { experienceIndex: number; evidenceIndex: number } | null;
  /** The document pane: the anchor when the selection has no rectangle, and where focus returns on close. */
  documentRef: RefObject<HTMLDivElement | null>;
  onAdd: (target: { experienceIndex: number; evidenceIndex: number }, span: SourceSpan) => void;
  onClose: () => void;
}) {
  const initial = preferred ? targetKey(preferred) : targets[0] ? targetKey(targets[0]) : "";
  const [chosen, setChosen] = useState(initial);
  const panelRef = useRef<HTMLDivElement>(null);

  const rect = state.anchor;
  // A virtual element over the selection rectangle; the pane is the clipping context and the fallback anchor.
  const anchor = useCallback(
    () => (rect ? { getBoundingClientRect: () => rect, contextElement: documentRef.current ?? undefined } : documentRef.current),
    [rect, documentRef],
  );

  const focusTarget = useCallback(
    () =>
      panelRef.current?.querySelector<HTMLElement>('input[type="radio"]:checked') ??
      panelRef.current?.querySelector<HTMLElement>("button, input") ??
      true,
    [],
  );

  const submit = () => {
    if (state.kind !== "attach") return;
    const target = targets.find((candidate) => targetKey(candidate) === chosen);
    if (!target) return;
    onAdd({ experienceIndex: target.experienceIndex, evidenceIndex: target.evidenceIndex }, state.span);
  };

  return (
    <Popover.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner anchor={anchor} side="bottom" align="start" sideOffset={8} collisionPadding={16} className="z-50 outline-none">
          <Popover.Popup
            ref={panelRef}
            initialFocus={focusTarget}
            finalFocus={documentRef}
            className="max-h-[var(--available-height)] w-[min(360px,calc(100vw-2rem))] overflow-y-auto rounded-panel border border-hairline bg-raised p-4 shadow-raised outline-none"
          >
            <div className="flex items-start justify-between gap-2">
              <Popover.Title className="font-heading text-title-sm text-ink">
                {state.kind === "attach" ? `Attach ${state.blockLabel} text` : REVIEW.attachSelection}
              </Popover.Title>
              <Popover.Close
                aria-label="Close"
                className="grid size-7 shrink-0 place-items-center rounded-control text-ink-secondary hover:bg-subtle hover:text-ink"
              >
                <CloseIcon size={14} />
              </Popover.Close>
            </div>

            {state.kind === "cross-block" ? (
              <>
                <p className="mt-2 text-body-md text-ink-secondary">{REVIEW.selectWithinBlock}</p>
                <div className="mt-3 flex justify-end">
                  <Button onClick={onClose}>{REVIEW.cancel}</Button>
                </div>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submit();
                }}
              >
                <blockquote className="mt-2 line-clamp-3 border-l-2 border-evidence-border pl-3 text-body-sm whitespace-pre-wrap text-ink-secondary">
                  {state.text}
                </blockquote>
                {targets.length === 0 ? (
                  <p className="mt-3 text-body-md text-ink-secondary">There are no evidence items to attach this to.</p>
                ) : (
                  <fieldset className="mt-3">
                    <legend className="text-label-caps uppercase text-ink-muted">Add to evidence item</legend>
                    <div className="mt-2 max-h-56 space-y-1 overflow-auto pr-1">
                      {targets.map((target) => {
                        const key = targetKey(target);
                        return (
                          <label
                            key={key}
                            className={`flex cursor-pointer items-start gap-2 rounded-control border px-3 py-2 text-body-sm ${
                              chosen === key ? "border-cobalt bg-evidence-wash text-evidence-text" : "border-hairline text-ink hover:bg-subtle"
                            }`}
                          >
                            <input
                              type="radio"
                              name="span-target"
                              value={key}
                              checked={chosen === key}
                              onChange={() => setChosen(key)}
                              className="mt-0.5 accent-cobalt"
                            />
                            <span className="min-w-0">{target.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <Button onClick={onClose}>{REVIEW.cancel}</Button>
                  <Button type="submit" variant="primary" disabled={targets.length === 0 || !chosen}>
                    {REVIEW.addSpan}
                  </Button>
                </div>
              </form>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
