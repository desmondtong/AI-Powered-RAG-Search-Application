# Tasks

## 1. Branch and browser-test harness

- [x] 1.1 Cut branch `add-account-settings-and-help` from `main`. Verify with `git branch --show-current`.
- [x] 1.2 Extend `scripts/test-browser.mjs` to run a list of browser scripts, so far `retryConflicts.browser.mjs` plus a new `app/lib/experience/shell.browser.mjs`. Start the shell script as a skeleton that loads `/` with every `/api/` call intercepted (an empty source list) and external requests blocked. Verify `npm run test:browser` passes with both scripts.

## 2. Theme tokens and appearance preference

- [x] 2.1 Add `app/lib/experience/workspace/appearance.ts` with these helpers and verify each with unit tests in `appearance.test.ts` (`npm run test:experience`):
  - the `jdfit:appearance` key
  - `parseAppearance`, which maps unknown, empty and `null` values to `"auto"`
  - `themeAttribute`
  - the generated head-script string, tested by running it against a stubbed `localStorage` and `document`, including a throwing `localStorage`
- [x] 2.2 Rewrite the colour tokens in `app/globals.css` as single `light-dark()` definitions. Add `color-scheme: light dark` on `:root` and the `[data-theme="light"]` and `[data-theme="dark"]` overrides, and remove the `prefers-color-scheme` block. Keep every existing light and dark value and its comments. Verify with `npm run build`, then in the browser: with no `data-theme`, both OS schemes render as before; with `data-theme="dark"` on a light OS, and the reverse, the forced tokens apply.
- [x] 2.3 Add the `InlineScript` helper. Render it in a `<head>` in `app/layout.tsx` with the appearance script, and add `suppressHydrationWarning` to `<html>`. Verify `next build` still prerenders every route with no runtime-data error, and that loading a page with `jdfit:appearance=dark` on a light OS paints dark first, as asserted in 2.6.
- [x] 2.4 Add the `useAppearance` hook (`useSyncExternalStore`, `storage` plus a same-tab event, every storage access in try/catch) and an `AppearanceSync` client component mounted once in the layout. Verify through the browser scenarios in 2.6.
- [x] 2.5 Add the `/settings` route (server page with `metadata.title "Settings"`) and the `AppearanceSetting` client component: a Base UI `RadioGroup` with Auto, Light and Dark and a visible group label. Add `SETTINGS_PAGE` copy in `copy.ts`. Verify:
  - The page renders with "Auto" checked in a fresh browser.
  - Arrow keys move the selection.
  - Each choice swaps the theme immediately.
- [x] 2.6 Add `shell.browser.mjs` scenarios with Playwright `colorScheme` emulation and assert computed `--ground` or background colours:
  - First visit is Auto.
  - Dark on a light OS, and Light on a dark OS: assert the colour at `DOMContentLoaded` and after reload. Check the first frame by reading the computed background in an init script that runs after the head script.
  - Auto follows an OS change while open.
  - A fixed choice ignores OS changes.
  - A second page in the same context adopts a change without a reload.
  - Blocked `localStorage` falls back to Auto with no page error.

  Verify `npm run test:browser` is green.

## 3. Account menu and top bar

- [x] 3.1 Add `parseIapIdentity` (strips `accounts.google.com:`, validates exactly one `@`, derives the initial from the first letter or digit) in `app/lib/experience/workspace/account.ts`. Verify with unit tests covering a normal value, a missing header, an empty value, no prefix, a malformed address and a non-alphanumeric first character (`npm run test:experience`).
- [x] 3.2 Add `PersonIcon` to `app/components/icons.tsx`, `ACCOUNT_MENU` copy, and `app/components/AccountMenu.tsx` on Base UI `Menu`:
  - It shows the email header line, then a `Menu.LinkItem` "Settings" through Next `Link` that is guarded by `useLeaveGuard().intercept`, and no sign-out item.
  - The neutral variant has no email line.

  Verify by keyboard: Enter, Space and ArrowDown open the menu, Escape returns focus to the avatar.
- [x] 3.3 Add the async `AccountSlot` server component (awaits `headers()`, calls `parseIapIdentity`) and `AvatarPlaceholder`. Pass `<Suspense fallback={<AvatarPlaceholder/>}><AccountSlot/></Suspense>` into `TopBar` as an `account` prop from `app/layout.tsx`. Verify `next build` succeeds with no prerender error and `/help` stays fully static apart from the slot.
- [x] 3.4 Update `TopBar.tsx`:
  - Add the Help destination (`NAV.help`, matching `/help`) and render the `account` slot after the pill.
  - Below `sm`: `text-body-sm` destinations, tighter gaps, and the pill showing the dot plus the number with the full `indexedPill` text in `sr-only`.

  Verify the copy test for the pill wording still passes.
