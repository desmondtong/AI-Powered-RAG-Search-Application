// Captures the README screenshots and demo GIFs into docs/images/ from synthetic data.
//
// The app is built and served with placeholder credentials, and every /api request is answered in the browser by a
// small in-memory mock of the experience and JD-fit APIs. Nothing reaches Supabase or Gemini, and requests to any
// other origin are blocked. GIFs need ffmpeg on PATH; without it only the PNGs are written.
//
//   npm run capture:screenshots                         build, serve on :3035, capture, stop
//   CAPTURE_URL=http://127.0.0.1:3000 npm run capture:screenshots   use a server that is already running
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs", "images");
const nextBin = path.join(root, "node_modules", ".bin", "next");
const port = Number(process.env.CAPTURE_PORT || 3035);
const VIEWPORT = { width: 1280, height: 800 };
// Placeholders only: the build and server never use them, because the browser answers every API call.
const PLACEHOLDER_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "capture-dummy",
  GEMINI_API_KEY: "capture-dummy",
};

// ---- Synthetic data -------------------------------------------------------------------------------------------
// A fictional project, adapted from the strong-match RAG eval fixture. No real people, employers or documents.

const FILE = "lumen-freight-dispatch.docx";
const SOURCE_ID = "src-lumen";
const REVISION_ID = "rev-lumen-1";
const PARAGRAPHS = [
  "Lumen Freight Dispatch Platform (synthetic project). Role: Backend Engineer at Lumen Freight, a fictional logistics company, from 2022 to 2024.",
  "Designed and built TypeScript REST APIs on Node.js for carrier dispatch, serving 40 partner integrations.",
  "Tuned PostgreSQL queries and added composite indexes, cutting the p95 latency of the dispatch search endpoint from 900 ms to 120 ms.",
  "Mentored three junior engineers through weekly code reviews and pairing sessions.",
  "Wrote the on-call runbook for the dispatch service and led the review after each incident.",
  "Containerised the dispatch service with Docker and moved its deploys to a GitHub Actions pipeline.",
];
const BLOCKS = PARAGRAPHS.map((text, index) => ({ block_id: `b${index + 1}`, order: index, text }));

/** The exact span of `phrase` in a block, searching from the first occurrence of `after` when given. */
function span(blockIndex, phrase = BLOCKS[blockIndex].text, after = "") {
  const block = BLOCKS[blockIndex];
  const start = block.text.indexOf(phrase, Math.max(0, block.text.indexOf(after)));
  if (start < 0) throw new Error(`"${phrase}" is not in ${block.block_id}`);
  return { block_id: block.block_id, start, end: start + phrase.length };
}

const backed = (value, blockIndex, after = "") => ({ value, source_refs: [span(blockIndex, value, after)] });

const EVIDENCE = [
  { id: "ev-api", kind: "contribution", block: 1, summary: "Built TypeScript REST APIs on Node.js for carrier dispatch." },
  { id: "ev-postgres", kind: "outcome", block: 2, summary: "Cut dispatch search p95 latency from 900 ms to 120 ms with query tuning and indexes." },
  { id: "ev-mentor", kind: "responsibility", block: 3, summary: "Mentored three junior engineers through code reviews and pairing." },
  { id: "ev-oncall", kind: "contribution", block: 4, summary: "Wrote the on-call runbook and led post-incident reviews." },
  { id: "ev-docker", kind: "contribution", block: 5, summary: "Containerised the service and moved deploys to GitHub Actions." },
];

function canonicalRevision(status, draftVersion) {
  const technologies = ["TypeScript", "Node.js", "PostgreSQL", "Docker", "GitHub Actions"];
  const techBlock = { TypeScript: 1, "Node.js": 1, PostgreSQL: 2, Docker: 5, "GitHub Actions": 5 };
  return {
    schema_version: "1",
    source: { source_id: SOURCE_ID, original_file_name: FILE, original_file_type: "docx", byte_sha256: "sha256:synthetic-bytes" },
    extraction: {
      extraction_snapshot_id: "extraction-lumen-1",
      text_sha256: "sha256:synthetic-text",
      parser_version: "synthetic",
      normalization_version: "synthetic",
    },
    revision: {
      revision_id: REVISION_ID,
      status,
      draft_version: draftVersion,
      approved_content_hash: status === "draft" ? null : "sha256:synthetic-approved",
      model_version: "gemini-flash-lite-latest",
      prompt_version: "synthetic",
    },
    experiences: [
      {
        logical_id: "exp-lumen",
        type: "project",
        title: backed("Lumen Freight Dispatch Platform", 0),
        organization: backed("Lumen Freight", 0, "Role:"),
        role: backed("Backend Engineer", 0),
        period: { start: backed("2022", 0), end: backed("2024", 0), precision: "year" },
        technologies: { value: technologies, source_refs: technologies.map((name) => span(techBlock[name], name)) },
        context_refs: [span(0)],
        evidence_items: EVIDENCE.map((item) => ({
          logical_id: item.id,
          kind: item.kind,
          summary: item.summary,
          source_refs: [span(item.block)],
          attribution: "individual",
          activity_status: "completed",
        })),
      },
    ],
    review_acknowledgements: { warnings: false, unassigned_blocks: false },
  };
}

