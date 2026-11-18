# Design

## Context

See proposal.md for the motivation. The constraints that shape the approach:

- **`cacheComponents: true`** (`next.config.ts`). `next build` requires every route to produce a static shell. `headers()` and `cookies()` outside `<Suspense>` fail that check, and a value that drives an attribute on `<html>` cannot be wrapped at all. The bundled Next docs (`01-app/02-guides/migrating-to-cache-components.md`, `preventing-flash-before-hydration.md`) prescribe an inline `<head>` script for theme attributes.
- **Theme today.** `app/globals.css` defines light tokens on `:root` and overrides them inside `@media (prefers-color-scheme: dark)`. Components use only semantic utilities from `@theme inline`, with no `dark:` variants, literal hex values or opacity modifiers. A theme switch is therefore purely a token swap.
- **Top bar.** `app/components/TopBar.tsx` is a client component: a hard-coded `DESTINATIONS` list, leave-guarded links and the indexed pill. `app/experience/_components/OverflowMenu.tsx` already wraps Base UI `Menu` (non-modal, keyboard-complete).
- **IAP identity.** Confirmed in `docs.cloud.google.com/iap/docs/signed-headers-howto`, IAP forwards:
  - `x-goog-authenticated-user-email: accounts.google.com:<email>` (unsigned)
  - `x-goog-authenticated-user-id`
  - `x-goog-iap-jwt-assertion`, a JWT whose claims are `sub`, `email`, `iss`, `aud`, `iat`, `exp`, `hd` and `google`. There is no `picture` or `name`.

  On Cloud Run the JWT audience is `/projects/<number>/locations/<region>/services/<name>`. The docs warn that the unsigned headers can be forged if IAP is bypassed.
- **Tests.**
  - `npm run test:experience` compiles only `app/lib/experience/**`.
  - `npm run test:browser` builds, starts `next start` on loopback and runs `app/lib/experience/retryConflicts.browser.mjs` with Playwright. That script intercepts every API call and blocks external requests.

## Goals / Non-Goals

**Goals:**
- Keep every route's static shell. The only request-time read is the identity, inside one Suspense boundary.
- Theme switching stays a token swap: one token list, no per-component changes.
- Help content is plain typed data rendered by a static page, easy to extend per feature.

**Non-Goals:**
- Sign-out, profile photos, display names, or any second OAuth flow.
- Server-side or cross-device preference storage.
- Verifying the IAP JWT, or using identity for authorization.
- Search, MDX or versioned docs for Help.

## Decisions

### 1. Identity: a Suspense-wrapped server slot passed into the client top bar

`app/layout.tsx` renders `<TopBar account={<Suspense fallback={<AvatarPlaceholder />}><AccountSlot /></Suspense>} />`:

- **`AccountSlot`** is an async server component. It awaits `headers()`, reads `x-goog-authenticated-user-email` and parses it with a pure helper, `parseIapIdentity(value)`. The helper strips the `accounts.google.com:` namespace, trims the value, and returns `null` for anything without exactly one `@`. It then renders the client `AccountMenu` with `{ email, initial } | null`.
- **`AvatarPlaceholder`** is a neutral 32 px circle, so the top bar does not shift when the slot streams in.

Alternatives considered:
- **A client fetch of a new `/api/me` route.** Rejected: it adds an API surface, a round trip and a loading state for one string.
- **Reading headers in the layout without Suspense.** Rejected: it fails `cacheComponents` prerender validation for every route.
- **Verifying the JWT and taking its `email`.** Rejected for now. The value is display-only (spec: "Identity is shown, never trusted"), and verification would fetch IAP public keys and need the Cloud Run audience configured. Cloud Run IAP is the service's only ingress (`docs/deploy.md`: the IAP service agent is the sole `run.invoker`), so a forged header requires access that already bypasses everything. If identity ever gates behaviour, switch to the verified JWT `email` claim.

### 2. Account menu on Base UI `Menu`, mirroring `OverflowMenu`

`app/components/AccountMenu.tsx`:
- **Root and trigger:** `Menu.Root modal={false}`. The trigger is a 32 px round button.
  - With an identity: `bg-cobalt text-on-cobalt`, showing the initial, with accessible name `Account: <email>`.
  - Without one: `bg-subtle` with a new `PersonIcon`, accessible name `Account`.
