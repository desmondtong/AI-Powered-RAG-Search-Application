// Browser checks for the application shell: top bar, account menu, appearance and Help.
// Run against a loopback Next preview. Every API request is intercepted; unexpected APIs
// and external requests are blocked.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const base = new URL(process.env.EXPERIENCE_PREVIEW_URL || "http://127.0.0.1:3033");
assert.ok(["127.0.0.1", "localhost"].includes(base.hostname), "Loopback preview required");
const browser = await chromium.launch({ headless: true });
const reports = [];

/** An indexed source summary as `/api/experiences` returns it. */
function indexedSource(id) {
  return {
    id,
    file_name: `Synthetic ${id}.docx`,
    status: "indexed",
    latest_approved_revision_id: `${id}-r1`,
    active_revision_id: `${id}-r1`,
    latest_draft_revision_id: null,
    active_version_number: 1,
    latest_approved_version_number: 1,
    actions: [],
    failure: null,
    cleanup_error: null,
  };
}

/**
 * Runs one scenario in a fresh context. `sources` is what the source list returns; `failApi` makes every API
 * call fail instead. Page errors and escaped requests fail the scenario.
 */
async function scenario(name, options, body) {
  const { sources = [], failApi = false, contextOptions = {} } = options;
  const context = await browser.newContext({ serviceWorkers: "block", ...contextOptions });
  const unexpected = [];
  const pageErrors = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base.origin) {
      unexpected.push(request.url());
      return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (failApi) return route.fulfill({ status: 503, json: { error: { message: "Synthetic outage" } } });
    if (url.pathname === "/api/experiences" && request.method() === "GET") return route.fulfill({ json: { sources } });
    unexpected.push(request.url());
    return route.abort();
  });
  const newPage = async () => {
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(`${name}: ${error.message}`));
    return page;
  };
  try {
    const details = (await body({ context, newPage })) ?? {};
    assert.deepEqual(pageErrors, [], `${name}: page errors`);
    assert.deepEqual(unexpected, [], `${name}: no real or unmocked request may escape`);
    reports.push({ scenario: name, status: "PASS", ...details });
  } finally {
    await context.close();
  }
}

const url = (path) => new URL(path, base).href;

const LIGHT_GROUND = "rgb(244, 246, 249)";
const DARK_GROUND = "rgb(15, 18, 24)";
const STORAGE_KEY = "jdfit:appearance";

/** The page background now. */
const ground = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/**
 * Records the theme in the first animation frame, which runs in the first rendering opportunity, after the
 * render-blocking stylesheet and the head script and before anything is painted.
 */
const FIRST_FRAME_PROBE = `
  requestAnimationFrame(() => {
    window.__firstFrame = {
      theme: document.documentElement.getAttribute("data-theme"),
      ground: getComputedStyle(document.body).backgroundColor,
    };
  });
`;
const firstFrame = async (page) => {
  await page.waitForFunction(() => window.__firstFrame !== undefined);
  return page.evaluate(() => window.__firstFrame);
};

const radio = (page, label) => page.getByRole("radio", { name: new RegExp(`^${label}`) });

async function expectChecked(page, label) {
  await page.waitForFunction(
    (name) => [...document.querySelectorAll('[role="radio"]')].some(
      (el) => el.closest("label")?.textContent?.startsWith(name) && el.getAttribute("aria-checked") === "true",
    ),
    label,
  );
}

