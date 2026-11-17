# Design

## Context

See proposal.md for motivation. The facts that shape the approach:

- `stage.ts` already returns `primary: null` for `extracting`, `parsing` and the unavailable state; `indexed` is the only finished state that still carries a primary (`try-jd`). `ExperienceRow` renders "Working…" text for progress rows and maps `try-jd` to `/`; `FilePageClient.renderPrimary` special-cases `try-jd` as a `ButtonLink`; `useIndexSequence` reuses `ACTION_LABELS["try-jd"]` as the searchable notice's action label.
- The approved revision is reachable through `GET /api/experiences/[id]/revisions/[revisionId]/export`, which returns `{ revision: CanonicalRevision, source_blocks, resolved_source_refs, … }`. `FilePageClient.loadExport` already calls it for "Inspect accepted JSON" and for the citation quote. `ExperienceRail` takes a `CanonicalRevision`, so the approved revision can be rendered by the same rail.
- Unsaved state lives in `useDraftEditor` as `dirty` plus `dirtyRef`; `save()` resolves to the saved draft version or `null`. `InlineField` commits on blur, and a pointer or keyboard activation of any link blurs the field first, so a value still being typed is committed before any navigation handler runs.
- Next 16's `Link` accepts `onNavigate(event)` with `event.preventDefault()`, called only for same-origin client navigations. The App Router has no public navigation blocker and no `beforeunload` for soft navigations. `NoticeProvider` performs its link actions through a module-level `navigate` that calls `router.push`.
- `@base-ui/react` 1.9.0 is installed and already used for Toast, Tooltip, Collapsible and Toggle Group. Its Menu offers `Menu.LinkItem`, `Menu.Item disabled`, controlled `open`, and a `modal` prop that defaults to `true`; its Popover accepts a `VirtualElement` anchor (`getBoundingClientRect`), `collisionAvoidance` (flip by default), `collisionPadding`, `initialFocus` and `finalFocus`, and reports `escape-key` and `outside-press` through `onOpenChange`.
- Contract tests are static: `experienceListContracts` requires `view.primary`, `<OverflowMenu` and `<DotStepper` in `ExperienceRow`; `filePageContracts` requires `EDIT_APPROVED_NOTE`, the export URL template and exactly two `runIndexSequence(` call sites in `FilePageClient`; `experienceReviewContracts` requires `rangeToSpan(container, range,` and the cross-block branch. `retryConflicts.browser.mjs` aborts any API request it does not route and ends by waiting for the "Try a job description" link.
- The project's apply guidance requires a real browser walkthrough for UI changes.

## Goals / Non-Goals

**Goals:**
- Make "nothing to do" look like nothing: no primary on rows or pages that are finished or running, and a readable approved revision instead of an empty indexed page.
- Guard unsaved edits without touching how the draft is saved: the guard only decides whether a navigation proceeds and may call the existing `save()`.
- Replace the two hand-rolled floating widgets with Base UI without changing their roles, names or keyboard contracts, so the browser script and screen-reader behaviour stay the same.

**Non-Goals:**
- Autosave, draft persistence across reloads, or recovering edits after a hard navigation the browser prompt let through.
- Migrating `ConfirmInline`, `PillSelect`, checkboxes or progress bars to Base UI.
- Showing the read-only view for a `failed` source whose failure stage is indexing; that page keeps its failure inset and header actions.
- Any change to API routes, request bodies, polling or the index sequence.

## Decisions

### 1. `try-jd` leaves the stage vocabulary; the notice keeps the wording

`"try-jd"` is removed from `ACTION_LABELS`, so it stops being an `ActionId` and the compiler finds every site. `toStageView` returns `primary: null` for `indexed`. The searchable notice keeps its action, with the label moved to `NOTICES.tryJd` ("Try a job description") so the transient-notice requirement is unchanged. `ExperienceRow` drops the `try-jd` branch of `primaryHref` and the "Working…" text; `FilePageClient.renderPrimary` drops the `ButtonLink` branch. "Upload a different file" stays a `secondary` on failure rows and pages, as today.

