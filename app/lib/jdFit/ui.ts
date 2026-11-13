import {
  JD_FIT_FIT_LABELS,
  JdFitErrorResponseSchema,
  JdFitResponseSchema,
  type JdFitFitLabel,
  type JdFitResponse,
} from "./contracts";

export const JD_FIT_ENDPOINT = "/api/jd-fit";

export const FIT_LABEL_DISPLAY: Record<JdFitFitLabel, { text: string; className: string }> = {
  strong: {
    text: "Strong match",
    className: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  },
  partial: {
    text: "Partial match",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  },
  weak: {
    text: "Weak evidence",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  },
  missing: {
    text: "No evidence",
    className: "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  },
};

export type JdFitViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "report"; report: JdFitResponse }
  | { kind: "error"; code: string; message: string; retryable: boolean };

/** The request body the Search page sends: JD text only, never a source selection. */
export function buildJdFitRequestBody(jdText: string) {
  return JSON.stringify({ jdText });
}

/** Turns an HTTP status and parsed body into what the panel renders. */
export function interpretJdFitResponse(status: number, body: unknown): JdFitViewState {
  if (status >= 200 && status < 300) {
    const parsed = JdFitResponseSchema.safeParse(body);
    if (parsed.success) {
      return { kind: "report", report: parsed.data };
    }
    return { kind: "error", code: "invalid-response", message: "The fit report could not be read. Try again.", retryable: true };
  }
  const error = JdFitErrorResponseSchema.safeParse(body);
  if (error.success) {
    return { kind: "error", ...error.data.error };
  }
  return {
    kind: "error",
    code: "request-failed",
    message: `JD-fit evaluation failed (HTTP ${status}). Try again.`,
    retryable: status >= 500,
  };
}

export function networkErrorState(): JdFitViewState {
  return { kind: "error", code: "network-error", message: "Could not reach the server. Check your connection and try again.", retryable: true };
}

export function countByFit(report: JdFitResponse) {
  const counts = Object.fromEntries(JD_FIT_FIT_LABELS.map((label) => [label, 0])) as Record<JdFitFitLabel, number>;
  for (const assessment of report.assessments) {
    counts[assessment.fit] += 1;
  }
  return counts;
}
