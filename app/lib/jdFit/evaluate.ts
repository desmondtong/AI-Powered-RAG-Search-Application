import {
  JD_FIT_CONTEXT_CHARACTERS,
  JD_FIT_DEADLINE_MS,
  JD_FIT_MATCHES_PER_REQUIREMENT,
  JD_FIT_MATCH_THRESHOLD,
  JD_FIT_MAX_OUTPUT_TOKENS,
  JD_FIT_MAX_REQUIREMENTS,
  JD_FIT_MODEL,
  JD_FIT_REPORT_PROMPT_VERSION,
  JD_FIT_REQUIREMENT_PROMPT_VERSION,
  JD_FIT_RETRIEVAL_CONCURRENCY,
  JD_FIT_VALIDATION_VERSION,
} from "./config";
import { buildEvidenceContext } from "./context";
import {
  JD_FIT_GAP_LABELS,
  JdFitResponseSchema,
  parseJdFitRequest,
  type JdFitAssessment,
  type JdFitResponse,
} from "./contracts";
import { JdFitDeadline, getJdFitModelClient, type JdFitModelClient } from "./generation";
import { generateFitReport } from "./report";
import { extractJdRequirements, normalizeJdText } from "./requirements";
import { retrieveRequirementEvidence, type JdFitSearch } from "./retrieval";
import { noEvidenceAssessments } from "./validation";

export interface EvaluateJobDescriptionDependencies {
  client?: JdFitModelClient;
  search?: JdFitSearch;
  now?: () => number;
  deadlineMs?: number;
  model?: string;
  maxOutputTokens?: number;
  maxRequirements?: number;
  maxJdCharacters?: number;
  contextCharacters?: number;
}

/**
 * Read-only JD-fit pipeline: validate request, extract requirements, retrieve active approved evidence per
 * requirement, budget context, generate a categorical report, and validate its citations.
 */
export async function evaluateJobDescription(
  body: unknown,
  dependencies: EvaluateJobDescriptionDependencies = {},
): Promise<JdFitResponse> {
  const { jdText: rawJdText } = parseJdFitRequest(body);
  const jdText = normalizeJdText(rawJdText, dependencies.maxJdCharacters);

  const deadlineMs = dependencies.deadlineMs ?? JD_FIT_DEADLINE_MS;
  const deadline = new JdFitDeadline(deadlineMs, dependencies.now);
  const model = dependencies.model ?? JD_FIT_MODEL;
  const maxOutputTokens = dependencies.maxOutputTokens ?? JD_FIT_MAX_OUTPUT_TOKENS;
  const client = dependencies.client ?? getJdFitModelClient();

  const extracted = await extractJdRequirements({
    jdText,
    client,
    deadline,
    model,
    maxOutputTokens,
    maxRequirements: dependencies.maxRequirements ?? JD_FIT_MAX_REQUIREMENTS,
  });
  const requirements = extracted.requirements;

  const retrieved = await retrieveRequirementEvidence({ requirements, deadline, search: dependencies.search });
  const context = buildEvidenceContext(requirements, retrieved, dependencies.contextCharacters ?? JD_FIT_CONTEXT_CHARACTERS);

  let assessments: JdFitAssessment[];
  let reportGenerated = false;
  let reportRepairAttempted = false;
  let downgradedClaimCount = 0;
  let removedCitationCount = 0;
  const noEvidence = context.evidence.length === 0;

  if (noEvidence) {
    assessments = noEvidenceAssessments(requirements);
  } else {
    const report = await generateFitReport({ requirements, context, client, deadline, model, maxOutputTokens });
    assessments = report.assessments;
    reportGenerated = true;
    reportRepairAttempted = report.repairAttempted;
    downgradedClaimCount = report.downgradedClaimCount;
    removedCitationCount = report.removedCitationCount;
  }
  deadline.requireRemaining("response");

  const requirementById = new Map(requirements.map((requirement) => [requirement.requirement_id, requirement]));
  const gaps = assessments
    .filter((assessment) => JD_FIT_GAP_LABELS.has(assessment.fit))
    .map((assessment) => {
      const requirement = requirementById.get(assessment.requirement_id)!;
      return {
        requirement_id: requirement.requirement_id,
        text: requirement.text,
        importance: requirement.importance,
        fit: assessment.fit as "weak" | "missing",
      };
    });

  return JdFitResponseSchema.parse({
    status: noEvidence ? "no_evidence" : "evaluated",
    requirements,
    assessments,
    gaps,
    diagnostics: {
      model,
      requirement_prompt_version: JD_FIT_REQUIREMENT_PROMPT_VERSION,
      report_prompt_version: JD_FIT_REPORT_PROMPT_VERSION,
      validation_version: JD_FIT_VALIDATION_VERSION,
      deadline_ms: deadlineMs,
      max_output_tokens: maxOutputTokens,
      requirement_count: requirements.length,
      retrieval: {
        match_count: JD_FIT_MATCHES_PER_REQUIREMENT,
        match_threshold: JD_FIT_MATCH_THRESHOLD,
        concurrency: JD_FIT_RETRIEVAL_CONCURRENCY,
        ...context.stats,
      },
      generation: {
        requirement_repair_attempted: extracted.repairAttempted,
        report_generated: reportGenerated,
        report_repair_attempted: reportRepairAttempted,
      },
      validation: {
        downgraded_claim_count: downgradedClaimCount,
        removed_citation_count: removedCitationCount,
      },
    },
  });
}