const OTHER_SOURCES = [
  {
    id: "src-orchard",
    file_name: "orchard-sensor-analytics.pdf",
    file_type: "pdf",
    file_size: 184_320,
    status: "indexed",
    latest_approved_revision_id: "rev-orchard-2",
    active_revision_id: "rev-orchard-2",
    active_version_number: 2,
    latest_approved_version_number: 2,
    latest_draft_revision_id: null,
    actions: [],
    failure: null,
    cleanup_error: null,
    created_at: "2026-11-10T09:12:00.000Z",
    updated_at: "2026-11-12T14:30:00.000Z",
  },
];

const JD_TEXT = [
  "Senior Backend Engineer (synthetic job description)",
  "",
  "Required: build TypeScript REST APIs on Node.js.",
  "Required: PostgreSQL performance tuning and indexing.",
  "Required: own production on-call and incident response.",
  "Required: run services on Kubernetes.",
  "Preferred: mentor junior engineers.",
  "Preferred: build event-driven systems with Kafka.",
].join("\n");

function citation(handle, evidenceIndex) {
  const item = EVIDENCE[evidenceIndex];
  return {
    evidence_handle: handle,
    source_id: SOURCE_ID,
    source_file_name: FILE,
    revision_id: REVISION_ID,
    approved_content_hash: "sha256:synthetic-approved",
    logical_experience_id: "exp-lumen",
    logical_parent_id: "exp-lumen:parent-1",
    logical_chunk_id: `exp-lumen:chunk-${evidenceIndex + 1}`,
    evidence_logical_ids: [item.id],
    experience_title: "Lumen Freight Dispatch Platform",
    experience_type: "project",
    evidence_kinds: [item.kind],
    source_span: span(item.block),
    quote: BLOCKS[item.block].text,
  };
}

const REQUIREMENTS = [
  ["Build TypeScript REST APIs on Node.js", "required", "built TypeScript REST APIs on Node.js"],
  ["PostgreSQL performance tuning and indexing", "required", "tuned PostgreSQL queries and indexes"],
  ["Own production on-call and incident response", "required", "on-call rotation and incident response"],
  ["Run services on Kubernetes", "required", "deployed services to Kubernetes"],
  ["Mentor junior engineers", "preferred", "mentored junior engineers"],
  ["Build event-driven systems with Kafka", "preferred", "Kafka event streaming"],
].map(([text, importance, query], index) => ({ requirement_id: `R${index + 1}`, text, importance, retrieval_query: query }));

const ASSESSMENTS = [
  { fit: "strong", rationale: "The cited passage shows TypeScript REST APIs built on Node.js for production integrations.", citations: [citation("E1", 0)] },
  { fit: "strong", rationale: "The cited passage shows PostgreSQL query tuning and indexing with a measured latency gain.", citations: [citation("E2", 1)] },
  { fit: "partial", rationale: "A runbook and post-incident reviews show on-call involvement, but not ownership of a rotation.", citations: [citation("E4", 3)] },
  { fit: "weak", rationale: "Containerising with Docker is adjacent, but no evidence shows running services on Kubernetes.", citations: [citation("E5", 4)] },
  { fit: "strong", rationale: "The cited passage shows mentoring junior engineers through reviews and pairing.", citations: [citation("E3", 2)] },
  { fit: "missing", rationale: "No approved evidence mentions Kafka or event-driven systems.", citations: [], downgraded: true },
].map((assessment, index) => ({ requirement_id: `R${index + 1}`, downgraded: false, ...assessment }));

