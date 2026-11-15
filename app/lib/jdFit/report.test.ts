import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JD_FIT_REPORT_PROMPT_VERSION } from "./config";
import type { ApprovedRevisionContentRow } from "../experience/approvedSearch";
import { buildEvidenceContext } from "./context";
import { JdFitAssessmentSchema, JdFitError, type JdFitRequirement } from "./contracts";
import { JdFitDeadline, type JdFitModelResponse } from "./generation";
import { evaluateJobDescription } from "./evaluate";
import { generateFitReport } from "./report";
import { resolveCitationLabels, type JdFitLabelLookup } from "./retrieval";
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

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const R1 = "22222222-2222-4222-8222-222222222222";
const R2 = "33333333-3333-4333-8333-333333333333";

function approvedRow(revisionId: string, experiences: unknown[], sourceId = SOURCE_ID): ApprovedRevisionContentRow {
  return { id: revisionId, source_id: sourceId, approved_json: { schema_version: "1", experiences } };
}

function experience(logicalId: string, type: string, title: string | null, items: Array<[string, string]>) {
  return {
    logical_id: logicalId,
    type,
    title: { value: title, source_refs: title ? [{ block_id: "b1", start: 0, end: title.length }] : [] },
    evidence_items: items.map(([id, kind]) => ({ logical_id: id, kind, summary: `${kind} item`, source_refs: [] })),
  };
}

const labelRequirements: JdFitRequirement[] = [
  { requirement_id: "R1", text: "TypeScript APIs", importance: "required", retrieval_query: "TypeScript API" },
];

function labelContext(hit: ReturnType<typeof makeHit>) {
  return buildEvidenceContext(labelRequirements, [{ requirement_id: "R1", hits: [hit] }]);
}

async function citationFor(hit: ReturnType<typeof makeHit>, lookup: JdFitLabelLookup) {
  const context = labelContext(hit);
  await resolveCitationLabels({ evidence: context.evidence, deadline: new JdFitDeadline(120_000), lookup });
  const client = new ScriptedModelClient({
    report: [jsonResponse({ assessments: [{ requirement_id: "R1", fit: "strong", rationale: "E1 shows it.", evidence_handles: ["E1"] }] })],
  });
  const result = await generateFitReport({ requirements: labelRequirements, context, client, deadline: new JdFitDeadline(120_000) });
  return result.assessments[0].citations[0];
}

