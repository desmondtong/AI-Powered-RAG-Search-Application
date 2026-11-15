// Run against a loopback Next preview with dummy credentials. Every API request
// is intercepted; unexpected APIs and external requests are blocked.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const base = new URL(process.env.EXPERIENCE_PREVIEW_URL || "http://127.0.0.1:3033");
assert.ok(["127.0.0.1", "localhost"].includes(base.hostname), "Loopback preview required");
const browser = await chromium.launch({ headless: true });
const reports = [];

try {
  for (const scenario of ["newer-approved", "newer-published", "refresh-failure", "lease-conflict"]) {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const posts = [];
    const unexpected = [];
    const pageErrors = [];
    let reads = 0;
    let conflicted = false;
    let refreshFails = scenario === "refresh-failure";
    let published = false;
    // r0 = version 1 (searchable), r1 = version 2 (the candidate this page indexes), r2 = version 3 (approved later).
    const VERSIONS = { r0: 1, r1: 2, r2: 3 };
    const indexedNow = () => published || (conflicted && scenario === "newer-published");
    const summary = () => {
      const latest = conflicted && scenario !== "lease-conflict" ? "r2" : "r1";
      const active = indexedNow() ? "r2" : "r0";
      return {
        id: "retry-fixture",
        file_name: "Synthetic retry fixture.docx",
        status: indexedNow() ? "indexed" : "approved",
        latest_approved_revision_id: latest,
        active_revision_id: active,
        latest_draft_revision_id: null,
        active_version_number: VERSIONS[active],
        latest_approved_version_number: VERSIONS[latest],
        actions: indexedNow() ? [] : ["index"],
        failure: null,
        cleanup_error: null,
      };
    };
    const detail = () => {
      const source = summary();
      const approved = ["r0", "r1", ...(source.latest_approved_revision_id === "r2" ? ["r2"] : [])];
      return {
        source,
        latest_extraction: { id: "x1", blocks: [], warnings: [] },
        latest_revision: { id: source.latest_approved_revision_id, status: source.status, draft_version: 1, draft_json: null },
        approved_versions: approved.map((id) => ({
          revision_id: id,
          version_number: VERSIONS[id],
          approved_at: `2026-11-1${VERSIONS[id]}T10:00:00.000Z`,
        })),
      };
    };
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base.origin) {
        unexpected.push(request.url());
        return route.abort();
      }
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (url.pathname === "/api/experiences" && request.method() === "GET") {
        // The shared workspace summary (top-bar pill); not counted as a detail refresh.
        return route.fulfill({ json: { sources: [summary()] } });
      }
      if (url.pathname === "/api/experiences/retry-fixture" && request.method() === "GET") {
        reads++;
        return route.fulfill({
          status: conflicted && refreshFails ? 503 : 200,
          json: conflicted && refreshFails ? { error: { message: "Synthetic refresh unavailable" } } : detail(),
        });
      }
      if (url.pathname === "/api/experiences/retry-fixture/index" && request.method() === "POST") {
        posts.push(request.postDataJSON().revision_id);
        if (!conflicted) {
          conflicted = true;
          return route.fulfill({
            status: 409,
            json: { error: {
              code: scenario === "lease-conflict" ? "execution-conflict" : "index-candidate-stale",
              message: scenario === "lease-conflict"
                ? "Another execution owns this lease."
                : "This indexing request is outdated. Refresh and review the latest approved revision before indexing again.",
            } },
          });
        }
        published = true;
        return route.fulfill({ json: { status: "indexed", progress: { total_chunks: 4, prepared_chunks: 4, remaining_chunks: 0 } } });
      }
      unexpected.push(request.url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(new URL("/experience/retry-fixture", base).href);
    const indexNow = page.getByRole("button", { name: "Index now", exact: true });
    await indexNow.waitFor({ state: "visible" });
    const beforeReads = reads;
    const text = () => page.locator("body").innerText();
    // Revisions are named by version number; no revision ID reaches the main view.
    await page.locator("body").ariaSnapshot();
    assert.match(await text(), /Approved version 2 · ready for indexing/);
    assert.doesNotMatch(await text(), /\br[012]\b/);
    assert.equal(context.pages().length, 1);
    await indexNow.click();
    await page.getByText(scenario === "lease-conflict" ? "Another execution owns this lease." : "A newer approved version exists.").first().waitFor();
    await page.waitForTimeout(600);
    assert.deepEqual(posts, ["r1"], "Conflict must not retry or retarget automatically");
    assert.equal(reads, beforeReads + 1, "Conflict must refresh once");

    if (scenario === "refresh-failure") {
      assert.equal(await indexNow.isDisabled(), true, "Index actions stay disabled while the refresh fails");
      assert.match(await text(), /The state could not be refreshed: .*Indexing stays stopped until a refresh succeeds\./);
      assert.equal(await page.getByRole("button", { name: "Index version 3", exact: true }).count(), 0);
      refreshFails = false;
      await page.locator("body").ariaSnapshot();
      await page.getByRole("button", { name: "Refresh state", exact: true }).click();
      await page.getByRole("button", { name: "Index version 3", exact: true }).waitFor();
      assert.equal(reads, beforeReads + 2);
      assert.deepEqual(posts, ["r1"], "Manual refresh must not index");
    }
    if (scenario === "newer-approved" || scenario === "refresh-failure") {
      await page.locator("body").ariaSnapshot();
      const snapshot = await text();
      assert.match(snapshot, /Searchable now\s*version 1/i);
      assert.match(snapshot, /Latest approved\s*version 3/i);
      assert.match(snapshot, /Not indexed\s*version 2 \(superseded\)/i);
      assert.match(snapshot, /Version 1 is still the one Fit Check searches\./);
      assert.equal(await page.getByRole("button", { name: "Look at version 3 first", exact: true }).count(), 1);
      await page.getByRole("button", { name: "Index version 3", exact: true }).click();
      await page.getByRole("link", { name: "Try a job description" }).waitFor();
      assert.deepEqual(posts, ["r1", "r2"], "Only an explicit Index version N may target the refreshed candidate");
    } else if (scenario === "newer-published") {
      const snapshot = await text();
      assert.match(snapshot, /Searchable now\s*version 3/i);
      assert.match(snapshot, /Latest approved\s*version 3/i);
      assert.equal(await page.getByRole("button", { name: "Index version 3", exact: true }).count(), 0);
      assert.equal(await indexNow.count(), 0);
    } else if (scenario === "lease-conflict") {
      const snapshot = await text();
      assert.match(snapshot, /Indexing stopped/);
      assert.doesNotMatch(snapshot, /A newer approved version exists/);
    }
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(unexpected, [], "No real or unmocked API request may escape");
    reports.push({ scenario, status: "PASS", posts, detailReads: reads, externalRequests: unexpected.length });
    await context.close();
  }
  console.log(JSON.stringify({ status: "PASS", checks: reports }, null, 2));
} finally {
  await browser.close();
}
