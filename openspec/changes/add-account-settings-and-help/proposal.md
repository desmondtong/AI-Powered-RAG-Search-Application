# Proposal

## Why

The hosted app now sits behind Google Identity-Aware Proxy (IAP), but the top bar gives no sign of who is signed in and there is nowhere to put user preferences. The theme can only follow the operating system. The "How it works" explanation sits awkwardly at the bottom of the Experience page, and there is no home for future how-to content as more features ship.

## What Changes

- **Account menu in the top bar.** A round avatar at the right end of the top bar shows the initial of the signed-in Google account, read from the identity IAP forwards. Its menu shows the full email address and a "Settings" link. IAP supplies only an email and a stable ID (no photo or name), so the avatar is a monogram. Locally, where IAP is absent, a neutral avatar offers Settings only.
- **No sign-out (deliberate).** IAP's sign-out only clears its own cookie, and an active Google session signs the user straight back in. Signing out of Google would end every Google session in the browser. A sign-out action is therefore out of scope for now.
- **Settings page at `/settings`.** It starts with one "Appearance" setting: Auto, Light or Dark. Auto, the default, keeps today's behaviour of following the operating system. The choice applies immediately, persists in the browser, and is in effect before the first paint of every later page load, with no flash of the wrong theme.
- **Help page at `/help`, a third top-bar destination.** It has one section per feature (Fit Check, Experience, Settings) and an in-page table of contents, so future how-to content has a home.
- **The six-stage explanation moves to Help.** The collapsed "How it works" section is removed from the Experience page and replaced by a short link to the Experience section of Help. The Fit Check empty state still explains the six stages.
- **Top bar fits at phone width.** With three destinations and an avatar, the indexed-files pill shrinks to a dot and a number below the `sm` breakpoint, and nothing scrolls horizontally at 375 px.

## Capabilities

### New Capabilities
- `user-preferences`: The settings page and the per-browser preferences it controls, starting with the appearance theme (Auto, Light, Dark): how a preference is chosen, persisted and applied before paint.
- `in-app-help`: The Help page as the single home for how-to content, including its sections, its table of contents and which explanations it owns.

### Modified Capabilities
- `jd-fit-workspace-ui`:
  - Two-destination navigation becomes three destinations (Fit Check, Experience, Help) plus the account menu and the compact phone pill.
  - The visual system's theme follows the saved appearance setting, falling back to the operating system on Auto.
  - The single-source stage explanation moves from the Experience page's collapsed section to the Help page.
  - The account menu joins the keyboard-operable interactions.
  - The leave guard also covers the account menu's Settings link.

## Impact

- **Code:**
  - `app/layout.tsx`: the head script that applies the theme before paint, and a Suspense-wrapped account slot.
  - `app/components/TopBar.tsx`: the Help destination, the avatar and the compact pill.
  - New account menu component and identity helper.
  - `app/globals.css`: theme tokens selectable by an attribute as well as by the OS preference.
  - New `app/settings/` and `app/help/` routes.
  - `app/experience/page.tsx` and `HowItWorks.tsx`: the section is removed and replaced by a link.
  - `app/lib/experience/workspace/copy.ts`: navigation, help and settings copy.
- **Rendering:** with `cacheComponents` on, the identity read (`headers()`) is confined to a Suspense boundary so every route keeps a static shell. Nothing reads cookies or headers to set `<html>` attributes on the server.
- **Tests:** new unit tests for identity parsing and theme resolution, and new Playwright scenarios for the account menu, theme switching and Help. `npm run test:browser` must stay green.
- **Hosting:** no change to IAP, Cloud Run or the deploy workflow. The app reads the IAP identity header for display only and makes no access decision on it.
- **Dependencies:** none added. The menu and radio group use the existing `@base-ui/react`.
