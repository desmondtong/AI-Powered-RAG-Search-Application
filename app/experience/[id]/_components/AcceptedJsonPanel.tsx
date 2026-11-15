import { CloseIcon } from "@/app/components/icons";
import type { AcceptedRevisionExport } from "@/app/lib/experience/workspace/types";

/** The accepted JSON of an approved revision beside the source passages each field resolves to. */
export default function AcceptedJsonPanel({
  title,
  exportDoc,
  onClose,
}: {
  title: string;
  exportDoc: AcceptedRevisionExport;
  onClose: () => void;
}) {
  return (
    <section aria-labelledby="accepted-json-title" className="mt-6 rounded-panel border border-hairline bg-card p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="accepted-json-title" className="font-heading text-headline-md text-ink">
            {title}
          </h2>
          <p className="break-all text-body-sm text-ink-muted">Content hash {exportDoc.content_hash}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close accepted JSON"
          className="grid size-9 shrink-0 place-items-center rounded-control border border-hairline text-ink-secondary hover:text-ink"
        >
          <CloseIcon size={16} />
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-2 text-label-caps uppercase text-ink-muted">Accepted JSON</h3>
          <pre className="max-h-96 overflow-auto rounded-control bg-subtle p-4 text-body-sm whitespace-pre-wrap break-words text-ink">
            {JSON.stringify(exportDoc.revision, null, 2)}
          </pre>
        </div>
        <div className="min-w-0">
          <h3 className="mb-2 text-label-caps uppercase text-ink-muted">Resolved source references</h3>
          <ul className="max-h-96 space-y-3 overflow-auto pr-1">
            {exportDoc.resolved_source_refs.map((reference, index) => (
              <li key={`${reference.field_path}:${index}`} className="rounded-control bg-subtle p-3">
                <p className="text-label-md text-ink-muted">{reference.field_path}</p>
                {reference.source_refs.map((sourceRef, refIndex) => (
                  <blockquote
                    key={`${sourceRef.block_id}:${sourceRef.start}:${refIndex}`}
                    className="mt-2 border-l-2 border-evidence-border pl-3 text-body-md whitespace-pre-wrap text-ink"
                  >
                    {sourceRef.text}
                  </blockquote>
                ))}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
