"use client";

import { CheckIcon, LockIcon, WarningIcon } from "@/app/components/icons";
import { GATE } from "@/app/lib/experience/workspace/copy";
import type { ApprovalGate as Gate, GateItem, GateTarget } from "@/app/lib/experience/workspace/gate";
import { Button, Pill } from "../../_components/ui";

/**
 * "Before you can approve": one checklist for acknowledgements, missing spans, the no-evidence condition and the
 * last save or approval errors. The button reads "Approve · N items left" (locked), "Save & approve" or "Approve".
 */
export default function ApprovalGate({
  gate,
  acknowledgements,
  busy,
  phase,
  onAcknowledge,
  onJump,
  onReload,
  onApprove,
  blockLabelFor,
}: {
  gate: Gate;
  blockLabelFor: (blockId: string) => string;
  acknowledgements: { warnings: boolean; unassigned_blocks: boolean };
  busy: boolean;
  phase: "saving" | "approving" | null;
  onAcknowledge: (field: "warnings" | "unassigned_blocks", value: boolean) => void;
  onJump: (target: GateTarget) => void;
  onReload: () => void;
  onApprove: () => void;
}) {
  const total = gate.items.reduce((sum, item) => sum + item.count, 0);
  const done = total - gate.remaining;
  const percent = total === 0 ? 100 : Math.round((done / total) * 100);
  const locked = gate.button.state === "locked";
  const label = phase === "saving" ? GATE.saving : phase === "approving" ? GATE.approving : gate.button.label;

  return (
    <section aria-labelledby="approval-gate-title" className="rounded-panel border border-hairline bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="approval-gate-title" className="font-heading text-title-sm text-ink">
          {GATE.title}
        </h2>
        <Pill tone={gate.remaining === 0 ? "green" : "amber"}>
          <span aria-live="polite">{gate.remaining === 0 ? "Ready" : `${gate.remaining} left`}</span>
        </Pill>
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-subtle"
        role="progressbar"
        aria-label="Approval checklist progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div className={`h-full rounded-full ${gate.remaining === 0 ? "bg-green" : "bg-amber"}`} style={{ width: `${percent}%` }} />
      </div>

      {gate.items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-body-md text-green">
          <CheckIcon size={16} /> Everything is checked.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {gate.items.map((item) => (
            <GateRow
              key={item.key}
              item={item}
              acknowledgements={acknowledgements}
              onAcknowledge={onAcknowledge}
              onJump={onJump}
              onReload={onReload}
              blockLabelFor={blockLabelFor}
            />
          ))}
        </ul>
      )}

      <Button
        variant="primary"
        className="mt-4 w-full"
        busy={phase !== null}
        disabled={locked || busy}
        onClick={onApprove}
        aria-describedby="approval-gate-footer"
      >
        {locked && <LockIcon size={16} />}
        {label}
      </Button>
      <p id="approval-gate-footer" className="mt-2 text-body-sm text-ink-muted">
        {gate.footer}
      </p>
    </section>
  );
}

function GateRow({
  item,
  acknowledgements,
  onAcknowledge,
  onJump,
  onReload,
  blockLabelFor,
}: {
  item: GateItem;
  blockLabelFor: (blockId: string) => string;
  acknowledgements: { warnings: boolean; unassigned_blocks: boolean };
  onAcknowledge: (field: "warnings" | "unassigned_blocks", value: boolean) => void;
  onJump: (target: GateTarget) => void;
  onReload: () => void;
}) {
  if (item.checkbox && item.target.kind === "acknowledgement") {
    const field = item.target.field;
    return (
      <li className="rounded-control border border-hairline p-2">
        <label className="flex cursor-pointer items-start gap-2 text-body-md text-ink">
          <input
            type="checkbox"
            checked={field === "warnings" ? acknowledgements.warnings : acknowledgements.unassigned_blocks}
            onChange={(event) => onAcknowledge(field, event.target.checked)}
            className="mt-1 size-4 accent-cobalt"
          />
          <span>{item.label}</span>
        </label>
        {item.targets && item.targets.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1 pl-6">
            {item.targets.slice(0, 12).map((target, index) => (
              <button
                key={index}
                type="button"
                onClick={() => onJump(target)}
                className="rounded-full border border-sand-border bg-sand-wash px-2 text-label-md text-sand-label hover:underline"
              >
                {target.kind === "block" ? blockLabelFor(target.blockId) : "Show"}
              </button>
            ))}
          </div>
        )}
      </li>
    );
  }

  const tone = item.kind === "field-error" ? "text-red" : "text-amber-text";
  return (
    <li className="flex items-start gap-2 rounded-control border border-hairline p-2 text-body-md">
      <WarningIcon size={16} className={`mt-0.5 shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <p className="text-ink">{item.label}</p>
        {item.stale ? (
          <button type="button" onClick={onReload} className="text-body-sm font-semibold text-cobalt hover:underline">
            {GATE.reload}
          </button>
        ) : item.target.kind !== "none" ? (
          <button type="button" onClick={() => onJump(item.target)} className="text-body-sm font-semibold text-cobalt hover:underline">
            {item.kind === "missing-spans" ? "Go to the first one" : "Show where"}
          </button>
        ) : null}
      </div>
    </li>
  );
}
