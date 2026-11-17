# Proposal

## Why

`app/lib/experience/retryConflicts.browser.mjs` is the repository's only end-to-end browser test, and nothing runs it: it is not in `package.json`, Playwright is not a dependency, and there is no CI. It drifted twice in a week without anyone noticing, and the repository has no merge gate at all because every change so far was fast-forwarded into `main` locally. The script is green as of 2026-11-17, which makes now the cheapest moment to put it under automation and to write down the branch rules the CI gate depends on.

## What Changes

- **Branch and worktree rules.** One branch per OpenSpec change, named exactly after the change id and cut from `main`; the propose, implement and archive commits all land on that branch, with archive as its last commit; `main` is updated only through a pull request merged with rebase once CI is green; the branch is deleted locally and on origin after merge. Parallel changes use one git worktree each; only one in-flight change may touch `supabase/` because every worktree shares the single remote Supabase project. Recorded as apply and archive guidance in `openspec/config.yaml` and as a short section in `README.md`. The three stale merged branches (`redesign-jd-fit-workspace`, `retire-generic-rag-search`, `tighten-workspace-copy-and-feedback`) are deleted as part of adopting the rule.
- **Playwright as a dev dependency**, pinned, so `require("playwright")` resolves from the repository. The `PLAYWRIGHT_MODULE_PATH` override in the script stays.
- **`npm run test:browser`.** A Node runner that builds the app, starts `next start` on a loopback port, waits for it, runs the script, and stops the server whether the script passed or failed. `EXPERIENCE_PREVIEW_URL` stays as the override that skips the build and server and targets a preview that is already running.
- **GitHub Actions CI** under `.github/workflows/`, on pull requests and pushes to `main`, with two jobs: `checks` (install, `test:experience`, `test:jd-fit`, lint, `tsc --noEmit`, build) and `browser` (install, Chromium, `test:browser`). Both are required status checks on `main` from day one. The workflow uses dummy values for the three env vars the build reads and never touches the remote Supabase project or Gemini.
- **Guidance and docs.** One line under `operations.apply.guidance`: a change that touches `app/experience`, `app/components` or `app/lib/experience/workspace` is not complete until `npm run test:browser` is green. The "Retry-policy follow-up" paragraph in `app/lib/experience/README.md` points at `npm run test:browser`. The temporary handoff file `docs/handoff/browser-test-automation.md` is deleted, as it asks to be.

Not in this change: changing what `npm run build` does, upgrading Next, narrowing the manual walkthrough rule (revisit after CI has been green on a few real changes), or adding further browser scenarios.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. The behaviours the script asserts (one refresh on a 409, no automatic retry, retarget only after an explicit "Index version N", indexing disabled while a refresh fails, no primary action on the indexed page) are already requirements of `jd-fit-workspace-ui` and do not change. This change only makes an existing check run automatically, so `.openspec.yaml` sets `skip_specs: true`.

## Impact

- `package.json` and `package-lock.json`: `devDependencies.playwright` and `scripts.test:browser` only.
- New `scripts/test-browser.mjs` (runner) and `.github/workflows/ci.yml`.
- `openspec/config.yaml` (apply and archive guidance), `README.md` (branches section), `app/lib/experience/README.md` (one paragraph), `docs/handoff/browser-test-automation.md` (deleted).
- GitHub repository settings: `main` gets a ruleset requiring the `checks` and `browser` status checks and a pull request before merge. This is a manual step in the GitHub UI; the `gh` CLI is not installed on this machine.
- Origin: three merged branches deleted.
- No change under `app/api`, `supabase`, `app/lib/experience/apiService.ts` or `app/lib/jdFit`; no change to the browser script itself.
