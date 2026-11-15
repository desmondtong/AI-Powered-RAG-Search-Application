# Design

## Context

See proposal.md for motivation. The facts that shape the approach:

- All wording lives in `app/lib/experience/workspace/copy.ts`; `stage.ts` maps API state to `{ label, helper, tone, primary, secondary, overflow }` and both `ExperienceRow` and `StageHeader` render label and helper unconditionally. `StageHeader` adds a `detail` slot that `FilePageClient` fills with processing, indexing, notice and error paragraphs.
- Feedback is derived state only. Hooks (`useDraftEditor`, `useStageRunner`, `useIndexSequence`) expose `phase`, `running`, `errors` and callers re-render from them. There is no event channel, no toast, no spinner icon, and the shared `Button` has only `disabled`.
- The header is not sticky; the gate rail is. During review the save status pill in the header is off-screen.
- Polling (`usePolling`) refreshes the summary or detail; nothing diffs the previous state against the new one.
- The project has Tailwind v4 with the default palette removed and no component library. Dark mode is a token swap under `prefers-color-scheme`.
- Static contract tests in `app/lib/experience/*Contracts.test.ts` and `app/lib/jdFit/ui.test.ts` assert fetch targets, component presence and some copy keys by reading source files.
- The project's apply guidance requires a real browser walkthrough for UI changes.

## Goals / Non-Goals

**Goals:**
- Make every string's job explicit (label, instruction, explanation) and enforce it in the stage mapping, so the rule survives future copy edits.
- Add a transient feedback channel and a pending-state primitive that every existing action can use without changing any request, body or sequence.
- Make the Fit report tiles do the one thing a user expects of them.
- Introduce the headless primitive layer in a way that later changes can extend.

**Non-Goals:**
- Changing which actions exist, which is primary, or what any endpoint receives. `settle-workspace-structure` owns those.
- Migrating existing widgets (menu, popover, confirmation, selects) to Base UI.
- Persisting toasts, report filters or dismissed explanations across reloads.
- Any autosave of the draft.

## Decisions

### 1. Copy classes are a type, not a convention

`copy.ts` keeps its named constants, but every stage-facing string is tagged: `label`, `instruction` or `explanation`. `toStageView` returns `helper` only from `instruction` or `fact` strings; `explanation` strings are exported separately and consumed only by `HowItWorks` and `FitEmptyState`. A unit test walks every row of the stage mapping and asserts that no `helper` contains an `explanation` string and that no `helper` repeats the version number already in its `label`.

Alternative considered: a one-off copy edit. Rejected because the last change already had a copy deck and the repetition came back through the slot structure, not through any single sentence.

### 2. Per-state copy after the pass

| State | Label | Helper | Meta line additions |
|---|---|---|---|
| uploaded | Uploaded | Continue processing to read the text. | Uploaded `<time>` |
| extracting / parsing | Extracting text / Finding projects and evidence | Page: You can leave this page. Row: *(none)* | |
| extracted | Text extracted | Continue processing to find the projects in it. | |
| draft (new) | Draft for version N · ready for review | Page: We found X experiences and Y evidence items, with W extraction warnings and U unassigned blocks to check. Row: the review instruction. | |
| draft (started) | Draft for version N · in review | Check each experience against the source, then approve. | |
| indexed + draft | Indexed · version N · new draft in review | The indexed version stays searchable until the new draft is approved and indexed. | |
| approved | Version N approved · not indexed | Index now to make it searchable in Fit Check. | Approved `<time>` |
| indexing (no sequence) | Indexing version N | Indexing stopped part-way; continue indexing to finish. | |
| indexing (running here) | Indexing version N | Keep this page open until it finishes. | |
| indexed (row) | Indexed · version N | *(none)* | Indexed `<time>` |
| indexed (page) | Indexed · version N | X experiences, Y evidence items searchable since `<time>`. | Approved `<time>` |
| failed | `<Stage>` failed | *(API message)* | |
| cleanup-pending | Deleted · cleanup pending | Retry cleanup to remove the stored original. | |

Removed outright: the Fit Check intro paragraph, the Experience subtitle's stage count, the drop-zone hint, "Step N of 6 ·" prefixes, the "Any query against this file cites exact sentence spans" sentence, the indexed count in the Fit Check footer, and the standalone `StageLegend` on the list. The approved-state four-sentence helper collapses to the one line above; the "indexing is a separate step you start yourself" explanation moves into the How it works text for the Approve stage.

### 3. Explanation placement