const JD_FIT_REPORT = {
  status: "evaluated",
  requirements: REQUIREMENTS,
  assessments: ASSESSMENTS,
  gaps: ASSESSMENTS.filter((a) => a.fit === "weak" || a.fit === "missing").map((a) => {
    const requirement = REQUIREMENTS.find((r) => r.requirement_id === a.requirement_id);
    return { requirement_id: a.requirement_id, text: requirement.text, importance: requirement.importance, fit: a.fit };
  }),
  diagnostics: {
    model: "gemini-flash-lite-latest",
    requirement_prompt_version: "jd-fit-requirements-v1",
    report_prompt_version: "jd-fit-report-v1",
    validation_version: "jd-fit-validation-v1",
    deadline_ms: 60_000,
    max_output_tokens: 8192,
    requirement_count: REQUIREMENTS.length,
    retrieval: {
      match_count: 8,
      match_threshold: 0,
      concurrency: 4,
      retrieved_count: 24,
      deduped_evidence_count: 7,
      context_evidence_count: 7,
      trimmed_evidence_count: 0,
      context_characters: 3120,
      context_character_budget: 16_000,
      context_truncated: false,
    },
    generation: { requirement_repair_attempted: false, report_generated: true, report_repair_attempted: true },
    validation: { downgraded_claim_count: 1, removed_citation_count: 1 },
  },
};

// ---- Mock API -------------------------------------------------------------------------------------------------

/** One file's lifecycle: none → uploaded → extracted → draft → approved → indexed. */
function createMockApi(initialStage) {
  const state = { stage: initialStage, indexCalls: 0 };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const summary = () => {
    const stage = state.stage;
    const approved = stage === "approved" || stage === "indexed";
    return {
      id: SOURCE_ID,
      file_name: FILE,
      file_type: "docx",
      file_size: 48_128,
      status: stage,
      latest_extraction_id: stage === "uploaded" ? null : "extraction-lumen-1",
      latest_draft_revision_id: stage === "draft" ? REVISION_ID : null,
      latest_approved_revision_id: approved ? REVISION_ID : null,
      active_revision_id: stage === "indexed" ? REVISION_ID : null,
      active_version_number: stage === "indexed" ? 1 : null,
      latest_approved_version_number: approved ? 1 : null,
      failure: null,
      cleanup_error: null,
      created_at: "2026-11-17T08:40:00.000Z",
      updated_at: "2026-11-17T08:46:00.000Z",
      actions: { uploaded: ["extract"], extracted: ["parse"], draft: ["review", "approve", "parse"], approved: ["index"] }[stage] ?? [],
    };
  };

  const detail = () => {
    const stage = state.stage;
    const draft = stage === "draft";
    return {
      source: summary(),
      latest_extraction: stage === "uploaded" ? null : { id: "extraction-lumen-1", blocks: BLOCKS, warnings: [] },
      latest_revision:
        stage === "uploaded" || stage === "extracted"
          ? null
          : {
              id: REVISION_ID,
              status: draft ? "draft" : stage,
              draft_version: 1,
              draft_json: draft
                ? {
                    canonical_revision: canonicalRevision("draft", 1),
                    source_warnings: [],
                    omitted_block_coverage: { totalBlocks: BLOCKS.length, referencedBlocks: BLOCKS.length, unreferencedBlocks: [] },
                  }
                : null,
            },
      approved_versions:
        stage === "approved" || stage === "indexed" ? [{ revision_id: REVISION_ID, version_number: 1, approved_at: "2026-11-17T08:45:00.000Z" }] : [],
    };
  };

  const exportDoc = () => ({
    revision: canonicalRevision(state.stage === "indexed" ? "indexed" : "approved", 1),
    source_blocks: BLOCKS,
    content_hash: "sha256:synthetic-approved",
    exported_at: "2026-11-17T08:45:00.000Z",
    resolved_source_refs: [],
    configuration_versions: {},
  });

  async function handle(request, url) {
    const method = request.method();
    const p = url.pathname;
    const base = `/api/experiences/${SOURCE_ID}`;
    if (p === "/api/experiences" && method === "GET") {
      return { json: { sources: [...(state.stage === "none" ? [] : [summary()]), ...OTHER_SOURCES] } };
    }
    if (p === "/api/experiences" && method === "POST") {
      await sleep(700);
      state.stage = "uploaded";
      return { json: { upload_state: "uploaded", source: summary() } };
    }
    if (p === base && method === "GET") return { json: detail() };
    if (p === `${base}/extract` && method === "POST") {
      await sleep(1400);
      state.stage = "extracted";
      return { json: { status: "extracted" } };
    }
    if (p === `${base}/parse` && method === "POST") {
      await sleep(2200);
      state.stage = "draft";
      return { json: { status: "draft" } };
    }
    if (p === `${base}/approve` && method === "POST") {
      await sleep(600);
      state.stage = "approved";
      return { json: { status: "approved" } };
    }
    if (p === `${base}/index` && method === "POST") {
      await sleep(900);
      state.indexCalls += 1;
      const total = EVIDENCE.length;
      const prepared = Math.min(total, state.indexCalls * 2);
      if (prepared < total) {
        state.stage = "indexing";
        return { json: { status: "indexing", next_action: "index", progress: { total_chunks: total, prepared_chunks: prepared, remaining_chunks: total - prepared } } };
      }
      state.stage = "indexed";
      return { json: { status: "indexed", progress: { total_chunks: total, prepared_chunks: total, remaining_chunks: 0 } } };
    }
    if (p === `${base}/revisions/${REVISION_ID}/export` && method === "GET") return { json: exportDoc() };
    if (p === "/api/jd-fit" && method === "POST") {
      await sleep(2600);
      return { json: JD_FIT_REPORT };
    }
    return null;
  }

  return { state, handle };
}

