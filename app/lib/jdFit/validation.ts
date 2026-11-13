import { citationFromEvidence, type EvidenceRecord } from "./context";
import {
  JD_FIT_POSITIVE_LABELS,
  type JdFitAssessment,
  type JdFitFitLabel,
  type JdFitReportOutput,
  type JdFitRequirement,
} from "./contracts";

const HANDLE_MENTION = /\bE[1-9]\d*\b/g;
const NUMERIC_SCORE =
  /\b(fit|match)\s*(score|rating)\b|\b\d{1,3}(\.\d+)?\s*%\s*(fit|match)\b|\b\d+(\.\d+)?\s*(\/|out of)\s*(5|10|100)\b/i;

export const REMOVED_CLAIM_RATIONALE =
  "The generated claim could not be tied to retrieved approved evidence, so it was removed.";
export const NOT_ASSESSED_RATIONALE = "The model did not assess this requirement, so it is treated as missing.";
export const NO_EVIDENCE_RATIONALE = "No approved experience evidence was found for this requirement.";

type ReportAssessment = JdFitReportOutput["assessments"][number];

function mentionedHandles(text: string) {
  return [...new Set(text.match(HANDLE_MENTION) ?? [])];
}

/** Problems that justify one repair attempt. An empty list means the report is valid as generated. */
export function findReportIssues(
  output: JdFitReportOutput,
  requirements: JdFitRequirement[],
  evidence: EvidenceRecord[],
): string[] {
  const issues: string[] = [];
  const handles = new Set(evidence.map((record) => record.handle));
  const requirementIds = new Set(requirements.map((requirement) => requirement.requirement_id));
  const seen = new Set<string>();

  for (const assessment of output.assessments) {
    const id = assessment.requirement_id;
    if (!requirementIds.has(id)) {
      issues.push(`${id}: unknown requirement_id.`);
      continue;
    }
    if (seen.has(id)) {
      issues.push(`${id}: assessed more than once.`);
      continue;
    }
    seen.add(id);

    const unknown = assessment.evidence_handles.filter((handle) => !handles.has(handle));
    if (unknown.length > 0) {
      issues.push(`${id}: cites evidence that was not provided (${unknown.join(", ")}).`);
    }
    const valid = assessment.evidence_handles.filter((handle) => handles.has(handle));
    if (JD_FIT_POSITIVE_LABELS.has(assessment.fit) && valid.length === 0) {
      issues.push(`${id}: ${assessment.fit} fit requires at least one provided evidence handle.`);
    }
    if (assessment.fit === "missing" && assessment.evidence_handles.length > 0) {
      issues.push(`${id}: missing fit must not cite evidence.`);
    }
    const uncitedMentions = mentionedHandles(assessment.rationale).filter((handle) => !assessment.evidence_handles.includes(handle));
    if (uncitedMentions.length > 0) {
      issues.push(`${id}: rationale mentions evidence it does not cite (${uncitedMentions.join(", ")}).`);
    }
    if (NUMERIC_SCORE.test(assessment.rationale)) {
      issues.push(`${id}: rationale contains a numeric fit score.`);
    }
  }

  for (const requirement of requirements) {
    if (!seen.has(requirement.requirement_id)) {
      issues.push(`${requirement.requirement_id}: no assessment returned.`);
    }
  }
  return issues;
}

export interface ValidatedAssessments {
  assessments: JdFitAssessment[];
  downgradedClaimCount: number;
  removedCitationCount: number;
}

/**
 * Deterministically turns a parsed report into safe assessments: invalid citations are removed, positive claims
 * left without valid evidence become "missing", and no unsupported claim survives in rationale text.
 */
export function applySafeDowngrades(
  output: JdFitReportOutput,
  requirements: JdFitRequirement[],
  evidence: EvidenceRecord[],
): ValidatedAssessments {
  const byHandle = new Map(evidence.map((record) => [record.handle, record]));
  const firstByRequirement = new Map<string, ReportAssessment>();
  for (const assessment of output.assessments) {
    if (!firstByRequirement.has(assessment.requirement_id)) {
      firstByRequirement.set(assessment.requirement_id, assessment);
    }
  }

  let downgradedClaimCount = 0;
  let removedCitationCount = 0;
  const assessments = requirements.map((requirement): JdFitAssessment => {
    const generated = firstByRequirement.get(requirement.requirement_id);
    if (!generated) {
      downgradedClaimCount += 1;
      return { requirement_id: requirement.requirement_id, fit: "missing", rationale: NOT_ASSESSED_RATIONALE, citations: [], downgraded: true };
    }

    const uniqueHandles = [...new Set(generated.evidence_handles)];
    const validHandles = uniqueHandles.filter((handle) => byHandle.has(handle));
    removedCitationCount += uniqueHandles.length - validHandles.length;

    let fit: JdFitFitLabel = generated.fit;
    let rationale = generated.rationale;
    let handles = validHandles;
    let downgraded = false;

    const unsupportedPositive = JD_FIT_POSITIVE_LABELS.has(fit) && validHandles.length === 0;
    const mentionsUncited = mentionedHandles(rationale).some((handle) => !validHandles.includes(handle));
    const hasScore = NUMERIC_SCORE.test(rationale);

    if (unsupportedPositive) {
      fit = "missing";
      rationale = REMOVED_CLAIM_RATIONALE;
      downgraded = true;
    } else if (fit === "missing" && handles.length > 0) {
      removedCitationCount += handles.length;
      handles = [];
      rationale = REMOVED_CLAIM_RATIONALE;
      downgraded = true;
    } else if (mentionsUncited || hasScore) {
      rationale = REMOVED_CLAIM_RATIONALE;
      downgraded = true;
      if (JD_FIT_POSITIVE_LABELS.has(fit)) {
        fit = "weak";
      }
    }
    if (fit === "missing" && handles.length > 0) {
      removedCitationCount += handles.length;
      handles = [];
    }
    if (downgraded) downgradedClaimCount += 1;

    return {
      requirement_id: requirement.requirement_id,
      fit,
      rationale,
      citations: handles.map((handle) => citationFromEvidence(byHandle.get(handle)!)),
      downgraded,
    };
  });

  return { assessments, downgradedClaimCount, removedCitationCount };
}

/** Report used when there is no approved evidence at all; no model call is made. */
export function noEvidenceAssessments(requirements: JdFitRequirement[]): JdFitAssessment[] {
  return requirements.map((requirement) => ({
    requirement_id: requirement.requirement_id,
    fit: "missing",
    rationale: NO_EVIDENCE_RATIONALE,
    citations: [],
    downgraded: false,
  }));
}
