# Design

## Context

See proposal.md for motivation. The facts that shape the approach:

- `retryConflicts.browser.mjs` loads Playwright through `createRequire` from `process.env.PLAYWRIGHT_MODULE_PATH || "playwright"`, targets `EXPERIENCE_PREVIEW_URL` (default `http://127.0.0.1:3033`), refuses non-loopback hosts, intercepts every request with `context.route("**/*")`, and exits non-zero on any failed assertion. It needs a production build (`next start`), not `next dev`, because the fixture route must render without the dev overlay and without hot reload.
- `npm run build` is `next build --webpack`. There is no PostCSS config, and the Tailwind loader is registered only under `turbopack.rules` in `next.config.ts`, so the webpack build ships CSS without utility classes. `npx next build` (Turbopack, the Next 16 default) is what the dark-mode checks on 2026-11-17 used. The script asserts text and roles only, so either build passes it.
- The build and `next start` read `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` (or `GOOGLE_API_KEY`). Clients are created per request, not at build time, so dummy values are enough. `next start` loads `.env.local` locally, but the script intercepts at the browser, so no API route is ever reached and the real credentials are never used.
- `.nvmrc` pins Node 26.2.0. Playwright 1.58.1 ran on Node 26.11.1 on 2026-11-17.
- History on `main` is linear. Each archived change left the same three commits (`docs: propose <id>`, the implementation, `chore: archive <id>`). Branches named after change ids exist for three of them but were fast-forwarded and never deleted. There is no `.github/` directory and the `gh` CLI is not installed.
- The remote is a single GitHub repository with one developer. All environments, including every git worktree, point at the same remote Supabase project.

## Goals / Non-Goals

**Goals:**
- The script runs the same way locally and in CI from one command, and a red run blocks the merge.
- The branch rules are short enough to follow from memory and are enforced where a machine can enforce them (required checks on `main`) rather than only written down.
- Nothing in CI can reach the remote Supabase project or Gemini, by construction, not by discipline.

**Non-Goals:**
- Caching Playwright's browser download or the Next build between CI runs. Correctness first; speed when it hurts.
- Running the script against `next dev`.
- Deploy workflows, preview environments, or any job beyond checks and browser.
- Editing the browser script's scenarios or assertions.

## Decisions

### 1. Branch model: GitHub Flow keyed by the OpenSpec change id

The branch name is the change id, the PR title is the change title, and the archive commit is the last commit on the branch. `main` therefore never holds an active change: `openspec list` on `main` is always empty, and `openspec/changes/<id>/` only ever exists on its own branch. Merge is "rebase and merge" so the three-commit rhythm survives on `main`; squash would collapse it and a merge commit would end the linear history for no gain. Delete on merge is the default on GitHub and is turned on in repository settings.

Worktrees are for parallel changes only: one per active change, placed outside the repository (for example `../rag-worktrees/<change-id>`), each with its own `npm ci` and its own copy of `.env.local`. The main checkout stays on `main`. Because every worktree shares the single remote Supabase project, only one in-flight change may touch `supabase/` at a time; this is a convention, not something CI can check.

Alternative considered: archive on `main` after merge. Rejected because it puts an unarchived change on `main` between merge and archive, and because spec sync conflicts between two in-flight changes should surface at rebase time on the branch, not as a surprise on `main`.

Alternative considered: keep committing directly to `main` and run CI on push only. Rejected because a red run then reports a problem that is already on `main`; the gate has to sit before the merge.

### 2. The runner is a small Node script, not a shell line

`scripts/test-browser.mjs` does four things in order: build, start, wait, run, and always stops the server. It spawns `next build` and `next start -p <port>` through the local binary at `node_modules/.bin/next` with `process.execPath`, polls `http://127.0.0.1:<port>/` until it answers (timeout 60 s), runs the browser script with `process.execPath`, and in a `finally` block sends `SIGTERM` to the server and waits for it to exit. The runner's exit code is the script's exit code. Port defaults to 3033 and is overridable with `EXPERIENCE_PREVIEW_PORT`. When `EXPERIENCE_PREVIEW_URL` is set, the runner skips build and server and only runs the script, which keeps the existing manual workflow working.

The runner builds with Turbopack (`next build`, no `--webpack`) so the preview under test is the real production build. `npm run build` is left as it is; whether it should also drop `--webpack` is a separate decision about the product build.

Alternative considered: `concurrently` or `start-server-and-test`. Rejected because they add dependencies to do what thirty lines of Node do, and the fallback behaviour on a failing script is what matters most here.

### 3. Playwright is pinned, Chromium only, installed by Playwright