// ---- Browser helpers ------------------------------------------------------------------------------------------

async function newSession(browser, baseUrl, stage, { video } = {}) {
  const api = createMockApi(stage);
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: video ? 1 : 2,
    colorScheme: "light",
    serviceWorkers: "block",
    reducedMotion: "no-preference",
    ...(video ? { recordVideo: { dir: video, size: VIEWPORT } } : {}),
  });
  const unexpected = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== baseUrl.origin) {
      unexpected.push(request.url());
      return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const response = await api.handle(request, url);
    if (response) return route.fulfill(response);
    unexpected.push(`${request.method()} ${url.pathname}`);
    return route.fulfill({ status: 404, json: { error: { message: "Not mocked" } } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const finish = async () => {
    await context.close();
    if (errors.length) throw new Error(`Page errors: ${errors.join("; ")}`);
    if (unexpected.length) throw new Error(`Unmocked requests: ${unexpected.join(", ")}`);
  };
  return { page, api, finish };
}

const url = (baseUrl, p) => new URL(p, baseUrl).href;
const pause = (page, ms) => page.waitForTimeout(ms);

async function shot(page, name, options = {}) {
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, ...options });
  console.log(`  wrote docs/images/${name}`);
}

/** Smoothly scrolls the window so recorded GIFs read as one motion, not a jump. */
async function smoothScroll(page, top) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), top);
  await pause(page, 900);
}

async function submitJd(page) {
  const box = page.locator("#jd-text");
  await box.click();
  await box.fill(JD_TEXT);
  await page.getByRole("button", { name: "Evaluate fit" }).click();
  await page.getByText("Fit report ready", { exact: false }).or(page.getByRole("heading", { name: /Strong/ })).first().waitFor({ timeout: 15_000 });
  await page.getByText("Open in source").first().waitFor();
}

// ---- Captures -------------------------------------------------------------------------------------------------

async function captureStills(browser, baseUrl) {
  console.log("Screenshots");
  {
    const { page, finish } = await newSession(browser, baseUrl, "indexed");
    await page.goto(url(baseUrl, "/"));
    await submitJd(page);
    await pause(page, 400);
    // The hero: header, tiles and the first requirement cards with their quotes.
    const heading = await page.getByRole("heading", { name: "Fit report" }).boundingBox();
    const scrollY = await page.evaluate(() => window.scrollY);
    const top = Math.max(0, Math.floor((heading?.y ?? 0) + scrollY - 32));
    await shot(page, "fit-report.png", { fullPage: true, clip: { x: 0, y: top, width: VIEWPORT.width, height: 1000 } });

    await page.getByText("Open in source").nth(1).click();
    await page.waitForURL(/\/experience\/src-lumen\?cite=/);
    await page.locator("mark, [data-citation], #span-citation").first().waitFor({ timeout: 10_000 }).catch(() => {});
    await pause(page, 1200);
    await shot(page, "open-in-source.png");
    await finish();
  }
  {
    const { page, finish } = await newSession(browser, baseUrl, "draft");
    await page.goto(url(baseUrl, `/experience/${SOURCE_ID}`));
    await page.getByRole("button", { name: "Start review" }).click();
    await pause(page, 1200);
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await pause(page, 300);
    await shot(page, "experience-review.png");
    await finish();
  }
  {
    const { page, finish } = await newSession(browser, baseUrl, "indexed");
    await page.goto(url(baseUrl, "/experience"));
    await page.getByText(FILE).first().waitFor();
    await pause(page, 500);
    await shot(page, "experience-list.png");
    await finish();
  }
}