Alternative considered: keep the id and render nothing for it. Rejected because dead ids in the copy deck are exactly what the copy test guards against, and the compiler does the audit for free when the id is gone.

### 2. Primary rules live in one table, tested per state

`stage.ts` keeps its switch, but the rule "a primary appears only when the file is waiting on the user" is written into `stage.test.ts` as a table over every status: `uploaded`, `extracted`, `draft`, `approved`, `indexing`, recoverable `failed` and `cleanup-pending` have a primary when the API allows it; `extracting`, `parsing`, `indexed` and the default state never do. `uploaded` maps to a new `"start-processing"` action ("Start processing"); `extracted` keeps `"continue-processing"`. `FilePageClient.runAction` handles both ids by calling `runner.runChain("extract")` for start and `runChain(status === "extracted" ? "parse" : "extract")` for continue, as today.

### 3. The row is a link by delegation, not by stretching

`ExperienceRow`'s `<li>` gets `onClick` that calls `router.push(href)` unless the event target is inside `a, button, [role="menu"]`, or the user has a non-collapsed text selection (so copying a file name does not navigate). The file-name `Link` stays the row's one accessible link, so assistive technology still sees a single link named after the file. The row gets `cursor-pointer` and a hover border so the affordance is visible.

Alternative considered: a stretched pseudo-element link covering the row. Rejected because it sits over the overflow menu and the confirm panel, breaks text selection, and needs z-index juggling on every control.

### 4. Read-only approved view is the review layout fed by the export

A `useApprovedView(sourceId, revisionId, enabled)` hook in `app/experience/[id]/_hooks/` fetches the export once per `revisionId` when `enabled`, exposing `{ status: "idle" | "loading" | "ready" | "error", doc, error, retry }`. `FilePageClient` enables it when the source is `approved` or `indexed`, `latest_revision` is not a draft, and a `latest_approved_revision_id` exists. When ready it renders the same 12-column grid as review: `DocumentPane` over `doc.source_blocks` with highlights from `evidenceHighlights(doc.revision)` and no unassigned tint, no toolbar and no `onPointerSelect`; `ExperienceRail` with `mode="read"` and no `ApprovalGate`. Loading shows one sentence; failure shows the error with a "Try again" button that calls `retry`, while the header and overflow keep working.

`ExperienceRail`, `ExperienceCard` and `EvidenceCard` take a discriminated `mode` prop: `{ mode: "edit", fieldErrors, selecting, handlers }` or `{ mode: "read", onShowSpan }`. In read mode fields render through a `StaticField` (same label and caption markup as `InlineField`, value as a `<p>`), kind, attribution and activity status render as `Pill`s, the "Source: bN" chip keeps its scroll button but has no remove button, and the "+ span", "Remove evidence", "Select from source" and "Remove" controls are not rendered. The read-mode branches import none of `InlineField`, `PillSelect` or `MISSING_SPAN`, which the contract test checks.

Citation resolution on these pages uses `doc.source_blocks` when the view is ready, falling back to `latest_extraction.blocks` otherwise, so "Open in source" highlights in the pane the user sees. The page width switches to the wide layout whenever the view is shown. "Inspect accepted JSON" stays in the overflow and keeps `AcceptedJsonPanel`.

Alternative considered: render from `latest_revision.draft_json` on the detail. Rejected because for approved and indexed sources `latest_revision` is not a draft and its `draft_json` is not the accepted content; the export is already the one accepted view the page trusts for citations.

Alternative considered: render the editing components with `disabled`. Rejected because the spec says the controls are absent, and disabled controls still read as controls to assistive technology.

### 5. The leave guard is a context with one registered blocker

`app/components/LeaveGuardProvider.tsx` provides `{ register(blocker), intercept(href): boolean, pending, resolve(choice) }` where `blocker = { isDirty(): boolean; save(): Promise<boolean> }`. It mounts in `app/layout.tsx` outside `NoticeProvider`, so both the top bar and the notices can reach it. `intercept(href)` returns `true` and stores `pending = href` when a blocker is registered and `isDirty()`; otherwise `false`.

