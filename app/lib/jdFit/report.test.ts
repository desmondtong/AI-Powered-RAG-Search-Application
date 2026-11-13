import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JD_FIT_REPORT_PROMPT_VERSION } from "./config";
import { buildEvidenceContext } from "./context";
import { JdFitAssessmentSchema, JdFitError, type JdFitRequirement } from "./contracts";
import { JdFitDeadline, type JdFitModelResponse } from "./generation";
import { generateFitReport } from "./report";
import { ScriptedModelClient, jsonResponse, makeHit } from "./testFixtures";
import { NOT_ASSESSED_RATIONALE, REMOVED_CLAIM_RATIONALE, applySafeDowngrades, findReportIssues } from "./validation";

const requirements: JdFitRequirement[] = [
  { requirement_id: "R1", text: "TypeScript APIs", importance: "required", retrieval_query: "TypeScript API" },
  { requirement_id: "R2", text: "Team leadership", importance: "required", retrieval_query: "led a team" },
  { requirement_id: "R3", text: "Data pipelines", importance: "preferred", retrieval_query: "data pipeline" },
  { requirement_id: "R4", text: "Kubernetes", importance: "preferred", retrieval_query: "Kubernetes" },
];

const context = buildEvidenceContext(requirements, [
  { requirement_id: "R1", hits: [makeHit({ chunkRowId: "c1", text: "Built TypeScript REST APIs for billing." })] },
  { requirement_id: "R2", hits: [makeHit({ chunkRowId: "c2", text: "Coordinated two engineers on the Atlas launch.", start: 100 })] },
  { requirement_id: "R3", hits: [makeHit({ chunkRowId: "c3", text: "Wrote nightly CSV export scripts.", start: 200 })] },
  { requirement_id: "R4", hits: [] },
]);

const goodReport = {
  assessments: [
    { requirement_id: "R1", fit: "strong", rationale: "E1 shows TypeScript REST APIs.", evidence_handles: ["E1"] },
    { requirement_id: "R2", fit: "partial", rationale: "E2 shows coordination, not formal leadership.", evidence_handles: ["E2"] },
    { requirement_id: "R3", fit: "weak", rationale: "E3 shows scripted exports, which is only adjacent.", evidence_handles: ["E3"] },
    { requirement_id: "R4", fit: "missing", rationale: "No evidence mentions Kubernetes.", evidence_handles: [] },
  ],
};

function run(client: ScriptedModelClient, ms = 120_000) {
  return generateFitReport({ requirements, context, client, deadline: new JdFitDeadline(ms) });
}

function isCode(code: string) {
  return (error: unknown) => error instanceof JdFitError && error.code === code;
}

describe("JD-fit report generation", () => {
  it("returns strong, partial, weak, and missing assessments with resolved citations and no scores", async () => {
    const client = new ScriptedModelClient({ report: [jsonResponse(goodReport)] });
    const result = await run(client);

    assert.deepEqual(result.assessments.map((assessment) => assessment.fit), ["strong", "partial", "weak", "missing"]);
    assert.equal(result.repairAttempted, false);
    assert.equal(result.downgradedClaimCount, 0);
    assert.equal(result.assessments[0].citations[0].quote, "Built TypeScript REST APIs for billing.");
    assert.deepEqual(result.assessments[3].citations, []);
    for (const assessment of result.assessments) {
      assert.equal(JdFitAssessmentSchema.safeParse(assessment).success, true);
      assert.equal("score" in assessment, false);
    }
    assert.match(client.calls[0].contents, new RegExp(`TASK_VERSION: ${JD_FIT_REPORT_PROMPT_VERSION}`));
    assert.match(client.calls[0].contents, /"handle": "E1"/);
  });

  it("repairs a completed but invalid report once", async () => {
    const client = new ScriptedModelClient({ report: [{ text: "{not json", candidates: [{ finishReason: "STOP" }] }, jsonResponse(goodReport)] });
    const result = await run(client);
    assert.equal(result.repairAttempted, true);
    assert.equal(client.calls.length, 2);
    assert.match(client.calls[1].contents, /BEGIN_REPAIR_DIAGNOSTIC_JSON/);
  });

  it("repairs bad citations once, then downgrades whatever is still unsupported", async () => {
    const bad = {
      assessments: [
        { requirement_id: "R1", fit: "strong", rationale: "E9 proves it.", evidence_handles: ["E9"] },
        ...goodReport.assessments.slice(1),
      ],
    };
    const client = new ScriptedModelClient({ report: [jsonResponse(bad), jsonResponse(bad)] });
    const result = await run(client);

    assert.equal(client.calls.length, 2);
    assert.equal(result.repairAttempted, true);
    assert.equal(result.assessments[0].fit, "missing");
    assert.equal(result.assessments[0].rationale, REMOVED_CLAIM_RATIONALE);
    assert.equal(result.assessments[0].downgraded, true);
    assert.equal(result.removedCitationCount, 1);
  });

  it("falls back to the first parsed report when the repair is truncated", async () => {
    const bad = { assessments: goodReport.assessments.slice(0, 3) };
    const client = new ScriptedModelClient({ report: [jsonResponse(bad), { text: "{", candidates: [{ finishReason: "MAX_TOKENS" }] }] });
    const result = await run(client);
    assert.equal(result.assessments[3].fit, "missing");
    assert.equal(result.assessments[3].rationale, NOT_ASSESSED_RATIONALE);
  });

  const unrepairable: Array<[string, JdFitModelResponse, string]> = [
    ["truncated", { text: '{"assessments": [', candidates: [{ finishReason: "MAX_TOKENS" }] }, "model-truncated"],
    ["blocked", { promptFeedback: { blockReason: "SAFETY" } }, "model-blocked"],
    ["empty", { text: "", candidates: [{ finishReason: "STOP" }] }, "model-empty-response"],
  ];
  for (const [name, response, code] of unrepairable) {
    it(`does not repair a ${name} report into a confident one`, async () => {
      const client = new ScriptedModelClient({ report: [response] });
      await assert.rejects(run(client), isCode(code));
      assert.equal(client.calls.length, 1);
    });
  }

  it("does not start a report after the deadline has expired", async () => {
    const client = new ScriptedModelClient({ report: [jsonResponse(goodReport)] });
    await assert.rejects(generateFitReport({ requirements, context, client, deadline: new JdFitDeadline(0) }), isCode("deadline-exceeded"));
    assert.equal(client.calls.length, 0);
  });

  it("fails when two completed responses are both unparseable", async () => {
    const client = new ScriptedModelClient({ report: [jsonResponse({ nope: true }), jsonResponse({ nope: true })] });
    await assert.rejects(run(client), isCode("model-invalid-output"));
  });
});

