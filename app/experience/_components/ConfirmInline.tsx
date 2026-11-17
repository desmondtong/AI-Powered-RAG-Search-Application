"use client";

import { useEffect, useRef } from "react";
import { WarningIcon } from "@/app/components/icons";
import { Button } from "./ui";

/**
 * In-page confirmation for destructive actions. Never a native dialog. Escape or Cancel dismisses with no request.
 * An optional third action (`secondaryLabel`/`onSecondary`) sits between confirm and cancel; the leave guard uses it
 * for "Save and leave", and the markup is unchanged when it is absent.
 */
export default function ConfirmInline({
  title,
  body,
  confirmLabel,
  cancelLabel,
  secondaryLabel,
  busy,
  secondaryBusy,
  error,
  onConfirm,
  onSecondary,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  secondaryLabel?: string;
  busy?: boolean;
  secondaryBusy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onSecondary?: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const anyBusy = Boolean(busy || secondaryBusy);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      role="alertdialog"
      aria-labelledby="confirm-inline-title"
      aria-describedby="confirm-inline-body"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !anyBusy) {
          event.preventDefault();
          onCancel();
        }
      }}
      className="rounded-panel border border-red-border bg-red-wash p-4"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-red">
          <WarningIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id="confirm-inline-title" className="font-heading text-title-sm text-ink">
            {title}
          </h3>
          <p id="confirm-inline-body" className="mt-1 text-body-md text-ink-secondary">
            {body}
          </p>
          {error && (
            <p role="alert" className="mt-2 text-body-md text-red">
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="destructive" onClick={onConfirm} busy={busy} disabled={secondaryBusy}>
              {confirmLabel}
            </Button>
            {secondaryLabel && onSecondary && (
              <Button variant="primary" onClick={onSecondary} busy={secondaryBusy} disabled={busy}>
                {secondaryLabel}
              </Button>
            )}
            <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={anyBusy}>
              {cancelLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