- `TopBar`'s wordmark and destination `Link`s and `StageHeader`'s breadcrumb `Link` pass `onNavigate={(event) => { if (guard.intercept(href)) event.preventDefault(); }}`.
- `NoticeProvider`'s `navigate` becomes `(href) => { if (!guard.intercept(href)) router.push(href); }`.
- `FilePageClient` registers `{ isDirty: () => editor.dirty, save: async () => (await editor.save()) !== null }` while a draft is shown and unregisters on unmount. While `editor.dirty` it adds a `beforeunload` listener that calls `preventDefault()` and sets `returnValue`, removed as soon as the draft is clean.
- When `pending` is set, `FilePageClient` renders `ConfirmInline` in the header slot used by the delete confirmation, with a new optional third action: title "Leave without saving?", primary "Leave without saving" (destructive), secondary "Save and leave", cancel "Stay". `ConfirmInline` already focuses its cancel button on mount and closes on Escape, which gives "Stay" focus and the Escape behaviour for free. Choosing Leave calls `resolve("leave")`, which `router.push`es `pending`. Choosing Save calls `resolve("save")`, which awaits `save()` and pushes only on `true`; on `false` the confirmation closes and the editor's field errors show as they do for any save.

Browser back button: while dirty, the page pushes one duplicate history entry (`history.pushState(history.state, "", location.href)`) and listens to `popstate`. Next's own `popstate` handler restores the same tree for the same URL, which re-renders the page without unmounting it; the page's listener then runs, sees the draft is dirty, re-pushes the duplicate and sets `pending = "back"`. Leaving resolves with `history.go(-2)` (the duplicate plus the real entry). When the draft becomes clean the page only forgets the entry; popping it with `history.back()` would race a navigation started in the same tick (a "Save and leave"), so the duplicate stays and costs one extra Back press after a save. The provider's "leaving" flag, which keeps `intercept` quiet while the leave navigation runs, resets on the next route change because the provider outlives the page. This relies on Next restoring rather than remounting for a same-URL entry; the walkthrough records whether it holds in the shipped Next version, and if it does not, the gap is documented in the README and the back button falls outside the guard (as it is today). Nothing else in the guard depends on it.

Alternative considered: a document-level capturing click listener on all anchors. Rejected because it intercepts downloads and external links, and `onNavigate` is the supported hook and already excludes them.

### 6. Edit affordance and dismissible hint

`icons.tsx` gains `EditIcon` (a pencil). `InlineField`'s resting button becomes a flex row with the value and a trailing `EditIcon` in `text-ink-muted` that turns `text-cobalt` on hover and focus; the existing `aria-label` already ends with "Edit". The selection hint in `FilePageClient` becomes a row with a dismiss button (`CloseIcon`, `aria-label="Dismiss hint"`) that sets the hint to `null`; `selectFromSource` and the keyboard attach control raise it again as today.

### 7. OverflowMenu on Base UI Menu

`OverflowMenu` keeps its props and names. `Menu.Root modal={false}` so the page keeps scrolling and the row's other controls stay usable; `Menu.Trigger` renders the existing `···` button with its `aria-label`; `Menu.Portal > Menu.Positioner side="bottom" align="end" sideOffset={4} > Menu.Popup` carries the current panel classes. Link entries use `Menu.LinkItem href download`; handler entries use `Menu.Item disabled={item.disabled} onClick`. Highlight styling moves to `data-highlighted:` variants. The hand-rolled focus index, `pointerdown` listener and key handling are deleted; Base UI provides Enter, Space and ArrowDown to open, arrows, Home and End, typeahead, Escape and focus return. The rendered roles (`button` with `aria-haspopup="menu"`, `menu`, `menuitem`) and names are unchanged, so `getByRole` selectors in the browser script keep working.

### 8. SpanPopover on Base UI Popover

