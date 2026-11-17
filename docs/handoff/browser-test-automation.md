# Handoff: make the browser conflict script a real automated test

Written 2026-11-17 for the next Claude Code session, after `settle-workspace-structure` was archived. This file is temporary. Delete it once the follow-up change has been proposed with `openspec-propose`.

## 1. Why

`app/lib/experience/retryConflicts.browser.mjs` is the repository's only end-to-end browser test. It drives a headless browser through four indexing-conflict scenarios (`newer-approved`, `newer-published`, `refresh-failure`, `lease-conflict`), intercepting every API call with synthetic responses, and asserts that the file page refreshes once, never retries on its own, retargets only after an explicit "Index version N", disables indexing until a refresh succeeds, and renders the indexed page with no primary action.

Nothing runs it. It is not in `package.json` scripts, there is no CI, and Playwright is not a dependency: the script expects `PLAYWRIGHT_MODULE_PATH` to point at a copy somewhere on the machine. It last ran on its own on 2026-11-11 in the previous tooling. It was then edited twice (2026-11-15 and 2026-11-16) without a run, and on 2026-11-17 the first real run found two drifts: a stale label (`Approved version 2 · ready for indexing`, now `Version 2 approved · not indexed`) and an exact-text wait that matched both the visible label and a screen-reader live region. Both are fixed; the script is green as of 2026-11-17.

The OpenSpec guidance in `openspec/config.yaml` requires a manual browser walkthrough for UI changes, and that has been followed. It says nothing about this script, which is why it drifted.

## 2. What to build

One OpenSpec change, suggested name `automate-browser-conflict-tests`. No API, database or business-logic change. Four parts:

1. **Playwright as a dev dependency.** Add `playwright` (1.58.1 was used on 2026-11-17) to `devDependencies` in `package.json`. Keep the `PLAYWRIGHT_MODULE_PATH` fallback in the script so a machine without the dependency can still point at a copy, but the default `require("playwright")` must resolve from the repo.
2. **An npm command.** `npm run test:browser` that builds, starts `next start -p 3033`, waits for the port, runs the script, and stops the server whether the script passes or fails. A small Node runner script (not a shell one-liner) so it works the same locally and in CI. `EXPERIENCE_PREVIEW_URL` stays as the override.
3. **CI.** A GitHub Actions workflow under `.github/workflows/` on pull requests and pushes to `main`: install, `npm run test:experience`, `npm run test:jd-fit`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npx playwright install --with-deps chromium`, `npm run test:browser`. The script blocks all real API calls and the build does not contact Supabase or Gemini, so the workflow needs only dummy values for the env vars the build reads (check `.env.local` for the names; never commit real values). There is no workflow in the repo today.
4. **Guidance.** Add one line under `operations.apply.guidance` in `openspec/config.yaml`: a change that touches `app/experience`, `app/components` or `app/lib/experience/workspace` is not complete until `npm run test:browser` is green against a production preview. Update the "Retry-policy follow-up" paragraph in `app/lib/experience/README.md` to say `npm run test:browser` instead of the `PLAYWRIGHT_MODULE_PATH` instruction.

## 3. Decisions already taken, and open ones

- The script keeps using Playwright's bundled Chromium in CI. On 2026-11-17 the Chromium download stalled on the local network, and the run used the Mac's installed Google Chrome through a shim passed in `PLAYWRIGHT_MODULE_PATH`. That shim lives in a session scratch folder and is gone; do not recreate it in the repo. If local downloads keep stalling, `chromium.launch({ channel: "chrome" })` behind an env flag is an acceptable local-only option.
- `npm run build` uses `--webpack`, which skips the Turbopack-only Tailwind rule in `next.config.ts`, so that build ships CSS without utility classes. The script checks text and roles only, so this does not affect it. Open: whether CI should build with `npx next build` (Turbopack) instead, which is what the dark-mode checks used.
- Open: block merges on the browser job from day one (recommended, it is green now), or report-only for a week.
- Open: whether the manual walkthrough rule should narrow once the automated layer exists. Suggested wording: walkthrough only the changed workflow, as the guidance already says, and lean on the script for the conflict paths.
- The 2026-11-17 build once failed with `SecurityFatalError: Your version of Next.js is affected by a known security vulnerability` while an npm install was running in parallel; the immediate rerun passed. If it recurs in CI, it is Next 16.4.2's advisory check, and upgrading Next is a separate decision.

## 4. Verification the change must include

- `npm run test:browser` green locally from a clean checkout (`rm -rf node_modules && npm ci`).
- The CI workflow green on a pull request, with the browser job's log showing all four scenarios `PASS` and `externalRequests: 0`.
- `git diff --stat main -- app/api supabase app/lib/experience/apiService.ts app/lib/jdFit` empty; `package.json` changes limited to `devDependencies` and `scripts`.
- The manual walkthrough rule still applies to this change only if it touches UI; it should not.

## 5. Files

- `app/lib/experience/retryConflicts.browser.mjs`: the script.
- `app/lib/experience/README.md`, sections "Retry-policy follow-up (2026-11-11)" and "Workspace structure browser walkthrough (2026-11-16)": how it has been run so far.
- `openspec/config.yaml`: the apply guidance.
- `package.json`: scripts and devDependencies.
- `openspec/changes/archive/`: the archived `settle-workspace-structure` change, whose tasks 8.2 and 8.3 describe the last run.