`StageLegend` becomes `HowItWorks`: a Base UI Collapsible on the Experience page, collapsed by default, holding the six sentences. A shared `Disclosure` wrapper in `ui.tsx` (Collapsible root, a trigger styled as the existing label-caps heading with a rotating chevron, and a panel) is used here and replaces the native `<details>` in the report's `Diagnostics`, so the two disclosures in the app look and behave the same, including the `aria-expanded` trigger and a height transition that respects `prefers-reduced-motion`. Open state is per page and nothing is persisted. `FitEmptyState` keeps its ordered list; it is the other permitted location.

Alternative considered: native `<details>`, which needs no JavaScript. Rejected in favour of one consistent disclosure primitive now that the Base UI layer exists. The Stitch project is noted in the proposal as no longer authoritative for wording, so no Stitch update is part of this change.

### 4. One toast provider at the root

`@base-ui/react` Toast is mounted once in `app/layout.tsx` as `NoticeProvider`, wrapping `WorkspaceSummaryProvider` and the pages. The root layout persists across client navigations in the Next app router, so a notice raised just before `router.push("/experience")` (delete from the file page) is still visible on the list. A thin `useNotice()` hook wraps `useToastManager` and exposes `notice.success(text, { action?: { label, onClick | href } })` and `notice.info(...)`. No `error` method exists on the hook, which is how the "errors stay inline" rule is enforced in code rather than by review.

Settings: `limit={1}`, `timeout={5000}`, viewport fixed bottom-left with a 16px gutter on desktop and full-width bottom on viewports under 640px, `role="status"` region supplied by Base UI, Escape and a close button dismiss, hover pauses the timer (Base UI default). Toasts carry at most one action.

Alternative considered: a hand-written toast. Rejected because the queue, pause-on-hover, focus handling and live-region wiring are exactly the edge cases a primitive gets right and a hand-rolled one gets wrong; this is also the designated entry point for the Base UI layer.

### 5. Where notices are raised

| Event | Raised from | Text | Action |
|---|---|---|---|
| Draft saved | `useDraftEditor.save` success | Draft saved. | |
| Approved | `useDraftEditor.approve` success | Version N approved. | |
| Indexed | `useIndexSequence` stop reason `indexed` | Version N is searchable in Fit Check. | Try a job description → `/` |
| Evidence removed | `useDraftEditor.removeEvidence` | Evidence removed. | Undo |
| Span removed | `useDraftEditor.removeEvidenceSpan` | Span removed. | Undo |
| Upload started | `DropZone.upload` after 2xx | Uploaded `<file>`. | |
| Draft created | `createDraftFromApproved` success | Draft for version N+1 created. | |
| Deleted | `remove` success (list and page) | Deleted `<file>`. | |
| Cleanup pending | `remove` success with `cleanup-pending` | Deleted `<file>`; the stored original is still to be removed. | |
| Ready for review | transition hook | `<file>` is ready for review. | Open → file page |
| Became searchable elsewhere | transition hook | `<file>` is searchable. | Open |

Hooks receive the `notice` object as a parameter rather than importing it, so the static contract tests keep seeing all fetch sites in the same files and the hooks stay testable without a provider. A notice is raised only after the request succeeded and state was refreshed; a failure path never reaches a `notice.*` call.

### 6. Transition detection for polling

A small `useStageTransitions(sources | detail, notice)` hook keeps the last seen `status` per source id in a ref and, on each refresh, raises a notice for `parsing → draft` and `indexing → indexed`. It raises nothing on first mount, nothing for a transition the current page itself caused (the hooks already notice those), and at most once per source per transition. The file page passes `[detail.source]`, the list passes `sources`. The top-bar provider does not raise notices, so a page is never notified for a change it is not showing.

### 7. Busy state on `Button`

`Button` gains `busy?: boolean`. When busy it sets `disabled` and `aria-busy="true"`, renders `SpinnerIcon` (new, in `icons.tsx`, `animate-spin`, respects `prefers-reduced-motion`) in place of the first child icon, and applies the variant's normal colours via an `aria-busy:` Tailwind variant so the disabled grey does not apply. Locked stays `disabled` without `busy` and keeps `LockIcon`. Every call site that currently swaps label text ("Saving…", "Evaluating…", "Creating draft…") keeps the text swap and adds `busy`. The index and evaluate buttons add `busy` without removing their progress bar or the new skeleton.

### 8. Undo buffer in `useDraftEditor`

`removeEvidence` and `removeEvidenceSpan` return an `UndoToken = { restore(): void }`. The token captures the removed item (deep clone), its indices and the draft `revision_id`. `restore` calls `update` to splice the item back at the original index, which marks the draft dirty; it is a no-op when the current draft's `revision_id` differs. `FilePageClient` passes `token.restore` as the toast action. Nothing is stored beyond the token held by the toast, so an expired toast drops the token and the removal stands. No request is involved on either side.