async function recordFlow(browser, baseUrl, name, stage, flow) {
  const videoDir = mkdtempSync(path.join(tmpdir(), "jdfit-capture-"));
  try {
    const { page, finish } = await newSession(browser, baseUrl, stage, { video: videoDir });
    await flow(page);
    await finish();
    const [webm] = readdirSync(videoDir).filter((file) => file.endsWith(".webm"));
    if (!webm) throw new Error(`No video recorded for ${name}`);
    toGif(path.join(videoDir, webm), path.join(outDir, name));
  } finally {
    rmSync(videoDir, { recursive: true, force: true });
  }
}

function toGif(input, output) {
  // Skip the blank first frames, scale to README width, and build one palette for the whole clip.
  const filters = "fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle";
  const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "0.6", "-i", input, "-vf", filters, "-loop", "0", output], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${output}`);
  console.log(`  wrote docs/images/${path.basename(output)}`);
}

async function captureGifs(browser, baseUrl) {
  console.log("GIFs");
  await recordFlow(browser, baseUrl, "demo-upload-experience.gif", "none", async (page) => {
    await page.goto(url(baseUrl, "/experience"));
    await page.getByText("orchard-sensor-analytics.pdf").first().waitFor();
    await pause(page, 1200);
    await page.locator('input[type="file"]').setInputFiles({
      name: FILE,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from("synthetic docx placeholder"),
    });
    await page.waitForURL(new RegExp(`/experience/${SOURCE_ID}`));
    const startReview = page.getByRole("button", { name: "Start review" });
    await startReview.waitFor({ timeout: 20_000 });
    await pause(page, 1200);
    await startReview.click();
    await pause(page, 1800);
    await smoothScroll(page, 260);
    await pause(page, 1200);
    await page.getByRole("button", { name: /^Approve$/ }).click();
    const indexNow = page.getByRole("button", { name: "Index now" });
    await indexNow.waitFor({ timeout: 10_000 });
    await smoothScroll(page, 0);
    await pause(page, 1000);
    await indexNow.click();
    await page.getByText(/Indexed/).first().waitFor({ timeout: 20_000 });
    await pause(page, 2500);
  });

  await recordFlow(browser, baseUrl, "demo-fit-check.gif", "indexed", async (page) => {
    await page.goto(url(baseUrl, "/"));
    await page.locator("#jd-text").waitFor();
    await pause(page, 1000);
    await page.locator("#jd-text").click();
    await page.locator("#jd-text").fill(JD_TEXT);
    await pause(page, 1200);
    await page.getByRole("button", { name: "Evaluate fit" }).click();
    await page.getByText("Open in source").first().waitFor({ timeout: 15_000 });
    await pause(page, 1500);
    const tiles = await page.getByRole("button", { name: /Strong/ }).first().boundingBox();
    await smoothScroll(page, Math.max(0, (tiles?.y ?? 0) - 120));
    await pause(page, 1500);
    for (const step of [500, 500, 500]) {
      await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: "smooth" }), step);
      await pause(page, 1300);
    }
    // The downgraded claim at the end of the report.
    await page.getByText("Adjusted: a claim without valid evidence was removed.").scrollIntoViewIfNeeded();
    await pause(page, 2000);
    await smoothScroll(page, Math.max(0, (tiles?.y ?? 0) - 120));
    await pause(page, 800);
    await page.getByText("Open in source").nth(1).click();
    await page.waitForURL(/\/experience\/src-lumen\?cite=/);
    await pause(page, 3500);
  });
}

// ---- Server lifecycle -----------------------------------------------------------------------------------------

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} ${args[0]} exited with ${code}`))));
  });
}

async function waitForServer(target, server) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`next start exited with ${server.exitCode}`);
    try {
      if ((await fetch(target, { redirect: "manual" })).status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server at ${target} did not answer within 60s`);
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  let server = null;
  let baseUrl;
  if (process.env.CAPTURE_URL) {
    baseUrl = new URL(process.env.CAPTURE_URL);
  } else {
    if (!existsSync(nextBin)) throw new Error("next is not installed; run npm ci first");
    baseUrl = new URL(`http://127.0.0.1:${port}`);
    console.log("Building with placeholder credentials...");
    await run(nextBin, ["build"], PLACEHOLDER_ENV);
    server = spawn(nextBin, ["start", "-p", String(port)], { cwd: root, stdio: "inherit", env: { ...process.env, ...PLACEHOLDER_ENV } });
    await waitForServer(baseUrl.href, server);
  }
  if (!["127.0.0.1", "localhost"].includes(baseUrl.hostname)) throw new Error("Capture needs a loopback server");

  const browser = await chromium.launch({ headless: true });
  try {
    await captureStills(browser, baseUrl);
    if (hasFfmpeg) await captureGifs(browser, baseUrl);
    else console.log("ffmpeg not found on PATH; skipped the GIFs.");
  } finally {
    await browser.close();
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
