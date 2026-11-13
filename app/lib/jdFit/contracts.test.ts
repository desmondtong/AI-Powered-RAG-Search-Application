import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  JdFitAssessmentSchema,
  JdFitError,
  JdFitRequestSchema,
  JdFitResponseSchema,
  parseJdFitRequest,
  type JdFitResponse,
} from "./contracts";

export function validResponseFixture(): JdFitResponse {
  return {
    status: "evaluated",
    requirements: [
      { requirement_id: "R1", text: "Build REST APIs in TypeScript", importance: "required", retrieval_query: "TypeScript REST API" },
      { requirement_id: "R2", text: "Kubernetes operations", importance: "preferred", retrieval_query: "Kubernetes" },
    ],
    assessments: [
      {
        requirement_id: "R1",
        fit: "strong",
        rationale: "E1 shows the candidate built TypeScript REST APIs.",
        downgraded: false,
        citations: [
          {
            evidence_handle: "E1",
            source_id: "11111111-1111-4111-8111-111111111111",
            source_file_name: "experience.docx",
            revision_id: "22222222-2222-4222-8222-222222222222",
            approved_content_hash: "sha256:abc",
            logical_experience_id: "exp-atlas",
            logical_parent_id: "exp-atlas:parent-1",
            logical_chunk_id: "exp-atlas:chunk-1",
            evidence_logical_ids: ["exp-atlas:ev-1"],
            source_span: { block_id: "b1", start: 0, end: 40 },
            quote: "Built TypeScript REST APIs for billing.",
          },
        ],
      },
      { requirement_id: "R2", fit: "missing", rationale: "No retrieved evidence mentions Kubernetes.", downgraded: false, citations: [] },
    ],
    gaps: [{ requirement_id: "R2", text: "Kubernetes operations", importance: "preferred", fit: "missing" }],
    diagnostics: {
      model: "gemini-flash-lite-latest",
      requirement_prompt_version: "jd-fit-requirements-v1",
      report_prompt_version: "jd-fit-report-v1",
      validation_version: "jd-fit-validation-v1",
      deadline_ms: 120000,
      max_output_tokens: 16384,
      requirement_count: 2,
      retrieval: {
        match_count: 8,
        match_threshold: -1,
        concurrency: 4,
        retrieved_count: 1,
        deduped_evidence_count: 1,
        context_evidence_count: 1,
        trimmed_evidence_count: 0,
        context_characters: 40,
        context_character_budget: 16000,
        context_truncated: false,
      },
      generation: { requirement_repair_attempted: false, report_generated: true, report_repair_attempted: false },
      validation: { downgraded_claim_count: 0, removed_citation_count: 0 },
    },
  };
}

describe("JD-fit contracts", () => {
  it("accepts a valid cited report", () => {
    assert.equal(JdFitResponseSchema.safeParse(validResponseFixture()).success, true);
  });

  it("rejects numeric fit scores", () => {
    const withScore = { ...validResponseFixture(), score: 87 };
    assert.equal(JdFitResponseSchema.safeParse(withScore).success, false);
    const assessmentWithScore = { ...validResponseFixture().assessments[0], fit_score: 0.9 };
    assert.equal(JdFitAssessmentSchema.safeParse(assessmentWithScore).success, false);
  });

  it("rejects unsupported fit labels", () => {
    const response = validResponseFixture();
    const bad = { ...response, assessments: [{ ...response.assessments[0], fit: "excellent" }, response.assessments[1]] };
    assert.equal(JdFitResponseSchema.safeParse(bad).success, false);
  });

  it("rejects malformed citations and uncited positive claims", () => {
    const response = validResponseFixture();
    const malformed = {
      ...response.assessments[0],
      citations: [{ ...response.assessments[0].citations[0], source_span: { block_id: "b1", start: 10, end: 5 } }],
    };
    assert.equal(JdFitAssessmentSchema.safeParse(malformed).success, false);
    const badHandle = { ...response.assessments[0], citations: [{ ...response.assessments[0].citations[0], evidence_handle: "chunk-uuid" }] };
    assert.equal(JdFitAssessmentSchema.safeParse(badHandle).success, false);
    assert.equal(JdFitAssessmentSchema.safeParse({ ...response.assessments[0], citations: [] }).success, false);
    assert.equal(
      JdFitAssessmentSchema.safeParse({ ...response.assessments[1], citations: response.assessments[0].citations }).success,
      false,
    );
  });

  it("requires gaps to mirror weak and missing assessments", () => {
    assert.equal(JdFitResponseSchema.safeParse({ ...validResponseFixture(), gaps: [] }).success, false);
  });

  it("requires JD text and rejects unknown request fields such as sourceIds", () => {
    assert.equal(JdFitRequestSchema.safeParse({ jdText: "Senior engineer" }).success, true);
    assert.throws(() => parseJdFitRequest({}), (error: unknown) => error instanceof JdFitError && error.code === "invalid-request");
    assert.throws(() => parseJdFitRequest("text"), (error: unknown) => error instanceof JdFitError && error.code === "invalid-request");
    assert.throws(
      () => parseJdFitRequest({ jdText: "Senior engineer", sourceIds: [] }),
      (error: unknown) =>
        error instanceof JdFitError && error.code === "unsupported-request-field" && error.status === 400,
    );
  });
});
