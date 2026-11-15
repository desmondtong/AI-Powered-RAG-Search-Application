"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowIcon } from "@/app/components/icons";
import { useNotice } from "@/app/components/NoticeProvider";
import {
  ACTION_LABELS,
  DELETE_CONFIRM,
  NOTICES,
  fileTypeLabel,
  formatFileSize,
  formatTimestamp,
} from "@/app/lib/experience/workspace/copy";
import { toStageView, type StageTone } from "@/app/lib/experience/workspace/stage";
import { readApiErrorMessage, type SourceSummary } from "@/app/lib/experience/workspace/types";
import ConfirmInline from "./ConfirmInline";
import OverflowMenu, { type OverflowItem } from "./OverflowMenu";
import { DotStepper } from "./Stepper";
import { Button, ButtonLink } from "./ui";

export const TONE_TEXT: Record<StageTone, string> = {
  neutral: "text-ink-secondary",
  progress: "text-cobalt",
  attention: "text-amber-text",
  done: "text-green",
  failed: "text-red",
};

/**
 * One experience file on the list: name, meta line, six-dot stepper, stage label, helper, exactly one primary
 * button and an overflow menu. Row buttons open the file page, where every stage action runs.
 */
export default function ExperienceRow({ source, onChanged }: { source: SourceSummary; onChanged: () => Promise<unknown> }) {
  const view = toStageView(source);
  const href = `/experience/${source.id}`;
  const [confirming, setConfirming] = useState<null | "delete" | "retry-delete">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notice = useNotice();

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/experiences/${source.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(readApiErrorMessage(data, "The file could not be deleted."));
        return;
      }
      setConfirming(null);
      await onChanged();
      if (data?.status === "cleanup-pending") notice.info(NOTICES.deletedPending(source.file_name));
      else notice.success(NOTICES.deleted(source.file_name));
    } catch {
      setError("The file could not be deleted. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const overflow: OverflowItem[] = [{ id: "open", label: ACTION_LABELS.open, href }];
  for (const item of view.overflow) {
    if (item.id === "download-original") {
      overflow.push({ id: item.id, label: item.label, href: `/api/experiences/${source.id}/file`, download: true });
    } else if (item.id === "delete") {
      overflow.push({ id: item.id, label: item.label, destructive: true, onSelect: () => setConfirming("delete") });
    }
  }

  const primaryHref = view.primary?.id === "try-jd" ? "/" : view.primary?.id === "upload-different" ? "/experience" : href;
  const dated = view.metaFact ?? (source.updated_at ? `Updated ${formatTimestamp(source.updated_at)}` : "");
  const meta = [fileTypeLabel(source.file_type, source.file_name), formatFileSize(source.file_size), dated]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="rounded-panel border border-hairline bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href={href} className="min-w-0 truncate font-heading text-title-sm text-ink hover:text-cobalt">
              {source.file_name}
            </Link>
            <DotStepper steps={view.steps} />
          </div>
          <p className="mt-0.5 text-body-sm text-ink-muted">{meta}</p>
          <p className={`mt-2 text-body-md font-semibold ${TONE_TEXT[view.tone]}`}>{view.label}</p>
          {view.helper && <p className="text-body-sm text-ink-secondary">{view.helper}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {view.primary?.id === "retry-delete" ? (
            <Button variant="primary" onClick={() => setConfirming("retry-delete")} disabled={busy}>
              {view.primary.label}
            </Button>
          ) : view.primary ? (
            <ButtonLink href={primaryHref} variant="primary">
              {view.primary.label}
              <ArrowIcon size={16} />
            </ButtonLink>
          ) : view.tone === "progress" ? (
            <span className="text-body-md text-ink-muted" aria-hidden>
              Working…
            </span>
          ) : null}
          {view.primary?.id === "retry-delete" ? null : <OverflowMenu items={overflow} label={`More actions for ${source.file_name}`} />}
        </div>
      </div>
      {confirming && (
        <div className="mt-4">
          <ConfirmInline
            title={confirming === "retry-delete" ? DELETE_CONFIRM.retryTitle : DELETE_CONFIRM.title(source.file_name)}
            body={confirming === "retry-delete" ? DELETE_CONFIRM.retryBody : DELETE_CONFIRM.body}
            confirmLabel={confirming === "retry-delete" ? DELETE_CONFIRM.retryConfirm : DELETE_CONFIRM.confirm}
            cancelLabel={DELETE_CONFIRM.cancel}
            busy={busy}
            error={error}
            onConfirm={() => void remove()}
            onCancel={() => {
              setConfirming(null);
              setError(null);
            }}
          />
        </div>
      )}
    </li>
  );
}
