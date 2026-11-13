import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validResponseFixture } from "./contracts.test";
import { FIT_LABEL_DISPLAY, buildJdFitRequestBody, countByFit, interpretJdFitResponse, networkErrorState } from "./ui";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("JD-fit Search page states", () => {
  it("renders a cited report with categories, gaps, and counts", () => {
    const state = interpretJdFitResponse(200, validResponseFixture());
    assert.equal(state.kind, "report");
    if (state.kind !== "report") return;
    assert.deepEqual(countByFit(state.report), { strong: 1, partial: 0, weak: 0, missing: 1 });
    assert.equal(state.report.assessments[0].citations[0].quote, "Built TypeScript REST APIs for billing.");
    assert.deepEqual(state.report.gaps.map((gap) => gap.requirement_id), ["R2"]);
    for (const label of ["strong", "partial", "weak", "missing"] as const) {
      assert.ok(FIT_LABEL_DISPLAY[label].text);
    }
  });

  it("renders the no-evidence state", () => {
    const fixture = validResponseFixture();
    const noEvidence = {
      ...fixture,
      status: "no_evidence",
      assessments: fixture.requirements.map((requirement) => ({
        requirement_id: requirement.requirement_id,
        fit: "missing",
        rationale: "No approved experience evidence was found for this requirement.",
        citations: [],
        downgraded: false,
      })),
      gaps: fixture.requirements.map((requirement) => ({
        requirement_id: requirement.requirement_id,
        text: requirement.text,
        importance: requirement.importance,
        fit: "missing",
      })),
    };
    const state = interpretJdFitResponse(200, noEvidence);
    assert.equal(state.kind === "report" && state.report.status, "no_evidence");
  });

  it("marks server and network failures retryable and input errors not retryable", () => {
    const timeout = interpretJdFitResponse(504, {
      error: { code: "deadline-exceeded", message: "JD-fit evaluation exceeded its overall time limit.", retryable: true },
    });
    assert.deepEqual(timeout, {
      kind: "error",
      code: "deadline-exceeded",
      message: "JD-fit evaluation exceeded its overall time limit.",
      retryable: true,
    });
    const tooLong = interpretJdFitResponse(413, {
      error: { code: "jd-too-long", message: "Too long.", retryable: false, details: { length: 30000, max: 20000 } },
    });
    assert.equal(tooLong.kind === "error" && tooLong.retryable, false);
    assert.deepEqual(interpretJdFitResponse(502, null), {
      kind: "error",
      code: "request-failed",
      message: "JD-fit evaluation failed (HTTP 502). Try again.",
      retryable: true,
    });
    assert.equal(interpretJdFitResponse(200, { status: "evaluated" }).kind, "error");
    const offline = networkErrorState();
    assert.equal(offline.kind === "error" && offline.retryable, true);
  });

  it("sends the JD text only, never a source selection", () => {
    assert.deepEqual(JSON.parse(buildJdFitRequestBody("Backend engineer")), { jdText: "Backend engineer" });
  });

  it("keeps generic search on /api/search and JD-fit mode on /api/jd-fit only", () => {
    const page = read("app/page.tsx");
    const panel = read("app/components/JdFitPanel.tsx");
    const ui = read("app/lib/jdFit/ui.ts");

    assert.match(page, /fetch\("\/api\/search"/);
    assert.match(page, /Answer:/);
    assert.match(page, /Sources \(\{sources\.length\}\)/);
    assert.match(page, /role="tablist"/);
    assert.match(page, /<JdFitPanel \/>/);
    assert.doesNotMatch(page, /\/api\/jd-fit/);

    assert.match(panel, /fetch\(JD_FIT_ENDPOINT/);
    assert.match(ui, /JD_FIT_ENDPOINT = "\/api\/jd-fit"/);
    for (const file of [page, panel, ui]) {
      assert.doesNotMatch(file, /\/api\/experiences/);
      assert.doesNotMatch(file, /sourceIds/);
    }
    assert.doesNotMatch(panel, /\/api\/search/);
  });

  it("renders every documented UI state in the panel", () => {
    const panel = read("app/components/JdFitPanel.tsx");
    for (const marker of [
      "{loading && (",
      'view.kind === "error"',
      "view.retryable",
      "Try again",
      'report.status === "no_evidence"',
      "No approved evidence available",
      "report.gaps",
      "citation.quote",
      "Diagnostics",
    ]) {
      assert.ok(panel.includes(marker), `panel is missing ${marker}`);
    }
  });
});
