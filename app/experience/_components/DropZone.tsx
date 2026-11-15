"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { ErrorIcon, UploadIcon } from "@/app/components/icons";
import { useNotice } from "@/app/components/NoticeProvider";
import { useWorkspaceSummary } from "@/app/components/WorkspaceSummaryProvider";
import { NOTICES } from "@/app/lib/experience/workspace/copy";
import {
  autostartKey,
  getDocumentsUploadConfig,
  getDocumentsUploadErrorMessage,
  isDocumentsUploadSuccess,
  shouldAutostart,
  uploadedSourceId,
} from "@/app/lib/experience/uploadUi";
import { Button } from "./ui";

/**
 * Inline DOCX/PDF upload. No modal: errors stay in place and the zone stays usable. A successful upload opens the
 * file's page; only a new upload that is still `uploaded` hands the page a one-time key to start processing.
 */
export default function DropZone() {
  const config = getDocumentsUploadConfig("experience");
  const router = useRouter();
  const { refresh } = useWorkspaceSummary();
  const notice = useNotice();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const errorId = useId();

  const upload = async (file: File | undefined) => {
    if (!file || uploading) return;
    setError(null);
    setUploading(file.name);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(config.endpoint, { method: "POST", body: formData });
      const body = await response.json().catch(() => null);
      const sourceId = uploadedSourceId(body);
      if (!response.ok || !isDocumentsUploadSuccess("experience", body) || !sourceId) {
        setError(getDocumentsUploadErrorMessage(body));
        return;
      }
      void refresh();
      notice.success(NOTICES.uploaded(file.name));
      if (shouldAutostart(body)) {
        try {
          sessionStorage.setItem(autostartKey(sourceId), "1");
        } catch {
          // Without storage the file page shows "Continue processing" instead of starting on its own.
        }
      }
      router.push(`/experience/${sourceId}`);
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setUploading(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={error ? errorId : undefined}
      aria-busy={Boolean(uploading)}
      onDragOver={(event) => {
        event.preventDefault();
        if (!uploading) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void upload(event.dataTransfer.files?.[0]);
      }}
      className={`rounded-panel border-2 border-dashed p-6 transition-colors ${
        dragging ? "border-cobalt bg-evidence-wash" : error ? "border-red-border bg-card" : "border-hairline bg-card"
      }`}
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-panel bg-evidence-wash text-cobalt">
          <UploadIcon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-heading text-title-sm text-ink">
            {config.title}
          </h2>
          <p className="text-body-md text-ink-secondary">{config.body}</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={config.accept}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => void upload(event.target.files?.[0])}
        />
        <Button variant="primary" onClick={() => inputRef.current?.click()} busy={Boolean(uploading)}>
          <UploadIcon size={16} />
          {uploading ? config.uploadingLabel : config.browseLabel}
        </Button>
      </div>
      <div aria-live="polite" className="empty:hidden">
        {uploading && <p className="mt-3 text-body-md text-ink-secondary">Uploading {uploading}…</p>}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-3 flex items-start gap-2 text-body-md text-red">
          <ErrorIcon size={16} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </section>
  );
}
