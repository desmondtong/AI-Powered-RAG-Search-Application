import {
  JD_FIT_FIT_LABELS,
  JdFitErrorResponseSchema,
  JdFitResponseSchema,
  type JdFitAssessment,
  type JdFitCitation,
  type JdFitFitLabel,
  type JdFitRequirement,
  type JdFitResponse,
} from "./contracts";

export const JD_FIT_ENDPOINT = "/api/jd-fit";

/** Report order for fit groups and tiles. */
export const FIT_GROUP_ORDER: readonly JdFitFitLabel[] = ["strong", "partial", "weak", "missing"];

/**
 * Categorical fit labels only: no numeric score or percentage is ever shown. Classes use the Porcelain & Cobalt
 * fit tokens, so light and dark themes are a token swap.
 */
export const FIT_LABEL_DISPLAY: Record<JdFitFitLabel, { text: string; className: string; tileClassName: string }> = {
  strong: { text: "Strong", className: "bg-fit-strong-wash text-fit-strong", tileClassName: "border-fit-strong" },
  partial: { text: "Partial", className: "bg-fit-partial-wash text-fit-partial", tileClassName: "border-fit-partial" },
  weak: { text: "Weak", className: "bg-fit-weak-wash text-fit-weak", tileClassName: "border-fit-weak" },
  missing: { text: "Missing", className: "bg-fit-missing-wash text-fit-missing", tileClassName: "border-fit-missing" },
};

export interface FitGroup {
  fit: JdFitFitLabel;
  items: Array<{ assessment: JdFitAssessment; requirement: JdFitRequirement | undefined }>;
}

/** Assessments grouped Strong, Partial, Weak, Missing, keeping report order inside each group. Empty groups are kept. */
export function groupAssessmentsByFit(report: Pick<JdFitResponse, "assessments" | "requirements">): FitGroup[] {
  const requirements = new Map(report.requirements.map((requirement) => [requirement.requirement_id, requirement]));
  return FIT_GROUP_ORDER.map((fit) => ({
    fit,
    items: report.assessments
      .filter((assessment) => assessment.fit === fit)
      .map((assessment) => ({ assessment, requirement: requirements.get(assessment.requirement_id) })),
  }));
}

/**
 * "file name · experience title · evidence kinds". A null title reads "General experience" for general experience
 * and is left out for a project; an empty kinds list is left out.
 */
export function citationCaption(
  citation: Pick<JdFitCitation, "source_file_name" | "experience_title" | "experience_type" | "evidence_kinds">,
): string {
  const title = citation.experience_title ?? (citation.experience_type === "general-experience" ? "General experience" : null);
  const kinds = citation.evidence_kinds.length > 0 ? citation.evidence_kinds.join(", ") : null;
  return [citation.source_file_name || "Experience file", title, kinds].filter(Boolean).join(" · ");
}

/** The file page for the cited source, with the cited span and revision: `/experience/<id>?cite=<block>:<start>:<end>&rev=<rev>`. */
export function citationHref(citation: Pick<JdFitCitation, "source_id" | "source_span" | "revision_id">): string {
  const { block_id, start, end } = citation.source_span;
  return `/experience/${encodeURIComponent(citation.source_id)}?cite=${encodeURIComponent(block_id)}:${start}:${end}&rev=${encodeURIComponent(citation.revision_id)}`;
}

/** "N requirements · M files searched · T s". Files are left out when the indexed count is unknown. */
export function reportHeaderLine(requirementCount: number, filesSearched: number | null, elapsedMs: number | null): string {
  const parts = [`${requirementCount} ${requirementCount === 1 ? "requirement" : "requirements"}`];
  if (filesSearched !== null) parts.push(`${filesSearched} ${filesSearched === 1 ? "file" : "files"} searched`);
  if (elapsedMs !== null && Number.isFinite(elapsedMs)) parts.push(`${(elapsedMs / 1000).toFixed(1)} s`);
  return parts.join(" · ");
}

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