describe("JD-fit citation context labels", () => {
  it("labels project evidence with its approved title, type and kind", async () => {
    const lookup: JdFitLabelLookup = async () => [
      approvedRow(R1, [experience("exp-atlas", "project", "Project Atlas", [["exp-atlas:ev-1", "contribution"]])]),
    ];
    const citation = await citationFor(makeHit({ chunkRowId: "c1", text: "Built TypeScript REST APIs." }), lookup);
    assert.equal(citation.experience_title, "Project Atlas");
    assert.equal(citation.experience_type, "project");
    assert.deepEqual(citation.evidence_kinds, ["contribution"]);
    assert.equal(citation.quote, "Built TypeScript REST APIs.");
    assert.deepEqual(citation.source_span, { block_id: "b1", start: 0, end: 27 });
  });

  it("keeps an untitled general experience untitled", async () => {
    const lookup: JdFitLabelLookup = async () => [
      approvedRow(R1, [experience("exp-general", "general-experience", null, [["exp-general:ev-1", "responsibility"]])]),
    ];
    const hit = makeHit({ chunkRowId: "c1", text: "Owned on-call rotations.", logicalExperienceId: "exp-general" });
    const citation = await citationFor(hit, lookup);
    assert.equal(citation.experience_title, null);
    assert.equal(citation.experience_type, "general-experience");
    assert.deepEqual(citation.evidence_kinds, ["responsibility"]);
  });

  it("lists each distinct kind of a multi-evidence chunk once, in approved order", async () => {
    const lookup: JdFitLabelLookup = async () => [
      approvedRow(R1, [
        experience("exp-atlas", "project", "Project Atlas", [
          ["exp-atlas:ev-1", "decision"],
          ["exp-atlas:ev-2", "contribution"],
          ["exp-atlas:ev-3", "decision"],
          ["exp-atlas:ev-4", "outcome"],
        ]),
      ]),
    ];
    const hit = makeHit({
      chunkRowId: "c1",
      text: "Chose Postgres and shipped the billing API.",
      evidenceLogicalIds: ["exp-atlas:ev-4", "exp-atlas:ev-3", "exp-atlas:ev-2", "exp-atlas:ev-1", "exp-atlas:ev-missing"],
    });
    const citation = await citationFor(hit, lookup);
    assert.deepEqual(citation.evidence_kinds, ["decision", "contribution", "outcome"]);
  });

  it("reads labels from the cited revision R1 while R2 is approved but not published", async () => {
    let requested: { revisionIds: string[]; sourceIds: string[] } | null = null;
    const lookup: JdFitLabelLookup = async (revisionIds, sourceIds) => {
      requested = { revisionIds, sourceIds };
      return [
        approvedRow(R2, [experience("exp-atlas", "project", "Project Atlas v2", [["exp-atlas:ev-1", "outcome"]])]),
        approvedRow(R1, [experience("exp-atlas", "project", "Project Atlas", [["exp-atlas:ev-1", "contribution"]])]),
      ];
    };
    const citation = await citationFor(makeHit({ chunkRowId: "c1", text: "Built TypeScript REST APIs.", revisionId: R1 }), lookup);
    assert.deepEqual(requested, { revisionIds: [R1], sourceIds: [SOURCE_ID] });
    assert.equal(citation.revision_id, R1);
    assert.equal(citation.experience_title, "Project Atlas");
    assert.deepEqual(citation.evidence_kinds, ["contribution"]);
  });

  it("ignores content whose source does not match the cited source", async () => {
    const lookup: JdFitLabelLookup = async () => [
      approvedRow(R1, [experience("exp-atlas", "project", "Elsewhere", [["exp-atlas:ev-1", "outcome"]])], "other-source"),
    ];
    const citation = await citationFor(makeHit({ chunkRowId: "c1", text: "Built TypeScript REST APIs." }), lookup);
    assert.equal(citation.experience_title, null);
    assert.deepEqual(citation.evidence_kinds, []);
  });

  it("still returns the report with unlabelled citations when the lookup fails", async () => {
    const lookup: JdFitLabelLookup = async () => {
      throw new Error("read failed");
    };
    const model = new ScriptedModelClient({
      requirements: [jsonResponse({ requirements: [{ text: "TypeScript APIs", importance: "required", retrieval_query: "TypeScript API" }] })],
      report: [jsonResponse({ assessments: [{ requirement_id: "R1", fit: "strong", rationale: "E1 shows it.", evidence_handles: ["E1"] }] })],
    });
    const search = async () => [makeHit({ chunkRowId: "c1", text: "Built TypeScript REST APIs." })];
    const report = await evaluateJobDescription({ jdText: "Backend engineer" }, { client: model, search, labelLookup: lookup });
    const citation = report.assessments[0].citations[0];
    assert.equal(report.status, "evaluated");
    assert.equal(citation.experience_title, null);
    assert.equal(citation.experience_type, "project");
    assert.deepEqual(citation.evidence_kinds, []);
    assert.equal(citation.quote, "Built TypeScript REST APIs.");
  });

  it("falls back when the cited logical experience is absent from the approved content", async () => {
    const lookup: JdFitLabelLookup = async () => [approvedRow(R1, [experience("exp-other", "project", "Other", [])])];
    const citation = await citationFor(makeHit({ chunkRowId: "c1", text: "Built TypeScript REST APIs." }), lookup);
    assert.equal(citation.experience_title, null);
    assert.deepEqual(citation.evidence_kinds, []);
  });
});