describe("JD-fit citation validation", () => {
  it("requires valid evidence for every strong or partial claim", () => {
    const output = {
      assessments: [
        { requirement_id: "R1", fit: "strong" as const, rationale: "Clearly experienced.", evidence_handles: [] },
        { requirement_id: "R2", fit: "partial" as const, rationale: "See E7.", evidence_handles: ["E7"] },
        ...goodReport.assessments.slice(2).map((assessment) => ({ ...assessment, fit: assessment.fit as "weak" | "missing" })),
      ],
    };
    const issues = findReportIssues(output, requirements, context.evidence);
    assert.ok(issues.some((issue) => issue.startsWith("R1:") && issue.includes("requires")));
    assert.ok(issues.some((issue) => issue.startsWith("R2:") && issue.includes("not provided")));

    const safe = applySafeDowngrades(output, requirements, context.evidence);
    assert.equal(safe.assessments[0].fit, "missing");
    assert.equal(safe.assessments[1].fit, "missing");
    assert.equal(safe.downgradedClaimCount, 2);
  });

  it("stops weak or missing labels from hiding unsupported positive claims in rationale text", () => {
    const output = {
      assessments: [
        goodReport.assessments[0],
        goodReport.assessments[1],
        { requirement_id: "R3", fit: "weak" as const, rationale: "E1 and E2 prove deep pipeline expertise.", evidence_handles: ["E3"] },
        { requirement_id: "R4", fit: "missing" as const, rationale: "Actually E1 shows Kubernetes.", evidence_handles: ["E1"] },
      ].map((assessment) => ({ ...assessment, fit: assessment.fit as "strong" | "partial" | "weak" | "missing" })),
    };
    const issues = findReportIssues(output, requirements, context.evidence);
    assert.ok(issues.some((issue) => issue.startsWith("R3:") && issue.includes("does not cite")));
    assert.ok(issues.some((issue) => issue.startsWith("R4:") && issue.includes("must not cite")));

    const safe = applySafeDowngrades(output, requirements, context.evidence);
    assert.equal(safe.assessments[2].rationale, REMOVED_CLAIM_RATIONALE);
    assert.equal(safe.assessments[3].fit, "missing");
    assert.deepEqual(safe.assessments[3].citations, []);
    assert.equal(safe.assessments[3].rationale, REMOVED_CLAIM_RATIONALE);
  });

  it("removes numeric fit scores from rationale text", () => {
    const output = {
      assessments: [
        { requirement_id: "R1", fit: "strong" as const, rationale: "E1 is a 95% match.", evidence_handles: ["E1"] },
        ...goodReport.assessments.slice(1).map((assessment) => ({ ...assessment, fit: assessment.fit as "partial" | "weak" | "missing" })),
      ],
    };
    assert.ok(findReportIssues(output, requirements, context.evidence).some((issue) => issue.includes("numeric")));
    const safe = applySafeDowngrades(output, requirements, context.evidence);
    assert.equal(safe.assessments[0].fit, "weak");
    assert.doesNotMatch(safe.assessments[0].rationale, /95%/);
  });
});
