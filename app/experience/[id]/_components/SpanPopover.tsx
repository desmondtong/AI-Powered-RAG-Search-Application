"use client";

import { useEffect, useId, useRef, useState } from "react";
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
 * Anchored under the selection. Lists evidence items (unspanned first) and adds the selected span to the chosen one.
 * A selection across blocks only explains the one-block rule. Escape or Cancel closes it with the draft unchanged
 * and returns focus to the document.
 */
export default function SpanPopover({
  state,
  targets,
  preferred,
  onAdd,
  onClose,
}: {
  state: PopoverState;
  targets: EvidenceTarget[];
  preferred: { experienceIndex: number; evidenceIndex: number } | null;
  onAdd: (target: { experienceIndex: number; evidenceIndex: number }, span: SourceSpan) => void;
  onClose: () => void;
}) {
  const initial = preferred ? targetKey(preferred) : targets[0] ? targetKey(targets[0]) : "";
  const [chosen, setChosen] = useState(initial);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const first =
      panelRef.current?.querySelector<HTMLElement>('input[type="radio"]:checked') ??
      panelRef.current?.querySelector<HTMLElement>("button, input");
    first?.focus({ preventScroll: true });
  }, []);

  const style = (() => {
    if (!state.anchor || typeof window === "undefined") return undefined;
    const width = Math.min(360, window.innerWidth - 32);
    const left = Math.max(16, Math.min(state.anchor.left, window.innerWidth - width - 16));
    const below = state.anchor.bottom + 8;
    const top = below + 320 > window.innerHeight ? Math.max(16, state.anchor.top - 8 - 320) : below;
    return { position: "fixed" as const, left, top, width };
  })();

  const submit = () => {
    if (state.kind !== "attach") return;
    const target = targets.find((candidate) => targetKey(candidate) === chosen);
    if (!target) return;
    onAdd({ experienceIndex: target.experienceIndex, evidenceIndex: target.evidenceIndex }, state.span);
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={style}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      className={`${style ? "" : "fixed inset-x-4 bottom-4 sm:left-auto sm:right-6 sm:w-[360px]"} z-50 rounded-panel border border-hairline bg-raised p-4 shadow-raised`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={titleId} className="font-heading text-title-sm text-ink">
          {state.kind === "attach" ? `Attach ${state.blockLabel} text` : REVIEW.attachSelection}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-7 shrink-0 place-items-center rounded-control text-ink-secondary hover:bg-subtle hover:text-ink"
        >
          <CloseIcon size={14} />
        </button>
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
    </div>
  );
}
