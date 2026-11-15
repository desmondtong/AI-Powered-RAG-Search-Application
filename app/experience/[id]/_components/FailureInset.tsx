import { ErrorIcon } from "@/app/components/icons";
import { FAILURE } from "@/app/lib/experience/workspace/copy";

/** Plain-language explanation of a failed stage, using the message the API returned. */
export default function FailureInset({ stageName, message, code }: { stageName: string; message: string; code?: string | null }) {
  return (
    <div role="alert" className="mt-4 flex items-start gap-3 rounded-panel border border-red-border bg-red-wash p-4">
      <ErrorIcon size={18} className="mt-0.5 shrink-0 text-red" />
      <div className="min-w-0">
        <p className="font-semibold text-ink">{FAILURE.title(stageName)}</p>
        <p className="text-body-md text-ink-secondary">{message || FAILURE.fallback}</p>
        {code && <p className="mt-1 text-body-sm text-ink-muted">Error code: {code}</p>}
      </div>
    </div>
  );
}
