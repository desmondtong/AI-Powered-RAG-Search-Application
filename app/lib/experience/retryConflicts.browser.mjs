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
    const detail = () => ({
      source: {
        id: "retry-fixture",
        file_name: "Synthetic retry fixture.docx",
        status: published || (conflicted && scenario === "newer-published") ? "indexed" : "approved",
        latest_approved_revision_id: conflicted && scenario !== "lease-conflict" ? "r2" : "r1",
        active_revision_id: published || (conflicted && scenario === "newer-published") ? "r2" : "r0",
        latest_draft_revision_id: null,
        actions: published || (conflicted && scenario === "newer-published") ? [] : ["index"],
        failure: null,
        cleanup_error: null,
      },
      latest_extraction: { blocks: [], warnings: [] },
      latest_revision: {
        id: conflicted ? "r2" : "r1",
        status: published || (conflicted && scenario === "newer-published") ? "indexed" : "approved",
        draft_json: null,
      },
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base.origin) {
        unexpected.push(request.url());
        return route.abort();
      }
      if (!url.pathname.startsWith("/api/")) return route.continue();
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
        return route.fulfill({ json: { status: "indexed", progress: null } });
      }
      unexpected.push(request.url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(new URL("/experiences/retry-fixture", base).href);
    const index = page.getByRole("button", { name: "Index", exact: true });
    await index.waitFor({ state: "visible" });
    const beforeReads = reads;
    // Capture the rendered structure before interacting, including the two IDs.
    await page.locator("body").ariaSnapshot();
    assert.match(await page.locator("body").innerText(), /Approved:\s*r1/);
    assert.equal(context.pages().length, 1);
    await index.click();
    await page.getByText(scenario === "lease-conflict" ? "Another execution owns this lease." : /This indexing request is outdated/).waitFor();
    await page.waitForTimeout(600);
    assert.deepEqual(posts, ["r1"], "Conflict must not retry or retarget automatically");
    assert.equal(reads, beforeReads + 1, "Conflict must refresh once");

    if (scenario === "refresh-failure") {
      assert.equal(await index.isDisabled(), true);
      assert.match(await page.locator("body").innerText(), /State refresh failed:.*Indexing is stopped/);
      refreshFails = false;
      await page.locator("body").ariaSnapshot();
      await page.getByRole("button", { name: "Refresh State", exact: true }).click();
      await page.getByText("r2", { exact: false }).first().waitFor();
      assert.equal(reads, beforeReads + 2);
      assert.deepEqual(posts, ["r1"], "Manual refresh must not index");
    }
    if (scenario === "newer-approved" || scenario === "refresh-failure") {
      await page.locator("body").ariaSnapshot();
      const snapshot = await page.locator("body").innerText();
      assert.match(snapshot, /Approved:\s*r2/);
      assert.match(snapshot, /Active:\s*r0/);
      assert.match(snapshot, /remains searchable until the approved replacement/);
      await index.click();
      await page.getByText("Indexing complete.", { exact: true }).waitFor();
      assert.deepEqual(posts, ["r1", "r2"], "Only explicit Index may target refreshed candidate");
    } else if (scenario === "newer-published") {
      const snapshot = await page.locator("body").innerText();
      assert.match(snapshot, /Approved:\s*r2/);
      assert.match(snapshot, /Active:\s*r2/);
      assert.equal(await index.count(), 0);
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
