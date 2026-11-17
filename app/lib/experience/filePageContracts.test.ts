import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = process.cwd();

function read(path: string) {
  return readFileSync(join(ROOT, path), "utf8");
}

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(join(ROOT, path)).isDirectory() ? filesUnder(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The body of the first `if (<condition>) {` block, matched by brace depth. */
function blockAfter(source: string, condition: string) {
  const start = source.indexOf(condition);
  assert.notEqual(start, -1, `missing ${condition}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(open, index + 1);
  }
  throw new Error(`unterminated block after ${condition}`);
}

const FILE_PAGE = "app/experience/[id]/FilePageClient.tsx";
const RUNNER = "app/experience/[id]/_hooks/useStageRunner.ts";
const INDEXER = "app/experience/[id]/_hooks/useIndexSequence.ts";

describe("experience file page contracts", () => {
  it("loads the detail from the unchanged API and renders the stage header from the view model", () => {
    const page = read(FILE_PAGE);
    assert.match(page, /fetch\(`\/api\/experiences\/\$\{sourceId\}`/);
    assert.match(page, /toStageView\(/);
    assert.match(page, /<StageHeader/);
    assert.match(page, /<FailureInset/);
    assert.match(page, /aria-live="polite"/);
    assert.doesNotMatch(page, /revision_id\}<|\{source\.active_revision_id\}|\{source\.latest_draft_revision_id\}/);
  });

  it("starts extract→parse only from the consumed one-time key and parses only after an extracted check", () => {
    const page = read(FILE_PAGE);
    const runner = read(RUNNER);
    assert.match(page, /sessionStorage\.getItem\(key\)/);
    assert.match(page, /sessionStorage\.removeItem\(key\)/);
    assert.ok(page.indexOf("sessionStorage.getItem(key)") < page.indexOf("sessionStorage.removeItem(key)"));
    assert.match(page, /if \(!autostart\.current \|\| !loaded\) return;/);

    const extractedCheck = runner.indexOf('detail?.source.status !== "extracted"');
    const parsePost = runner.indexOf('await post("parse")');
    assert.ok(extractedCheck > -1 && parsePost > extractedCheck, "parse must follow the extracted check");
    assert.match(runner, /fetch\(`\/api\/experiences\/\$\{sourceId\}\/\$\{stage\}`, \{ method: "POST" \}\)/);
  });

  it("never re-sends a stage after a 409; it refreshes and lets polling follow", () => {
    const runner = read(RUNNER);
    const conflict = blockAfter(runner, "if (response.status === 409)");
    assert.doesNotMatch(conflict, /fetch\(/);
    assert.match(read(FILE_PAGE), /usePolling\(serverWorking && !runner\.busy && !indexing\.running, refresh\)/);
  });

  it("wires overflow actions to the existing endpoints with an in-page delete confirmation", () => {
    const page = read(FILE_PAGE);
    assert.match(page, /`\/api\/experiences\/\$\{sourceId\}\/file`/);
    assert.match(page, /`\/api\/experiences\/\$\{sourceId\}\/revisions\/\$\{revisionId\}\/export`/);
    assert.match(page, /case "reparse":[\s\S]*?runner\.runChain\("parse"\)/);
    assert.match(page, /fetch\(`\/api\/experiences\/\$\{sourceId\}`, \{ method: "DELETE" \}\)/);
    assert.match(page, /<ConfirmInline/);
    assert.match(page, /<AcceptedJsonPanel/);
    assert.match(read("app/lib/experience/workspace/copy.ts"), /stops being searchable in Fit Check immediately/);

    for (const file of [...filesUnder("app/experience"), "app/components/TopBar.tsx"]) {
      assert.doesNotMatch(read(file), /\bconfirm\(/, `${file} must not use a native confirm dialog`);
    }
  });

  it("reaches /index only from click handlers and stops on a 409 without a second /index call", () => {
    const page = read(FILE_PAGE);
    const indexer = read(INDEXER);
    const calls = page.match(/runIndexSequence\(/g) ?? [];
    assert.equal(calls.length, 2, "Index now/continue/retry and Index version N are the only callers");
    assert.match(page, /case "index-now":\s*case "continue-indexing":\s*case "retry-index":[\s\S]*?indexing\.runIndexSequence\(latestApprovedId\)/);
    assert.match(page, /onIndexLatest=\{\(\) => \{[\s\S]*?indexing\.runIndexSequence\(latestApprovedId\)/);
    for (const effect of page.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) ?? []) {
      assert.doesNotMatch(effect, /runIndexSequence|\/index/);
    }

    const conflict = blockAfter(indexer, "if (response.status === 409)");
    assert.doesNotMatch(conflict, /\/index/);
    assert.doesNotMatch(conflict, /runIndexSequence/);
    assert.match(conflict, /await refresh\(\)/);
    assert.match(conflict, /setRefreshRequired\(/);
    assert.equal((indexer.match(/\/index`/g) ?? []).length, 1, "one index request site, inside the loop");
    assert.match(indexer, /if \(!revisionId \|\| indexRequestInFlight\.current \|\| refreshRequiredRef\.current\) return;/);
  });

  it("shows the conflict fact strip by version number and offers only explicit choices", () => {
    const panel = read("app/experience/[id]/_components/ConflictPanel.tsx");
    assert.match(panel, /copy\.searchableNow, copy\.latestApproved, copy\.notIndexedFact/);
    assert.match(panel, /copy\.indexLatest/);
    assert.match(panel, /copy\.lookFirst/);
    assert.match(panel, /CONFLICT\.refresh/);
    assert.doesNotMatch(panel, /fetch\(/);
    assert.match(read(FILE_PAGE), /stale = indexing\.conflict\?\.code === "index-candidate-stale"/);
  });

  it("shows the approved revision read-only from one export read and nothing else", () => {
    const page = read(FILE_PAGE);
    const hook = read("app/experience/[id]/_hooks/useApprovedView.ts");
    assert.match(page, /useApprovedView\(/);
    assert.match(page, /<ExperienceRail\s+mode="read"/);
    assert.equal((hook.match(/fetch\(/g) ?? []).length, 1, "the view makes one read");
    assert.match(hook, /fetch\(`\/api\/experiences\/\$\{sourceId\}\/revisions\/\$\{revisionId\}\/export`\)/);
    assert.doesNotMatch(hook, /\bnotice\.(success|info)\(/, "export failures stay in place");
    assert.equal((page.match(/runIndexSequence\(/g) ?? []).length, 2, "the read-only view adds no index caller");
  });

  it("edits an approved file through draft-from-approved and says the searchable version is unchanged", () => {
    const page = read(FILE_PAGE);
    assert.match(page, /`\/api\/experiences\/\$\{sourceId\}\/draft-from-approved`/);
    assert.match(page, /approved_revision_id: latestApprovedId/);
    assert.match(page, /editApprovedLabel\(/);
    assert.match(page, /EDIT_APPROVED_NOTE/);
  });
});

/** Every `{ … }` body that runs when a request failed: `if (!response.ok …) {` and `catch … {` blocks. */
function failureBlocks(source: string) {
  const bodies: string[] = [];
  const opener = /if \(!(?:response|res)\.ok\b[^{]*\{|catch(?:\s*\([^)]*\))?\s*\{/g;
  for (const match of source.matchAll(opener)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) {
        bodies.push(source.slice(open, index + 1));
        break;
      }
    }
  }
  return bodies;
}

describe("leave guard contracts", () => {
  const PROVIDER = "app/components/LeaveGuardProvider.tsx";

  it("warns the browser only while the draft is dirty, from one listener", () => {
    const page = read(FILE_PAGE);
    const effects = page.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g) ?? [];
    const warning = effects.filter((effect) => effect.includes('addEventListener("beforeunload"'));
    assert.equal(warning.length, 1, "one beforeunload effect");
    assert.match(warning[0], /^useEffect\(\(\) => \{\s*if \(!editor\.dirty\) return;/, "gated on the draft being dirty");
    assert.match(warning[0], /\}, \[editor\.dirty\]\);$/);
    assert.match(warning[0], /removeEventListener\("beforeunload"/);
    const sources = filesUnder("app").filter((file) => !file.endsWith(".test.ts"));
    assert.deepEqual(sources.filter((file) => read(file).includes('addEventListener("beforeunload"')), [FILE_PAGE]);
  });

  it("offers Save and leave, Leave without saving and Stay from the shared confirmation", () => {
    const page = read(FILE_PAGE);
    const copy = read("app/lib/experience/workspace/copy.ts");
    for (const token of ["LEAVE_GUARD.leave", "LEAVE_GUARD.save", "LEAVE_GUARD.stay"]) assert.ok(page.includes(token), token);
    assert.match(page, /leavePending \? \([\s\S]*?<ConfirmInline/);
    const block = blockAfter(copy, "export const LEAVE_GUARD = ");
    for (const label of ['"Save and leave"', '"Leave without saving"', '"Stay"']) assert.ok(block.includes(label), label);
  });

  it("mounts the guard once, in the root layout, outside the notice provider", () => {
    const layout = read("app/layout.tsx");
    assert.ok(layout.indexOf("<LeaveGuardProvider>") < layout.indexOf("<NoticeProvider>"));
    const sources = filesUnder("app").filter((file) => file !== PROVIDER && !file.endsWith(".test.ts"));
    assert.deepEqual(sources.filter((file) => /<LeaveGuardProvider\b/.test(read(file))), ["app/layout.tsx"]);
  });

  it("routes every in-app navigation through intercept, and leaving sends no request", () => {
    for (const file of ["app/components/TopBar.tsx", "app/experience/[id]/_components/StageHeader.tsx", "app/components/NoticeProvider.tsx"]) {
      assert.match(read(file), /\bintercept\(/, file);
    }
    assert.match(read("app/components/TopBar.tsx"), /onNavigate=\{guarded\(/);
    const provider = read(PROVIDER);
    assert.doesNotMatch(provider, /fetch\(/, "the provider never calls the API; Save and leave goes through the page's save");
    assert.match(provider, /if \(choice === "leave"\) \{\s*go\(target\);\s*return;\s*\}/);
  });
});

describe("transient notice contracts", () => {
  const PROVIDER = "app/components/NoticeProvider.tsx";

  it("mounts the notice provider once, in the root layout", () => {
    assert.match(read("app/layout.tsx"), /<NoticeProvider>/);
    const sources = filesUnder("app").filter((file) => file !== PROVIDER && !file.endsWith(".test.ts"));
    const mounts = sources.filter((file) => /<NoticeProvider\b/.test(read(file)));
    assert.deepEqual([...new Set(mounts)], ["app/layout.tsx"]);
  });

  it("offers success and info only, so an error can never become a notice", () => {
    const provider = read(PROVIDER);
    const shape = blockAfter(provider, "export interface Notice ");
    assert.match(shape, /success:/);
    assert.match(shape, /info:/);
    assert.doesNotMatch(shape, /error|warn/i);
    assert.match(provider, /limit=\{1\}/);
    assert.match(provider, /timeout=\{5000\}/);
  });

  it("never raises a notice where a request failed", () => {
    for (const file of [...filesUnder("app/experience"), ...filesUnder("app/components")]) {
      for (const body of failureBlocks(read(file))) {
        assert.doesNotMatch(body, /notice\.(success|info)\(/, `${file} raises a notice in a failure branch`);
      }
    }
  });
});