try {
  await scenario("shell-loads", {}, async ({ newPage }) => {
    const page = await newPage();
    await page.goto(url("/"));
    await page.getByRole("navigation", { name: "Primary" }).waitFor();
  });

  await scenario("appearance-first-visit-auto", { contextOptions: { colorScheme: "light" } }, async ({ newPage }) => {
    const page = await newPage();
    await page.goto(url("/settings"));
    await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
    assert.match(await page.title(), /Settings.*JD Fit Check/);
    await expectChecked(page, "Auto");
    assert.equal(await page.getByRole("radio").count(), 3);
    assert.equal(await ground(page), LIGHT_GROUND);
    // Auto follows an operating-system change while the page is open.
    await page.emulateMedia({ colorScheme: "dark" });
    assert.equal(await ground(page), DARK_GROUND);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), null);
  });

  await scenario("appearance-dark-on-light", { contextOptions: { colorScheme: "light" } }, async ({ context, newPage }) => {
    await context.addInitScript(FIRST_FRAME_PROBE);
    const page = await newPage();
    await page.goto(url("/settings"));
    await expectChecked(page, "Auto");
    await radio(page, "Dark").click();
    await expectChecked(page, "Dark");
    assert.equal(await ground(page), DARK_GROUND, "Dark applies at once");
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), "dark");
    await page.reload();
    assert.deepEqual(await firstFrame(page), { theme: "dark", ground: DARK_GROUND }, "first frame after reload");
    await expectChecked(page, "Dark");
    await page.goto(url("/experience"));
    assert.deepEqual(await firstFrame(page), { theme: "dark", ground: DARK_GROUND }, "first frame on another page");
    // A fixed choice ignores the operating system.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    assert.equal(await ground(page), DARK_GROUND);
    // Client-side navigation keeps the theme.
    await page.getByRole("link", { name: "Fit Check", exact: true }).click();
    await page.waitForURL(url("/"));
    assert.equal(await ground(page), DARK_GROUND);
  });

  await scenario("appearance-light-on-dark", { contextOptions: { colorScheme: "dark" } }, async ({ context, newPage }) => {
    await context.addInitScript(FIRST_FRAME_PROBE);
    const page = await newPage();
    await page.goto(url("/settings"));
    assert.equal(await ground(page), DARK_GROUND, "Auto on a dark system");
    await radio(page, "Light").click();
    assert.equal(await ground(page), LIGHT_GROUND);
    await page.goto(url("/"));
    assert.deepEqual(await firstFrame(page), { theme: "light", ground: LIGHT_GROUND });
    await page.emulateMedia({ colorScheme: "light" });
    await page.emulateMedia({ colorScheme: "dark" });
    assert.equal(await ground(page), LIGHT_GROUND, "a fixed choice ignores the system");
    // Back to Auto follows the system again.
    await page.goto(url("/settings"));
    await radio(page, "Auto").click();
    assert.equal(await ground(page), DARK_GROUND);
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute("data-theme")), false);
  });

  await scenario("appearance-keyboard", { contextOptions: { colorScheme: "light" } }, async ({ newPage }) => {
    const page = await newPage();
    await page.goto(url("/settings"));
    await expectChecked(page, "Auto");
    await radio(page, "Auto").focus();
    await page.keyboard.press("ArrowRight");
    await expectChecked(page, "Light");
    await page.keyboard.press("ArrowRight");
    await expectChecked(page, "Dark");
    assert.equal(await ground(page), DARK_GROUND);
  });

  await scenario("appearance-other-tab", { contextOptions: { colorScheme: "light" } }, async ({ newPage }) => {
    const other = await newPage();
    await other.goto(url("/"));
    assert.equal(await ground(other), LIGHT_GROUND);
    const page = await newPage();
    await page.goto(url("/settings"));
    await radio(page, "Dark").click();
    await other.waitForFunction((dark) => getComputedStyle(document.body).backgroundColor === dark, DARK_GROUND);
    await radio(page, "Auto").click();
    await other.waitForFunction((light) => getComputedStyle(document.body).backgroundColor === light, LIGHT_GROUND);
  });

  await scenario("appearance-storage-blocked", { contextOptions: { colorScheme: "light" } }, async ({ context, newPage }) => {
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("Storage is blocked", "SecurityError");
        },
      });
    });
    const page = await newPage();
    await page.goto(url("/settings"));
    await expectChecked(page, "Auto");
    assert.equal(await ground(page), LIGHT_GROUND);
    await radio(page, "Dark").click();
    await expectChecked(page, "Dark");
    assert.equal(await ground(page), DARK_GROUND, "the choice still applies to this page view");
    // Next's route announcer is always a role="alert" region; any other alert would be an error shown to the user.
    assert.equal(await page.locator('[role="alert"]:not(#__next-route-announcer__)').count(), 0);
  });

  const IAP_HEADER = { "x-goog-authenticated-user-email": "accounts.google.com:desmond@example.com" };
  const primaryNav = (page) => page.getByRole("navigation", { name: "Primary" });

  await scenario("account-signed-in", { contextOptions: { extraHTTPHeaders: IAP_HEADER } }, async ({ newPage }) => {
    const page = await newPage();
    await page.goto(url("/"));
    const avatar = page.getByRole("button", { name: "Account: desmond@example.com", exact: true });
    await avatar.waitFor();
    assert.equal((await avatar.innerText()).trim(), "D");
    await avatar.click();
    const menu = page.getByRole("menu");
    await menu.waitFor();
    assert.match(await menu.innerText(), /desmond@example\.com/);
    assert.deepEqual(await menu.getByRole("menuitem").allInnerTexts(), ["Settings"]);
    assert.equal(await page.getByText(/sign out|log out|logout/i).count(), 0, "no sign-out anywhere");
    await menu.getByRole("menuitem", { name: "Settings" }).click();
    await page.waitForURL(url("/settings"));
    await menu.waitFor({ state: "hidden" });
    assert.equal(await primaryNav(page).locator('[aria-current="page"]').count(), 0, "Settings is not a destination");
  });

  await scenario("account-anonymous", {}, async ({ newPage }) => {
    const page = await newPage();
    await page.goto(url("/experience"));
    const avatar = page.getByRole("button", { name: "Account", exact: true });
    await avatar.waitFor();
    assert.equal((await avatar.innerText()).trim(), "", "neutral avatar shows an icon, not a letter");
    await avatar.click();
    const menu = page.getByRole("menu");
    await menu.waitFor();
    assert.deepEqual(await menu.getByRole("menuitem").allInnerTexts(), ["Settings"]);
    assert.doesNotMatch(await menu.innerText(), /@/);
  });

  await scenario("account-keyboard", { contextOptions: { extraHTTPHeaders: IAP_HEADER } }, async ({ newPage }) => {
    const page = await newPage();
    await page.goto(url("/"));
    const avatar = page.getByRole("button", { name: /^Account: / });
    for (const key of ["Enter", "Space", "ArrowDown"]) {
      await avatar.focus();
      await page.keyboard.press(key);
      await page.getByRole("menu").waitFor();
      await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitem");
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Settings", `${key} focuses the first item`);
      await page.keyboard.press("Escape");
      await page.getByRole("menu").waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Account: desmond@example.com");
    }
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitem");
    await page.keyboard.press("Enter");
    await page.waitForURL(url("/settings"));
  });

  await scenario(
    "top-bar-phone-width",
    { sources: ["a", "b", "c"].map(indexedSource), contextOptions: { viewport: { width: 375, height: 800 } } },
    async ({ newPage }) => {
      const page = await newPage();
      await page.goto(url("/"));
      const nav = primaryNav(page);
      for (const name of ["Fit Check", "Experience", "Help"]) await nav.getByRole("link", { name, exact: true }).waitFor();
      const pill = page.locator("header p[aria-live]");
      await pill.getByText("3", { exact: true }).waitFor();
      assert.match(await pill.textContent(), /3 files indexed/, "the full wording stays for assistive technology");
      await page.getByRole("button", { name: "Account", exact: true }).waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375), "no horizontal scroll at 375 px");
      for (const locator of [
        ...["Fit Check", "Experience", "Help"].map((name) => nav.getByRole("link", { name, exact: true })),
        pill,
        page.getByRole("button", { name: "Account", exact: true }),
      ]) {
        const box = await locator.boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= 375 && box.y < 56, "every top-bar item is on the one row");
      }
    },
  );

  await scenario("top-bar-wide", { sources: ["a", "b", "c"].map(indexedSource) }, async ({ newPage }) => {
    const page = await newPage();
    await page.goto(url("/"));
    // The visible wording; the phone-only screen-reader copy is the hidden second match.
    await page.locator("header").getByText("3 files indexed", { exact: true }).filter({ visible: true }).waitFor();
    await page.locator("header").getByText("JD Fit Check", { exact: true }).waitFor({ state: "visible" });
    await primaryNav(page).getByRole("link", { name: "Fit Check", exact: true }).and(page.locator('[aria-current="page"]')).waitFor();
  });

  const SECTIONS = ["Fit Check", "Experience", "Settings"];
  // Next keeps previously visited routes in the DOM, hidden, after client-side navigation; look at the shown page only.
  const visibleMain = (page) => page.locator("main").filter({ visible: true });
  const sectionHeadings = (page) => visibleMain(page).locator("section h2");

  await scenario("help-page", {}, async ({ newPage }) => {
    const page = await newPage();
    await page.goto(url("/"));
    await primaryNav(page).getByRole("link", { name: "Help", exact: true }).click();
    await page.waitForURL(url("/help"));
    await page.getByRole("heading", { level: 1, name: "Help" }).waitFor();
    assert.match(await page.title(), /Help.*JD Fit Check/);
    assert.equal(await primaryNav(page).locator('[aria-current="page"]').innerText(), "Help");
    assert.deepEqual(await sectionHeadings(page).allInnerTexts(), SECTIONS);
    const experience = visibleMain(page).locator("section").filter({ has: page.getByRole("heading", { name: "Experience", exact: true }) });
    const stages = await experience.locator("dt").allInnerTexts();
    assert.deepEqual(stages, ["Upload", "Extract", "Parse", "Review", "Approve", "Index"]);
    // The table of contents moves to a section and updates the hash.
    const toc = page.getByRole("navigation", { name: "On this page" });
    assert.deepEqual(await toc.getByRole("link").allInnerTexts(), SECTIONS);
    await toc.getByRole("link", { name: "Settings", exact: true }).click();
    await page.waitForURL(url("/help#settings"));
  });

  await scenario("help-anchor-below-top-bar", { contextOptions: { viewport: { width: 1280, height: 600 } } }, async ({ newPage }) => {
    const page = await newPage();
    await page.goto(url("/help#experience"));
    const heading = page.getByRole("heading", { name: "Experience", level: 2 });
    await heading.waitFor();
    await page.waitForFunction(() => window.scrollY > 0);
    const barHeight = await page.locator("header").first().evaluate((el) => el.getBoundingClientRect().height);
    const top = (await heading.boundingBox()).y;
    assert.ok(top >= barHeight, `heading top ${top} is below the ${barHeight}px top bar`);
    // On wide screens the table of contents stays visible while the sections scroll.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const tocBox = await page.getByRole("navigation", { name: "On this page" }).boundingBox();
    assert.ok(tocBox.y >= barHeight && tocBox.y < 600, "the sticky table of contents stays in view");
  });

  await scenario("help-phone-width", { contextOptions: { viewport: { width: 375, height: 800 } } }, async ({ newPage }) => {
    const page = await newPage();
    await page.goto(url("/help"));
    const toc = page.getByRole("navigation", { name: "On this page" });
    await toc.waitFor();
    const tocBox = await toc.boundingBox();
    const firstSection = await visibleMain(page).locator("section").first().boundingBox();
    assert.ok(tocBox.y + tocBox.height <= firstSection.y, "the table of contents sits above the first section");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375), "no horizontal scroll at 375 px");
  });

  await scenario("help-without-api", { failApi: true }, async ({ newPage }) => {
    const page = await newPage();
    const apiCalls = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(new URL(request.url()).pathname);
    });
    await page.goto(url("/help"));
    assert.deepEqual(await sectionHeadings(page).allInnerTexts(), SECTIONS);
    await page.waitForTimeout(300);
    // Only the shared top-bar summary may ask the API; the Help page itself makes no request.
    assert.ok(apiCalls.every((path) => path === "/api/experiences"), apiCalls.join(", "));
    assert.equal(await page.locator("header p[aria-live]").count(), 0, "the pill is omitted when the count cannot load");
  });

  await scenario("experience-links-to-help", { sources: [indexedSource("a")] }, async ({ newPage }) => {
    const page = await newPage();
    await page.goto(url("/experience"));
    await page.getByRole("heading", { level: 1, name: "Experience" }).waitFor();
    assert.equal(await page.getByText("Text is pulled out and frozen as the source of every citation.").count(), 0);
    await page.getByRole("link", { name: "How it works", exact: true }).click();
    await page.waitForURL(url("/help#experience"));
    await page.getByRole("heading", { name: "Experience", level: 2 }).waitFor();
  });

  console.log(JSON.stringify({ status: "PASS", checks: reports }, null, 2));
} finally {
  await browser.close();
}
