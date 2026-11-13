import { z } from "zod";
import { JD_FIT_MAX_RATIONALE_CHARACTERS } from "./config";

export const JD_FIT_FIT_LABELS = ["strong", "partial", "weak", "missing"] as const;
export type JdFitFitLabel = (typeof JD_FIT_FIT_LABELS)[number];
export const JD_FIT_POSITIVE_LABELS: ReadonlySet<JdFitFitLabel> = new Set(["strong", "partial"]);
export const JD_FIT_GAP_LABELS: ReadonlySet<JdFitFitLabel> = new Set(["weak", "missing"]);

export type JdFitErrorCode =
  | "invalid-request"
  | "unsupported-request-field"
  | "jd-required"
  | "jd-too-long"
  | "no-requirements"
  | "too-many-requirements"
  | "cross-origin-rejected"
  | "deadline-exceeded"
  | "model-blocked"
  | "model-truncated"
  | "model-incomplete"
  | "model-empty-response"
  | "model-invalid-output"
  | "retrieval-failed"
  | "jd-fit-failed";

const RETRYABLE_CODES: ReadonlySet<JdFitErrorCode> = new Set([
  "deadline-exceeded",
  "model-blocked",
  "model-truncated",
  "model-incomplete",
  "model-empty-response",
  "model-invalid-output",
  "retrieval-failed",
  "jd-fit-failed",
]);

export class JdFitError extends Error {
  readonly code: JdFitErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(code: JdFitErrorCode, message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "JdFitError";
    this.code = code;
    this.status = status;
    this.retryable = RETRYABLE_CODES.has(code);
    this.details = details;
  }
}

/** Request body. Strict: any field other than `jdText` (including `sourceIds`) is rejected. */
export const JdFitRequestSchema = z.object({ jdText: z.string() }).strict();
export type JdFitRequest = z.infer<typeof JdFitRequestSchema>;

const requirementIdSchema = z.string().regex(/^R[1-9]\d*$/);
const evidenceHandleSchema = z.string().regex(/^E[1-9]\d*$/);

export const JdFitRequirementSchema = z
  .object({
    requirement_id: requirementIdSchema,
    text: z.string().min(1),
    importance: z.enum(["required", "preferred"]),
    retrieval_query: z.string().min(1),
  })
  .strict();
export type JdFitRequirement = z.infer<typeof JdFitRequirementSchema>;