`"playwright": "1.65.1"` with an exact version, because the browser build Playwright downloads is tied to the package version and a caret range would silently change the browser under test. The handoff's 1.58.1 was tried first and could not install on this machine: Playwright 1.58 through 1.59 hang at "extracting archive" under Node 26 (the download itself takes seconds), a known bug fixed from 1.60. The earlier "download stalled" note in the handoff was this bug, not the network. 1.65.1 was the latest release on 2026-11-17 and installs Chromium, the headless shell and FFmpeg in under a minute. CI runs `npx playwright install --with-deps chromium` so only one browser is downloaded. Locally, `npx playwright install chromium` is a one-time step documented in the README. The `channel: "chrome"` fallback from the handoff is not added: the local stall was a network problem, and the script must test the same Chromium everywhere.

### 4. One workflow, two jobs, both required

`.github/workflows/ci.yml` triggers on `pull_request` and on `push` to `main`. Job `checks` runs `npm ci`, `npm run test:experience`, `npm run test:jd-fit`, `npm run lint`, `npx tsc --noEmit`, `npm run build`. Job `browser` runs `npm ci`, `npx playwright install --with-deps chromium`, `npm run test:browser`. Both use `actions/setup-node` with `node-version-file: .nvmrc` and `cache: npm`, and both set the three env vars to dummy values at the job level (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_SERVICE_ROLE_KEY=ci-dummy`, `GEMINI_API_KEY=ci-dummy`). No repository secret is created; the workflow has nothing real to read, so nothing real can leak.

Two jobs rather than one so a lint or type failure reports in about a minute without waiting behind the Chromium download, and so the PR shows which layer failed. Both are required from day one because the script is green now and a report-only period is how it drifted before.

Branch protection is a GitHub ruleset on `main` ("main protection"): require a pull request with rebase as the only merge method and no required approvals (a sole maintainer cannot approve their own PR), require the `checks` and `browser` status checks, and block deletion and force pushes. Repository settings allow only rebase merging and delete head branches on merge. Both were applied once through the `gh` CLI after the first green run; the repository is public, so rulesets are enforced on the free plan.

Alternative considered: a `workflow_dispatch` trigger so the browser job can be run by hand. Not added; `npm run test:browser` is the by-hand path.

### 5. Guidance lives in the OpenSpec config, the explanation in the README

`openspec/config.yaml` gets one apply line (branch) and one apply line (`npm run test:browser` for the named paths), plus one archive line (archive is the last commit, then PR, rebase merge, delete branch, remove worktree). These are the rules an agent cannot infer from the code. `README.md` gets a "Branches and CI" section that states the same rules for a person and adds the worktree and Supabase convention. `app/lib/experience/README.md` keeps its history paragraphs and replaces only the "how to run" sentence.

## Risks / Trade-offs

- [Turbopack build fails in CI for a reason the webpack build hides] → The first PR of this change is the test. If it fails, fix the cause in this change rather than fall back to `--webpack`; the script needs no CSS, so a Turbopack-only CSS problem would not block it.
- [Next's advisory check (`SecurityFatalError`) stops the build] → Observed during apply: Next 16.4.2 is in the range of GHSA-mfr8-8qww-v76h (fixed in 16.4.6). The stop is Next's agent-only upgrade nudge: when an AI agent runs `next build`, it halts every other run and writes a one-time retry receipt under `.next/cache/`; for a person in a terminal and in CI it is a warning and the build continues, so CI is not affected. Under an agent, `npm run build` and `npm run test:browser` therefore alternate between fail and pass until Next is upgraded. Upgrading Next stays a separate change, recommended as the next one.
- [Chromium download is slow or flaky on GitHub runners] → It is the standard Playwright path and usually takes under a minute. Add `actions/cache` for `~/.cache/ms-playwright` only if it proves flaky.
- [Port 3033 is in use on the developer's machine] → `EXPERIENCE_PREVIEW_PORT` overrides it; the runner fails fast with the bind error otherwise.
- [The server survives a crashed runner] → The `finally` block also runs on `SIGINT`; a leftover process is visible with `lsof -i :3033` and the README says so.
- [The developer forgets to branch and commits to `main`] → A push to `main` outside a PR is rejected by the ruleset once configured. Until then it is guidance only.
- [Two worktrees both run `test:browser` on port 3033] → They collide. Use `EXPERIENCE_PREVIEW_PORT` in the second worktree; documented in the README.

## Migration Plan

1. The change itself follows the new rule: branch `automate-browser-conflict-tests` from `main` before the proposal is committed.
2. Land the dependency, runner and docs; run `npm run test:browser` locally from a clean install.
3. Land the workflow and open the PR; it is the first CI run. Fix until both jobs are green.
4. Create the `main` ruleset with both checks required, after the first green run so the check names are known to GitHub.
5. Delete the three stale branches locally and on origin.
6. Archive on the branch, rebase-merge the PR, delete the branch.

Rollback: delete `.github/workflows/ci.yml` and remove the ruleset. The runner and dependency are inert without the workflow.

## Open Questions

- Whether `npm run build` should drop `--webpack` so the product build matches the Turbopack build CI tests. Deferrable: it does not affect this change's tasks and is a product-build decision.
- Whether to narrow the manual walkthrough guidance once CI has run on a few real changes. Deferrable by the proposal.
