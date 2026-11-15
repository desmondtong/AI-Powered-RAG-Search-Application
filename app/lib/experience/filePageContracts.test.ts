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

  it("edits an approved file through draft-from-approved and says the searchable version is unchanged", () => {
    const page = read(FILE_PAGE);
    assert.match(page, /`\/api\/experiences\/\$\{sourceId\}\/draft-from-approved`/);
    assert.match(page, /approved_revision_id: latestApprovedId/);
    assert.match(page, /editApprovedLabel\(/);
    assert.match(page, /EDIT_APPROVED_NOTE/);
  });
});