- **Popup:** a non-interactive header line with the email (only with an identity), a separator, then `Menu.LinkItem` "Settings" rendered as a Next `Link` to `/settings`. Its `onNavigate` calls `useLeaveGuard().intercept("/settings")`, like the top-bar links.

The initial is the first letter or digit (Unicode) of the email, uppercased, falling back to the neutral icon. A shared `menuItemClass` keeps the item styles consistent with `OverflowMenu`.

### 3. Theme tokens via `light-dark()` and `color-scheme`, selected by `data-theme`

`globals.css` changes so each colour token is defined once:
- Every colour becomes `--card: light-dark(#ffffff, #151a24);`.
- Shadows wrap only the colour: `--raised-shadow: 0 8px 24px light-dark(rgba(17,24,39,.08), rgba(0,0,0,.4));`.
- The scheme is chosen with three rules:
  - `:root { color-scheme: light dark; }`, which is Auto and follows the OS natively.
  - `:root[data-theme="light"] { color-scheme: light; }`
  - `:root[data-theme="dark"] { color-scheme: dark; }`

Auto therefore needs no JavaScript: OS changes apply live through CSS. A forced theme is one attribute. Native form controls and scrollbars follow `color-scheme` automatically, which covers the spec's "including form controls and scrollbars".

Alternatives considered:
- **Duplicating the dark token block** under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and again under `:root[data-theme="dark"]`. This works in every browser but keeps two copies of about 45 tokens in sync by hand. It is kept as the fallback if `light-dark()` misbehaves under Tailwind v4's `@theme inline` mapping.
- **Always writing a resolved `data-theme` from JavaScript, with a `matchMedia` listener.** Rejected: Auto would break when scripts fail, and OS changes would need a listener.

The WCAG-checked token values in `globals.css` are kept unchanged; only their form changes.

### 4. Preference stored in `localStorage`, applied by an inline head script

- **Storage:** key `jdfit:appearance`, value `"light"` or `"dark"`. Auto removes the key. `app/lib/experience/workspace/appearance.ts` holds pure helpers, unit-tested with the existing runner:
  - `parseAppearance(raw)` maps anything else to `"auto"`.
  - `themeAttribute(appearance)` returns `"light"`, `"dark"` or `null`.
- **Head script:** `app/layout.tsx` adds `<head>` with an `InlineScript`, following the Next guide's helper (`type` is `text/javascript` on the server and `text/plain` on the client, with `suppressHydrationWarning`). The script runs a try/catch-wrapped snippet that reads the key and sets `document.documentElement.dataset.theme`. `<html>` gets `suppressHydrationWarning` because the script changes its attributes before hydration. The script source is a constant string generated from the same key and values as the helpers, so the two cannot drift.
- **Runtime changes:** a small client hook, `useAppearance()`, built on `useSyncExternalStore`, does the following:
  - It subscribes to the `storage` event (other tabs) and to a same-tab custom event.
  - It reads with a server snapshot of `null`.
  - Its `setAppearance(value)` writes or removes the key, sets or removes `data-theme`, and dispatches the event.

  The hook is mounted once by an `AppearanceSync` client component in the layout, so every tab follows changes from other tabs on every route.
- **Storage failures:** every access is wrapped in try/catch, so blocked storage degrades to Auto.

Alternatives considered:
- **A cookie read on the server.** Rejected: it makes `<html>` request-bound, and the Next docs name this exact case.
- **The `next-themes` package.** Rejected: it is a new dependency for about 30 lines.

### 5. Settings page: a static route with a Base UI `RadioGroup`

`app/settings/page.tsx` is a server component that exports `metadata = { title: "Settings" }` and renders a client `AppearanceSetting`:
- **Control:** Base UI `RadioGroup` with three `Radio` cards (Auto / Light / Dark) and a visible group label. Base UI provides roving focus and arrow-key selection.
- **Selection timing:** the selected value comes from `useAppearance()`. Before hydration the snapshot is `null` and no option is checked, which avoids a server/client mismatch. The checked state appears on hydration.
- **Behaviour:** a change calls `setAppearance` immediately, with no save button.

### 6. Help page: typed content rendered statically

