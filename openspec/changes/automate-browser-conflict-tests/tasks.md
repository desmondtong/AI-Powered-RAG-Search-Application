# Tasks

## 1. Baseline and branch

- [x] 1.1 Confirm the work is on branch `automate-browser-conflict-tests` cut from `main` (`git branch --show-current`), and that `npm run test:experience`, `npm run test:jd-fit`, `npm run lint`, `npx tsc --noEmit` and `npm run build` pass on a clean tree. Record the passing test counts as the baseline; no later task may change them.
- [x] 1.2 Confirm `npx next build` (Turbopack) also succeeds locally, since the runner will use it (design Decision 2). If it fails, stop and report before continuing.

## 2. Playwright and the runner

- [x] 2.1 Add `"playwright": "1.65.1"` (1.58.1 cannot install on Node 26, see design Decision 3) to `devDependencies` and run `npm install`; verify `node -e "require('playwright')"` exits 0 from the repository root and `npx playwright install chromium` completes. Verify `git diff package.json` touches only `devDependencies`.
- [x] 2.2 Create `scripts/test-browser.mjs` per design Decision 2: `next build` then `next start -p <port>` through `node_modules/.bin/next`, poll `http://127.0.0.1:<port>/` until it answers or 60 s pass, run `app/lib/experience/retryConflicts.browser.mjs` with `process.execPath`, stop the server in `finally` and exit with the script's code; honour `EXPERIENCE_PREVIEW_PORT` and, when `EXPERIENCE_PREVIEW_URL` is set, skip build and server. Add `"test:browser": "node scripts/test-browser.mjs"` to `scripts`. Verify `npm run test:browser` prints four `PASS` scenarios with `externalRequests: 0` and exits 0, and that `lsof -i :3033` is empty afterwards.
- [x] 2.3 Verify the failure path: run `EXPERIENCE_PREVIEW_URL=http://127.0.0.1:3033 npm run test:browser` with no server running and confirm it exits non-zero quickly; then temporarily make the runner's script path point at a file that throws, confirm the runner exits non-zero and the server is still stopped, and revert.
- [x] 2.4 Replace the "Run against a loopback Next preview … `PLAYWRIGHT_MODULE_PATH`" sentence in the "Retry-policy follow-up (2026-11-11)" section of `app/lib/experience/README.md` with the `npm run test:browser` command, the `EXPERIENCE_PREVIEW_URL` and `EXPERIENCE_PREVIEW_PORT` overrides, and the one-time `npx playwright install chromium`. Verify the documented command runs as written.

## 3. CI workflow

- [x] 3.1 Create `.github/workflows/ci.yml` per design Decision 4: triggers `pull_request` and `push` to `main`; jobs `checks` and `browser` on `ubuntu-latest`, each with `actions/checkout`, `actions/setup-node` (`node-version-file: .nvmrc`, `cache: npm`), `npm ci`, and job-level dummy values for `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY`; `checks` runs `npm run test:experience`, `npm run test:jd-fit`, `npm run lint`, `npx tsc --noEmit`, `npm run build`; `browser` runs `npx playwright install --with-deps chromium` then `npm run test:browser`. Verify the file parses (`node -e "require('js-yaml')"` is not available, so use `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` or a careful read) and contains no secret reference (`grep -n secrets .github/workflows/ci.yml` is empty).
- [ ] 3.2 Commit, push the branch, and open the pull request on GitHub titled "Automate browser conflict tests". Verify both jobs run and are green; the `browser` job log shows four `PASS` lines and `externalRequests: 0`. If `SecurityFatalError` or a Turbopack build error appears, resolve it per design Risks before continuing.

## 4. Branch rules and guidance

- [x] 4.1 Add to `openspec/config.yaml` under `operations.apply.guidance`: (a) work on a branch named exactly after the change id, cut from `main`, and never commit to `main` directly; (b) a change that touches `app/experience`, `app/components` or `app/lib/experience/workspace` is not complete until `npm run test:browser` is green. Add `operations.archive.guidance`: the archive commit is the last commit on the change branch; then open or update the pull request, rebase-merge once CI is green, delete the branch locally and on origin, and remove any worktree. Verify `openspec validate automate-browser-conflict-tests` still passes and `openspec status` reads the config without error.
- [x] 4.2 Add a "Branches and CI" section to `README.md` after "Getting Started": one branch per change named after the change id, all three commits on the branch, PR with rebase merge, delete on merge, one worktree per parallel change outside the repository with its own `npm ci` and `.env.local`, only one in-flight change touching `supabase/`, `EXPERIENCE_PREVIEW_PORT` for a second worktree, and the two CI jobs with what each runs. Verify every command in the section runs as written.
- [x] 4.3 Delete `docs/handoff/browser-test-automation.md` and verify `docs/handoff/` is empty or removed, and that `grep -rn "browser-test-automation" .` finds nothing.

## 5. Repository settings and cleanup

- [ ] 5.1 After the first green run from 3.2, create a ruleset on `main` in GitHub (Settings → Rules → Rulesets): require a pull request before merging, require the `checks` and `browser` status checks to pass, and block force pushes. In Settings → General, enable "Automatically delete head branches" and allow rebase merging. Verify by viewing the open PR: the merge button shows both checks as required.
- [ ] 5.2 Delete the merged branches `redesign-jd-fit-workspace`, `retire-generic-rag-search` and `tighten-workspace-copy-and-feedback` locally (`git branch -d`) and on origin (`git push origin --delete`). Verify `git branch -a` lists only `main`, `automate-browser-conflict-tests` and their remotes.

## 6. Integration check

- [ ] 6.1 From a clean checkout of the branch (`rm -rf node_modules .next && npm ci && npx playwright install chromium`), run `npm run test:browser` and confirm it is green. Confirm `git diff --stat main -- app/api supabase app/lib/experience/apiService.ts app/lib/jdFit app/lib/experience/retryConflicts.browser.mjs` is empty and `git diff main -- package.json` touches only `devDependencies` and `scripts`.
- [ ] 6.2 Confirm the final PR has both required checks green and the manual browser walkthrough guidance did not apply (no file under `app/experience`, `app/components` or `app/lib/experience/workspace` changed).

## Workflow follow-up

- Archive the change as the last commit on the branch, then rebase-merge the pull request and let GitHub delete the branch.
- Verify `main` after merge: `openspec list` shows no active change and the archive directory contains this change.
