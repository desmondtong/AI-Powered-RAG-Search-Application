import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { POST } from "../../api/jd-fit/route";
import { JdFitErrorResponseSchema, JdFitResponseSchema } from "./contracts";
import { handleJdFitRequest } from "./http";
import type { JdFitSearch } from "./retrieval";
import { ScriptedModelClient, jsonResponse, makeHit, scriptedSearch } from "./testFixtures";

const URL_BASE = "http://localhost:3000/api/jd-fit";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", "sec-fetch-site": "same-origin", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const requirementsOutput = {
  requirements: [
    { text: "TypeScript APIs", importance: "required", retrieval_query: "TypeScript API" },
    { text: "Kubernetes", importance: "preferred", retrieval_query: "Kubernetes" },
  ],
};

const reportOutput = {
  assessments: [
    { requirement_id: "R1", fit: "strong", rationale: "E1 shows TypeScript APIs.", evidence_handles: ["E1"] },
    { requirement_id: "R2", fit: "missing", rationale: "No evidence mentions Kubernetes.", evidence_handles: [] },
  ],
};

function evidenceSearch() {
  return scriptedSearch({ "TypeScript API": [makeHit({ chunkRowId: "c1", text: "Built TypeScript REST APIs." })] });
}

async function errorOf(response: Response) {
  const body = JdFitErrorResponseSchema.parse(await response.json());
  return body.error;
}

describe("POST /api/jd-fit", () => {
  it("returns a successful cited report", async () => {
    const client = new ScriptedModelClient({ requirements: [jsonResponse(requirementsOutput)], report: [jsonResponse(reportOutput)] });
    const searched = evidenceSearch();
    const response = await handleJdFitRequest(request({ jdText: "Backend engineer" }), { client, search: searched.search });

    assert.equal(response.status, 200);
    const report = JdFitResponseSchema.parse(await response.json());
    assert.equal(report.status, "evaluated");
    assert.equal(report.assessments[0].citations[0].quote, "Built TypeScript REST APIs.");
    assert.deepEqual(report.gaps.map((gap) => gap.requirement_id), ["R2"]);
    assert.equal(report.diagnostics.requirement_prompt_version, "jd-fit-requirements-v1");
    assert.equal(searched.calls.length, 2);
  });

  it("rejects an empty JD before any model or search call", async () => {
    const client = new ScriptedModelClient({});
    const searched = evidenceSearch();
    const response = await handleJdFitRequest(request({ jdText: "   " }), { client, search: searched.search });
    assert.equal(response.status, 400);
    assert.equal((await errorOf(response)).code, "jd-required");
    assert.equal(client.calls.length + searched.calls.length, 0);
  });

  it("rejects malformed JSON and non-string JD text", async () => {
    assert.equal((await errorOf(await handleJdFitRequest(request("{oops")))).code, "invalid-request");
    assert.equal((await errorOf(await handleJdFitRequest(request({ jdText: 42 })))).code, "invalid-request");
  });

  it("rejects a source selection before retrieval", async () => {
    const client = new ScriptedModelClient({});
    const searched = evidenceSearch();
    const response = await handleJdFitRequest(request({ jdText: "Backend engineer", sourceIds: [] }), {
      client,
      search: searched.search,
    });
    assert.equal(response.status, 400);
    const error = await errorOf(response);
    assert.equal(error.code, "unsupported-request-field");
    assert.deepEqual(error.details, { fields: ["sourceIds"] });
    assert.equal(client.calls.length + searched.calls.length, 0);
  });

  it("rejects cross-origin requests before any work", async () => {
    const client = new ScriptedModelClient({});
    const hostile: Array<Record<string, string>> = [
      { origin: "https://evil.example" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
    ];
    for (const headers of hostile) {
      const response = await handleJdFitRequest(request({ jdText: "Backend engineer" }, headers), { client });
      assert.equal(response.status, 403);
      assert.equal((await errorOf(response)).code, "cross-origin-rejected");
    }
    assert.equal(client.calls.length, 0);
  });

  it("reports no active evidence without calling the report model", async () => {
    const client = new ScriptedModelClient({ requirements: [jsonResponse(requirementsOutput)] });
    const response = await handleJdFitRequest(request({ jdText: "Backend engineer" }), { client, search: scriptedSearch({}).search });
    const report = JdFitResponseSchema.parse(await response.json());
    assert.equal(report.status, "no_evidence");
    assert.ok(report.assessments.every((assessment) => assessment.fit === "missing" && assessment.citations.length === 0));
    assert.equal(client.phaseCalls("report").length, 0);
    assert.equal(report.diagnostics.generation.report_generated, false);
  });

  it("returns a retryable timeout and no partial report when the deadline is exceeded", async () => {
    const client = new ScriptedModelClient({ requirements: [jsonResponse(requirementsOutput)], report: [jsonResponse(reportOutput)] });
    const slow: JdFitSearch = () => new Promise((resolve) => setTimeout(() => resolve([]), 200));
    const response = await handleJdFitRequest(request({ jdText: "Backend engineer" }), { client, search: slow, deadlineMs: 50 });
    assert.equal(response.status, 504);
    const error = await errorOf(response);
    assert.equal(error.code, "deadline-exceeded");
    assert.equal(error.retryable, true);
  });

  it("returns a retryable error when the model fails", async () => {
    const client = new ScriptedModelClient({ requirements: [{ promptFeedback: { blockReason: "SAFETY" } }] });
    const response = await handleJdFitRequest(request({ jdText: "Backend engineer" }), { client });
    assert.equal(response.status, 502);
    const error = await errorOf(response);
    assert.equal(error.code, "model-blocked");
    assert.equal(error.retryable, true);
  });

  it("hides unexpected internal errors", async () => {
    const client = new ScriptedModelClient({ requirements: [new Error("SUPABASE_SERVICE_ROLE_KEY=secret leaked")] });
    const original = console.error;
    console.error = () => {};
    try {
      const response = await handleJdFitRequest(request({ jdText: "Backend engineer" }), { client });
      assert.equal(response.status, 500);
      const error = await errorOf(response);
      assert.equal(error.code, "jd-fit-failed");
      assert.doesNotMatch(JSON.stringify(error), /secret|SUPABASE/);
    } finally {
      console.error = original;
    }
  });

  it("wires the route file to the same handler", async () => {
    const crossOrigin = await POST(request({ jdText: "Backend engineer" }, { origin: "https://evil.example" }));
    assert.equal(crossOrigin.status, 403);
    const withSources = await POST(request({ jdText: "Backend engineer", sourceIds: ["x"] }));
    assert.equal((await errorOf(withSources)).code, "unsupported-request-field");
  });
});
