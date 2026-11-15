import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validResponseFixture } from "./contracts.test";
import {
  FIT_GROUP_ORDER,
  FIT_LABEL_DISPLAY,
  buildJdFitRequestBody,
  citationCaption,
  citationHref,
  countByFit,
  groupAssessmentsByFit,
  interpretJdFitResponse,
  networkErrorState,
  reportHeaderLine,
} from "./ui";

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

  it("groups assessments Strong, Partial, Weak, Missing in report order", () => {
    assert.deepEqual(FIT_GROUP_ORDER, ["strong", "partial", "weak", "missing"]);
    const fixture = validResponseFixture();
    const groups = groupAssessmentsByFit(fixture);
    assert.deepEqual(groups.map((group) => group.fit), ["strong", "partial", "weak", "missing"]);
    assert.deepEqual(groups.map((group) => group.items.map((item) => item.assessment.requirement_id)), [["R1"], [], [], ["R2"]]);
    assert.equal(groups[0].items[0].requirement?.text, fixture.requirements[0].text);
  });

  it("captions citations with file, experience title and kinds", () => {
    const base = validResponseFixture().assessments[0].citations[0];
    assert.equal(
      citationCaption({ ...base, source_file_name: "atlas.docx", experience_title: "Project Atlas", experience_type: "project", evidence_kinds: ["contribution", "outcome"] }),
      "atlas.docx · Project Atlas · contribution, outcome",
    );
    assert.equal(
      citationCaption({ ...base, source_file_name: "cv.docx", experience_title: null, experience_type: "general-experience", evidence_kinds: ["responsibility"] }),
      "cv.docx · General experience · responsibility",
    );
    assert.equal(citationCaption({ ...base, source_file_name: "cv.docx", experience_title: null, experience_type: "project", evidence_kinds: [] }), "cv.docx");
    assert.equal(citationCaption({ ...base, source_file_name: "", experience_title: "Beacon", experience_type: "project", evidence_kinds: [] }), "Experience file · Beacon");
  });

  it("links citations to the file page with the cited span and revision", () => {
    const base = validResponseFixture().assessments[0].citations[0];
    assert.equal(
      citationHref({ source_id: "src-1", revision_id: "rev-9", source_span: { block_id: "block-0002", start: 4, end: 31 } }),
      "/experience/src-1?cite=block-0002:4:31&rev=rev-9",
    );
    assert.equal(
      citationHref(base),
      `/experience/${base.source_id}?cite=${base.source_span.block_id}:${base.source_span.start}:${base.source_span.end}&rev=${base.revision_id}`,
    );
  });

  it("never shows a numeric score or percentage", () => {
    for (const fit of FIT_GROUP_ORDER) {
      assert.doesNotMatch(FIT_LABEL_DISPLAY[fit].text, /\d|%/);
      assert.match(FIT_LABEL_DISPLAY[fit].className, /fit-/);
      assert.doesNotMatch(FIT_LABEL_DISPLAY[fit].className, /dark:|#/);
    }
    const base = validResponseFixture().assessments[0].citations[0];
    assert.doesNotMatch(citationCaption({ ...base, experience_title: "Atlas", evidence_kinds: ["outcome"] }), /%/);
    assert.equal(reportHeaderLine(3, 2, 4210), "3 requirements · 2 files searched · 4.2 s");
    assert.equal(reportHeaderLine(1, null, null), "1 requirement");
    const report = [read("app/components/FitReport.tsx"), read("app/components/JdFitPanel.tsx")].join("\n");
    assert.doesNotMatch(report, /score|percent|%\}/i);
  });

  it("renders the JD-fit panel directly on the home page and calls /api/jd-fit only", () => {
    const page = read("app/page.tsx");
    const panel = read("app/components/JdFitPanel.tsx");
    const report = read("app/components/FitReport.tsx");
    const ui = read("app/lib/jdFit/ui.ts");

    assert.match(page, /<JdFitPanel \/>/);
    assert.doesNotMatch(page, /role="tablist"/);
    assert.doesNotMatch(page, /\/api\/search/);
    assert.doesNotMatch(page, /\/api\/jd-fit/);

    assert.match(panel, /fetch\(JD_FIT_ENDPOINT/);
    assert.equal((panel.match(/fetch\(/g) ?? []).length, 1, "the panel sends only the JD-fit request");
    assert.match(panel, /body: buildJdFitRequestBody\(jdText\)/);
    assert.match(ui, /JD_FIT_ENDPOINT = "\/api\/jd-fit"/);
    for (const file of [page, panel, report, ui]) {
      assert.doesNotMatch(file, /\/api\/experiences/);
      assert.doesNotMatch(file, /sourceIds/);
    }
    assert.doesNotMatch(panel, /\/api\/search/);
    assert.doesNotMatch(report, /fetch\(/);
  });

  it("renders every documented UI state in the panel and report", () => {
    const panel = read("app/components/JdFitPanel.tsx");
    const report = read("app/components/FitReport.tsx");
    for (const marker of [
      "{loading && (",
      'view.kind === "error"',
      "view.retryable",
      "Try again",
      "FitEmptyState",
      "disabled={empty}",
      "const empty = indexedCount === 0;",
      'href="/experience"',
      "<FitReport",
    ]) {
      assert.ok(panel.includes(marker), `panel is missing ${marker}`);
    }
    for (const marker of [
      'report.status === "no_evidence"',
      "No approved evidence available",
      "report.gaps",
      "citation.quote",
      "citationCaption(citation)",
      "citationHref(citation)",
      "Open in source",
      "RequirementCard",
      "GapsPanel",
      "Diagnostics",
      "<details",
      "FIT_GROUP_ORDER.map",
      'href="/experience"',
    ]) {
      assert.ok(report.includes(marker), `report is missing ${marker}`);
    }
  });
});