### 9. Fit report filter

`app/lib/jdFit/ui.ts` gains `filterGroups(groups, fit | null)` and `filterAnnouncement(fit, count)`. `FitReport` holds `const [filter, setFilter] = useState<JdFitFitLabel | null>(null)`. The tile row becomes a Base UI Toggle Group (single select, deselectable) whose items keep the current tile markup plus `aria-pressed` styling (stronger border on the pressed tile, slightly dimmed others). In the unfiltered view group headings get `sticky top-14 z-10 bg-ground`. The filtered view renders one group with no heading. An empty group shows "No requirements are Weak" and a "Show all" button. `GapsPanel` is deleted; `FIT_CHECK.gapsNote` renders under the heading in the Weak and Missing views when `report.gaps.length > 0`. Announcements go through the existing `aria-live="polite"` wrapper in `JdFitPanel` via a visually hidden message element, not through the toast region. Filter state is not in the URL because the report itself does not survive a reload.

### 10. Loading skeleton

`FitReportSkeleton` renders four tile placeholders and three card placeholders with `animate-pulse` washes from the tokens, replacing the loading sentence. The sentence's one useful fact, that this can take up to a minute, moves into the skeleton's caption.

### 11. Base UI boundary

Added now: Toast, Toggle Group, Tooltip (used for the dot stepper titles on list rows and the "Edit" note that is currently a `title` attribute), and Collapsible through the shared `Disclosure` wrapper (How it works, Diagnostics). Not migrated: `OverflowMenu`, `SpanPopover`, `ConfirmInline`, `PillSelect`, checkboxes, progress bars; `settle-workspace-structure` takes the first two. Domain components never migrate. All Base UI parts are styled with the existing token utilities only; no Base UI CSS is imported.

### 12. Tests

- `copy.test.ts` (new): every stage helper is at most one sentence, contains no explanation string, and does not repeat its label's version number.
- `stage.test.ts`: indexed row helper is empty; indexed page helper has counts and time once; approved helper is one line.
- `summary` / `transitions.test.ts` (new): the transition hook's pure core raises once per transition, never on first sight, never for same-status refreshes.
- `jdFit/ui.test.ts`: `filterGroups`, `filterAnnouncement`, `FitReport` contains `ToggleGroup` and no `GapsPanel`, `JdFitPanel` renders the skeleton while loading, and the existing "renders every documented UI state" list is updated.
- `filePageContracts.test.ts` / `experienceReviewContracts.test.ts`: `useNotice` is never called with an error string, `notice.*` calls appear only after `response.ok` branches, removal handlers return an undo token, and the toast provider is mounted in `app/layout.tsx` only.
- `experienceListContracts.test.ts`: `StageLegend` is gone, `HowItWorks` uses the shared `Disclosure`, no row renders a helper for `indexed`. `jdFit/ui.test.ts`: `Diagnostics` uses `Disclosure` and no `<details>` remains in `app/components` or `app/experience`.
- Browser walkthrough per the project's apply guidance: save, approve, index, remove with undo, delete from both places, a background transition, the filter tiles with keyboard, light and dark.

## Risks / Trade-offs

- [Two live regions (the sr-only stage label and the toast region) announce the same event twice] → The stage label region announces only the stage label; toast text never equals a stage label; the transition hook does not raise for transitions the page's own hooks already announced.
- [Bottom-left toast covers content on narrow viewports] → Under 640px the viewport is full-width at the bottom and the page keeps a bottom padding equal to one toast height while a toast is shown.
- [Sticky group headings collide with the sticky top bar or the sticky rail] → Headings use `top-14` to sit under the 56px bar and a z-index below the bar's; the report page has no rail.
- [Base UI minor releases change part names or props] → Pin an exact version in `package.json`; the three parts used are wrapped in local components so a rename touches one file each.
- [Copy tests become brittle as wording evolves] → Tests assert properties (sentence count, no explanation strings, no repeated version) and copy-module keys, never full sentences.
- [Undo restores an item into a draft the server has since rejected] → Restore only re-applies a local edit and marks dirty; the next save goes through the existing version check and field errors as any edit would.
- [Removing "Gaps to address" loses a one-glance list for users who liked it] → The Missing tile is that list one press away, and the gaps note keeps the explanatory sentence.

## Migration Plan

No data or API migration. The change ships as one deployment; rollback is a revert. The `@base-ui/react` dependency is additive. Docs that quote removed copy are updated in the same change so the README contract tests keep passing.
