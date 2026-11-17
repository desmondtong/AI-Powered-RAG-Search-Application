import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** The Experience list page and the components it renders. */
function listSurface() {
  return [
    "app/experience/page.tsx",
    "app/experience/_components/DropZone.tsx",
    "app/experience/_components/ExperienceRow.tsx",
    "app/experience/_components/HowItWorks.tsx",
  ].map((path) => ({ path, text: read(path) }));
}

describe("experience list page contracts", () => {
  it("reads sources through the shared workspace summary provider", () => {
    const page = read("app/experience/page.tsx");
    assert.match(page, /useWorkspaceSummary\(\)/);
    assert.doesNotMatch(page, /fetch\(/, "the list page itself does not fetch; the provider does");
    assert.match(read("app/components/WorkspaceSummaryProvider.tsx"), /fetch\("\/api\/experiences"/);
  });

  it("uploads inline to the experience API and opens the new file's page", () => {
    const dropZone = read("app/experience/_components/DropZone.tsx");
    assert.match(read("app/lib/experience/uploadUi.ts"), /endpoint: "\/api\/experiences"/);
    assert.match(dropZone, /fetch\(config\.endpoint, \{ method: "POST", body: formData \}\)/);
    assert.match(dropZone, /shouldAutostart\(body\)/);
    assert.match(dropZone, /sessionStorage\.setItem\(autostartKey\(sourceId\)/);
    assert.match(dropZone, /router\.push\(`\/experience\/\$\{sourceId\}`\)/);
    assert.match(dropZone, /role="alert"/, "upload errors are shown in place");
  });

  it("rejects an oversized file before building the upload request", () => {
    const dropZone = read("app/experience/_components/DropZone.tsx");
    const check = dropZone.indexOf("oversizedUploadMessage(file)");
    const formData = dropZone.indexOf("new FormData()");
    const request = dropZone.indexOf("fetch(config.endpoint");
    assert.ok(check > -1, "the drop zone checks the size");
    assert.ok(check < formData && check < request, "the size check runs before any FormData or fetch");
    const guardEnd = dropZone.indexOf("setError(null)", check);
    assert.ok(guardEnd > check, "the normal path clears the error after the size guard");
    const guard = dropZone.slice(check, guardEnd);
    assert.match(guard, /setError\(tooLarge\)/, "the message goes to the existing in-place error slot");
    assert.match(guard, /return;/, "the oversized path returns without uploading");
    assert.doesNotMatch(guard, /setUploading\(/, "the zone never enters the uploading state, so it stays usable");
  });

  it("has no modal, auto-closing timer or comma-joined action text", () => {
    for (const { path, text } of listSurface()) {
      for (const retired of ["UploadModal", "actions.join", "setTimeout", "window.confirm", "confirm("]) {
        assert.equal(text.includes(retired), false, `${path} must not contain ${retired}`);
      }
    }
    assert.equal(existsSync(join(process.cwd(), "app/components/UploadModal.tsx")), false);
  });

  it("links every row to its file page and renders one primary action from the stage view", () => {
    const row = read("app/experience/_components/ExperienceRow.tsx");
    assert.match(row, /`\/experience\/\$\{source\.id\}`/);
    assert.match(row, /toStageView\(source\)/);
    assert.match(row, /view\.primary/);
    assert.match(row, /<OverflowMenu/);
    assert.match(row, /<DotStepper/);
  });

  it("explains the six stages once, in a collapsed How it works disclosure", () => {
    const page = read("app/experience/page.tsx");
    assert.equal(existsSync(join(process.cwd(), "app/experience/_components/StageLegend.tsx")), false);
    assert.equal((page.match(/<HowItWorks \/>/g) ?? []).length, 1);
    const howItWorks = read("app/experience/_components/HowItWorks.tsx");
    assert.match(howItWorks, /<Disclosure\b/);
    assert.doesNotMatch(howItWorks, /defaultOpen/, "collapsed by default");
    assert.doesNotMatch(page, /subtitle|HOW_IT_WORKS/, "no subtitle and no inline stage explanation on the page");
  });

  it("opens the file page from anywhere on the row except its controls, and shows no button for quiet states", () => {
    const row = read("app/experience/_components/ExperienceRow.tsx");
    assert.match(row, /router\.push\(href\)/);
    assert.match(row, /closest\("a, button, \[role='menu'\]"\)/);
    assert.ok(row.indexOf("closest(") < row.indexOf("router.push(href)"), "the control check runs before navigation");
    assert.match(row, /getSelection\(\)/, "a text selection does not navigate");
    assert.doesNotMatch(row, /href="\/"/, "no row button links to Fit Check");
    assert.doesNotMatch(row, /Working…/, "running rows carry only their stepper and label");
    assert.doesNotMatch(row, /try-jd|Try a job description/);
  });

  it("renders a row helper only when the stage view provides one", () => {
    const row = read("app/experience/_components/ExperienceRow.tsx");
    assert.match(row, /view\.helper &&/);
    assert.match(row, /view\.metaFact/);
  });

  it("has no generic document section, route or preview", () => {
    for (const { path, text } of listSurface()) {
      for (const retired of ["Generic Documents", "/api/documents", "PDFViewerModal", "fetchDocuments"]) {
        assert.equal(text.includes(retired), false, `${path} must not reference ${retired}`);
      }
    }
  });
});