- **Content:** `app/lib/experience/workspace/help.ts` exports `HELP_SECTIONS`, an ordered array of `{ id, title, blocks }`. Blocks are paragraphs, ordered steps or a definition list. The Experience section is built from `HOW_IT_WORKS`, so the stage sentences have one source shared with the Fit Check empty state. Fit-group names come from the existing fit labels.
- **Page:** `app/help/page.tsx` is a server component with no data access, so it is fully prerendered, and `metadata = { title: "Help" }`. Its layout:
  - On `lg` and wider, two columns: a sticky "On this page" `nav`, with `top` set to the top-bar height plus spacing, beside the sections.
  - Below `lg`, the nav sits above the content.
- **Anchors:** each section heading carries its `id` and `scroll-margin-top` equal to the sticky top-bar height plus spacing. TOC entries are plain `<a href="#id">`.

Alternative considered: MDX or Markdown files. Rejected for now because of a new build dependency and config. Typed data also lets unit tests assert section order, anchors and the one-sentence rule. It can be revisited if Help grows into long-form prose.

### 7. Experience page change and copy

- **Experience page:** `HowItWorks.tsx` and its `Disclosure` use on `app/experience/page.tsx` are removed. A plain Next `Link`, "How it works", points to `/help#experience` below the list. The list page registers no leave blocker, so no guard is needed.
- **Copy** in `copy.ts`:
  - `NAV.help = "Help"`
  - `EXPERIENCE_PAGE.howItWorks` stays as the link label.
  - New `SETTINGS_PAGE` (heading, section title, option labels and one-line descriptions) and `ACCOUNT_MENU` (Settings label, accessible names).

### 8. Top bar at phone width

- **Destinations:** `TopBar` gains the Help destination (`matches: path === "/help"`) and an `account` slot after the pill. Below `sm`:
  - Destinations use `text-body-sm` and `px-1.5`.
  - The bar gap drops to `gap-2`.
  - The pill renders the dot plus the bare number, with the full `indexedPill(count)` text in an `sr-only` span.
- **Width budget at 375 px:** mark 24, three tabs about 200, pill about 44, avatar 32 and gaps about 32 total about 332, within the 343 px content width. The browser test asserts no horizontal scroll.

## Risks / Trade-offs

- **[Risk] Cloud Run's direct IAP integration may not forward `x-goog-authenticated-user-email`.** The docs confirm the JWT for Cloud Run but show the headers mainly in load-balancer contexts. → Mitigation: a hosted check after deploy. If the header is absent, `AccountSlot` falls back to base64url-decoding the JWT payload's `email` (still display-only, no verification). It is a contained change in one helper.
- **[Risk, resolved during apply] `light-dark()` browser support.** Native support needs Chrome 123+, Safari 17.5+ or Firefox 120+. In practice, Tailwind v4's Lightning CSS compiles each `light-dark(a, b)` to `var(--lightningcss-light, a) var(--lightningcss-dark, b)`. It also emits switch variables for every `color-scheme` rule, including the `prefers-color-scheme` media query and both `[data-theme]` selectors. So the shipped CSS works in older browsers too, and the attribute rules win over the media query by specificity. Contrast is still re-checked in the browser walkthrough in both themes.
- **[Risk] The inline script and the hydration warning.** React warns about `<script>` rendered on the client. → Mitigation: the Next-documented `InlineScript` helper and `suppressHydrationWarning` on `<html>` only.
- **[Trade-off] The Settings radios render unchecked until hydration.** This is a brief, visible-only state on one page, chosen over a hydration mismatch.
- **[Trade-off] The preference is per browser.** Another device starts on Auto. This is accepted for a single-user app and stated in Help.
- **[Risk] The Suspense slot in the root layout makes every route partially dynamic.** → The shell stays static, and only the avatar streams. `next build` prerender validation in CI catches any regression.
- **[Trade-off] No sign-out.** Users who want to switch accounts must sign out of Google. This is documented as a deliberate choice in the proposal.

## Migration Plan

- **Deploy:** the normal merge to `main` triggers auto-deploy. There is no data or infrastructure change and no environment variable.
- **After deploy:** open the hosted URL and confirm the avatar shows the owner's initial and email. If it shows the neutral icon, apply the JWT-payload fallback from Risks and redeploy.
- **Rollback:** revert the merge commit. Stored `jdfit:appearance` keys are harmless to older builds, which ignore them.