export const JdFitSourceSpanSchema = z
  .object({
    block_id: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((span) => span.end > span.start, { message: "Source span end must be after start." });

export const JdFitCitationSchema = z
  .object({
    evidence_handle: evidenceHandleSchema,
    source_id: z.string().min(1),
    source_file_name: z.string(),
    revision_id: z.string().min(1),
    approved_content_hash: z.string().min(1),
    logical_experience_id: z.string().min(1),
    logical_parent_id: z.string().min(1),
    logical_chunk_id: z.string().min(1).nullable(),
    evidence_logical_ids: z.array(z.string().min(1)),
    source_span: JdFitSourceSpanSchema,
    quote: z.string().min(1),
  })
  .strict();
export type JdFitCitation = z.infer<typeof JdFitCitationSchema>;

export const JdFitAssessmentSchema = z
  .object({
    requirement_id: requirementIdSchema,
    fit: z.enum(JD_FIT_FIT_LABELS),
    rationale: z.string().min(1).max(JD_FIT_MAX_RATIONALE_CHARACTERS),
    citations: z.array(JdFitCitationSchema),
    downgraded: z.boolean(),
  })
  .strict()
  .superRefine((assessment, ctx) => {
    if (JD_FIT_POSITIVE_LABELS.has(assessment.fit) && assessment.citations.length === 0) {
      ctx.addIssue({ code: "custom", message: "Strong or partial fit requires at least one citation." });
    }
    if (assessment.fit === "missing" && assessment.citations.length > 0) {
      ctx.addIssue({ code: "custom", message: "A missing requirement cannot carry citations." });
    }
  });
export type JdFitAssessment = z.infer<typeof JdFitAssessmentSchema>;

export const JdFitGapSchema = z
  .object({
    requirement_id: requirementIdSchema,
    text: z.string().min(1),
    importance: z.enum(["required", "preferred"]),
    fit: z.enum(["weak", "missing"]),
  })
  .strict();
export type JdFitGap = z.infer<typeof JdFitGapSchema>;

const countSchema = z.number().int().nonnegative();

export const JdFitDiagnosticsSchema = z
  .object({
    model: z.string().min(1),
    requirement_prompt_version: z.string().min(1),
    report_prompt_version: z.string().min(1),
    validation_version: z.string().min(1),
    deadline_ms: z.number().int().positive(),
    max_output_tokens: z.number().int().positive(),
    requirement_count: countSchema,
    retrieval: z
      .object({
        match_count: z.number().int().positive(),
        match_threshold: z.number(),
        concurrency: z.number().int().positive(),
        retrieved_count: countSchema,
        deduped_evidence_count: countSchema,
        context_evidence_count: countSchema,
        trimmed_evidence_count: countSchema,
        context_characters: countSchema,
        context_character_budget: z.number().int().positive(),
        context_truncated: z.boolean(),
      })
      .strict(),
    generation: z
      .object({
        requirement_repair_attempted: z.boolean(),
        report_generated: z.boolean(),
        report_repair_attempted: z.boolean(),
      })
      .strict(),
    validation: z
      .object({
        downgraded_claim_count: countSchema,
        removed_citation_count: countSchema,
      })
      .strict(),
  })
  .strict();
export type JdFitDiagnostics = z.infer<typeof JdFitDiagnosticsSchema>;

export const JdFitResponseSchema = z
  .object({
    status: z.enum(["evaluated", "no_evidence"]),
    requirements: z.array(JdFitRequirementSchema).min(1),
    assessments: z.array(JdFitAssessmentSchema),
    gaps: z.array(JdFitGapSchema),
    diagnostics: JdFitDiagnosticsSchema,
  })
  .strict()
  .superRefine((response, ctx) => {
    const requirementIds = response.requirements.map((requirement) => requirement.requirement_id);
    const assessedIds = response.assessments.map((assessment) => assessment.requirement_id);
    if (new Set(requirementIds).size !== requirementIds.length) {
      ctx.addIssue({ code: "custom", message: "Requirement IDs must be unique." });
    }
    if (assessedIds.length !== requirementIds.length || requirementIds.some((id, index) => assessedIds[index] !== id)) {
      ctx.addIssue({ code: "custom", message: "Each requirement must have exactly one assessment, in order." });
    }
    const expectedGaps = response.assessments
      .filter((assessment) => JD_FIT_GAP_LABELS.has(assessment.fit))
      .map((assessment) => `${assessment.requirement_id}:${assessment.fit}`);
    const actualGaps = response.gaps.map((gap) => `${gap.requirement_id}:${gap.fit}`);
    if (expectedGaps.join("|") !== actualGaps.join("|")) {
      ctx.addIssue({ code: "custom", message: "Gaps must list every weak or missing assessment, in order." });
    }
    if (response.status === "no_evidence" && response.assessments.some((assessment) => assessment.fit !== "missing")) {
      ctx.addIssue({ code: "custom", message: "A no-evidence report must mark every requirement as missing." });
    }
  });
export type JdFitResponse = z.infer<typeof JdFitResponseSchema>;

export const JdFitErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        retryable: z.boolean(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
export type JdFitErrorResponse = z.infer<typeof JdFitErrorResponseSchema>;

/** Model output for requirement extraction. Cardinality is enforced locally, not in the provider schema. */
export const JdRequirementExtractionOutputSchema = z.object({
  requirements: z.array(
    z.object({
      text: z.string().trim().min(1).max(500),
      importance: z.enum(["required", "preferred"]),
      retrieval_query: z.string().trim().min(1).max(300),
    }),
  ),
});
export type JdRequirementExtractionOutput = z.infer<typeof JdRequirementExtractionOutputSchema>;

/** Model output for the fit report. Labels only; no numeric score field exists. */
export const JdFitReportOutputSchema = z.object({
  assessments: z.array(
    z.object({
      requirement_id: z.string().trim().min(1),
      fit: z.enum(JD_FIT_FIT_LABELS),
      rationale: z.string().trim().min(1).max(JD_FIT_MAX_RATIONALE_CHARACTERS),
      evidence_handles: z.array(z.string().trim().min(1)),
    }),
  ),
});
export type JdFitReportOutput = z.infer<typeof JdFitReportOutputSchema>;

export function parseJdFitRequest(body: unknown): { jdText: string } {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const unsupported = Object.keys(body).filter((key) => key !== "jdText");
    if (unsupported.length > 0) {
      throw new JdFitError(
        "unsupported-request-field",
        `Unsupported JD-fit request field: ${unsupported.sort().join(", ")}. Only jdText is accepted.`,
        400,
        { fields: unsupported.sort() },
      );
    }
  }
  const parsed = JdFitRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new JdFitError("invalid-request", "JD-fit request must be a JSON object with a jdText string.", 400);
  }
  return parsed.data;
}