- [x] 3.5 Add `shell.browser.mjs` scenarios:
  - With `x-goog-authenticated-user-email: accounts.google.com:desmond@example.com` set as an extra HTTP header, the avatar shows "D", its accessible name includes the email, and the menu lists the email and "Settings".
  - Without the header, a neutral avatar named "Account" with only "Settings".
  - The menu has no sign-out item.
  - Choosing "Settings" navigates to `/settings` with no destination marked `aria-current`.
  - Keyboard open, move and Escape work.
  - At a 375 × 800 viewport with three indexed sources mocked, all three destinations, a pill reading "3" whose accessible text is "3 files indexed", and the avatar are visible, and `document.documentElement.scrollWidth <= 375`.

  Verify `npm run test:browser` is green.

## 4. Help page and the Experience link

- [x] 4.1 Add `HELP_SECTIONS` in `app/lib/experience/workspace/help.ts`:
  - Fit Check: how to enter a JD and evaluate it, the Strong, Partial, Weak and Missing groups, tile filtering, and "Open in source".
  - Experience: built from `HOW_IT_WORKS`.
  - Settings: the Auto, Light and Dark options, saved in this browser, opened from the account menu.

  Verify with unit tests in `help.test.ts`: ids and order are `fit-check`, `experience`, `settings`; the Experience section has six stages of one sentence each, in pipeline order; and Help never mentions sign-out.
- [x] 4.2 Add the `/help` route: a server page with `metadata.title "Help"`, an "On this page" nav that is sticky at `lg` and stacked above the content below it, sections with anchors and `scroll-margin-top`, and no API call. Verify `next build` lists `/help` as prerendered.
- [x] 4.3 Remove `app/experience/_components/HowItWorks.tsx` and its use on `app/experience/page.tsx`, and add the "How it works" link to `/help#experience`. Update `copy.test.ts` if any assertion depended on the collapsed section. Verify `npm run test:experience` and `npm run lint` pass and `rg HowItWorks app` returns nothing.
- [x] 4.4 Add `shell.browser.mjs` scenarios:
  - The Help destination marks itself current.
  - The three sections render in order.
  - `/help#experience` puts the Experience heading below the top bar: its bounding top is at least the bar's height.
  - A TOC click updates the hash.
  - At 375 px there is no horizontal scroll and the TOC sits above the first section.
  - With every `/api/` call failing, Help still renders fully.
  - The Experience page has no stage list and its "How it works" link lands on `/help#experience`.

  Verify `npm run test:browser` is green.

## 5. Documentation

- [x] 5.1 Update `app/lib/experience/README.md`'s UI section: three destinations, the account menu (display-only IAP identity, no sign-out), the appearance setting and its storage key, and Help as the home of the stage explanation. Note in `docs/deploy.md` that the app reads the IAP email header for display only. Verify the README contract tests (`npm run test:experience`) still pass.

## 6. Integration checks

- [x] 6.1 Run `npm run lint`, `npm run test:experience`, `npm run test:jd-fit`, `npm run build` and `npm run test:browser`, and verify all pass.
- [x] 6.2 Run a browser walkthrough with `npm run dev` at `http://localhost:3000`, in both macOS appearances:
  - Top bar at desktop width and at 375 px.
  - The account menu by mouse and keyboard.
  - Settings: switch Auto, Light and Dark, reload on each, and confirm there is no flash.
  - Help: the TOC, anchors and sticky nav.
  - Experience: the "How it works" link.
  - Fit Check empty state: it still explains the stages.
  - A dirty draft on a file page: choosing account menu → Settings shows the leave confirmation.
  - Contrast on every touched screen in both themes.

  Record the steps, observations and screenshots in the implementation summary.
- [ ] 6.3 After merge and auto-deploy, open the hosted URL. Verify the avatar shows the owner's initial and the menu shows the owner's email. If it shows the neutral avatar, apply the JWT-payload fallback from design.md's Risks, add its unit test, and redeploy.

## Workflow follow-up

- Open a pull request from `add-account-settings-and-help`, and rebase-merge once both CI checks are green.
- Archive the change as the last commit on the branch, then delete the branch locally and on origin.