`SpanPopover` becomes a controlled `Popover.Root open onOpenChange={(open) => { if (!open) onClose(); }} modal={false}`. The anchor is a `VirtualElement` built from `state.anchor` (`getBoundingClientRect: () => rect`, `contextElement` the document pane) so the popup follows the selection; with no rect it anchors to the document pane element itself. `Popover.Positioner side="bottom" align="start" sideOffset={8} collisionPadding={16}` with the default flip avoidance replaces the fixed-position arithmetic. `Popover.Popup` sets `initialFocus` to the checked radio when there are targets (first button otherwise) and `finalFocus` to the document pane, matching the current focus contract; `Popover.Title` carries the heading so the popup is labelled. Escape and outside press arrive through `onOpenChange` and call `onClose`, which `FilePageClient` already uses to clear state and refocus the document. Starting a new selection while the popover is open closes it on pointer down and the existing `onPointerSelect` opens a new one on pointer up, which is the current behaviour.

### 9. Tests and fixtures

- `stage.test.ts`: indexed has no primary and no `try-jd` anywhere in the view; `uploaded` offers "Start processing"; the per-status primary table from Decision 2.
- `copy.test.ts`: `ACTION_LABELS` has no "Try a job description"; `NOTICES.tryJd` has it.
- `experienceListContracts.test.ts`: the row navigates through `router.push(href)` guarded by a `closest(` check, renders no `ButtonLink` to `/`, and has no "Working…" text.
- `filePageContracts.test.ts`: `useApprovedView` fetches the export template and nothing else; `beforeunload` is added only inside the dirty effect; the leave confirmation offers the three labels from `LEAVE` in `copy.ts`; `TopBar`, `StageHeader` and `NoticeProvider` route navigation through `intercept(`; the `runIndexSequence(` count stays two.
- `experienceReviewContracts.test.ts`: the read-mode branches of the rail components reference no `InlineField`, `PillSelect`, `MISSING_SPAN`, `onRemove` or `onSelectFromSource`; `SpanPopover` imports `@base-ui/react/popover` and sets `collisionPadding` and `finalFocus`; `OverflowMenu` imports `@base-ui/react/menu` and uses `Menu.LinkItem`; neither file adds a `pointerdown` listener or computes `position: "fixed"`.
- `retryConflicts.browser.mjs`: route `GET /api/experiences/retry-fixture/revisions/*/export` to a minimal export (`revision` with zero experiences, empty `source_blocks`), because the indexed page now reads it; replace the final "Try a job description" link wait with a wait for the "Indexed · version 3" label and the absence of any primary button; assert the overflow still opens with `getByRole("menuitem")`.

### 10. Documentation

`app/lib/experience/README.md` step 7 is rewritten (indexed page shows the approved revision read-only, "Edit · starts draft for version N+1" and the overflow; the notice is the only Fit Check shortcut), step 1 gains "Start processing" for `uploaded`, and a dated walkthrough record is appended as the previous changes did. The top-level `README.md` has no sentence about "Try a job description" or the indexed page, so it is unchanged; `docs/handoff/fit-check-redesign.md` is a dated handoff note and is left as written.

## Risks / Trade-offs

- [Next may remount rather than restore on the duplicate history entry, so the back button bypasses the guard] → The sentinel is isolated in one effect; the walkthrough tests it explicitly, and the README records the outcome either way. The tab-close and in-app paths do not depend on it.
- [Base UI Menu defaults to `modal`, which locks page scroll and blocks outside pointer events] → `modal={false}` is set and the contract test asserts it.
- [Popover `outside-press` fires on the pointer down that starts a new selection, closing the current popover before the new one opens] → This matches today's behaviour; the walkthrough confirms a second selection opens a second popover.
- [The export read adds one request to every approved and indexed page load] → It is the same endpoint the page already uses for citations, fetched once per revision id; failure degrades to the header plus an in-place error.
- [Rows that navigate on click may swallow a click meant for text selection] → Collapsed-selection check before navigating; the filename link remains for keyboard users.
- [`ConfirmInline` grows a third action and is shared with delete] → The third action is optional and the delete usages do not pass it, so their markup is unchanged.

## Migration Plan

Client-only change behind no flag. Deploy with the usual build; rollback is a revert. No data, API or environment change.
