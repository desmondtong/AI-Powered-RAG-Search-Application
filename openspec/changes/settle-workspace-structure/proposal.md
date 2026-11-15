# Proposal

## Why

Once `tighten-workspace-copy-and-feedback` has removed the repeated prose and added the feedback layer, four structural habits of the workspace remain visible. Six indexed rows each carry an identical primary "Try a job description" button that duplicates a top-bar destination. The indexed file page is mostly empty because the approved content is only reachable through a developer-facing JSON view. Unsaved review edits are lost silently on navigation, since inline fields commit to local state and nothing guards the page. And two generic widgets, the span popover and the overflow menu, still hand-roll positioning and focus handling that the Base UI layer introduced by the first change now provides. This change settles those, and it must follow the first change because its design should be written against the trimmed copy and the notice layer, and because both changes would otherwise modify the same spec requirements.

## What Changes

- **Remove "Try a job description".** The action leaves the stage mapping, the list rows and the file-page header. An indexed row shows its label, meta line and overflow menu only, with the whole row acting as the link. An indexed file page shows "Edit · starts draft for version N+1" and the overflow menu. The only remaining shortcut to Fit Check from an indexing outcome is the transient notice the first change added. **BREAKING** for the "One primary action per stage" rule as written: indexed becomes the one state with no primary action.
- **Quiet rows.** A primary button appears on a row only when that file needs the user: draft awaiting or in review, approved awaiting indexing, interrupted indexing, failure with a retry, or cleanup pending. Terminal and in-progress rows carry no button.
- **Read-only approved view.** The indexed and approved file pages render the latest approved revision's experiences and evidence in the existing rail layout in a read-only mode: no inline editing, no pill selects, no remove or span controls, with "Source: bN" links that open the document pane to the cited span. "Inspect accepted JSON" stays in the overflow menu as the raw view.
- **Unsaved-edits guard.** While a draft has unsaved edits, closing the tab, reloading or typing a new URL triggers the browser's own leave prompt, and activating an in-app link (top bar, breadcrumb, notice actions) is intercepted to show the existing in-page confirmation with "Save and leave", "Leave without saving" and "Stay". The browser back button is covered by the same intercept where the platform allows it, and the design records any gap.
- **Review affordances.** Click-to-edit fields show a visible edit affordance before hover. The selection hint banner in the review workspace can be dismissed. "Continue processing" on a file that has never been processed reads "Start processing"; a file left in `extracted` keeps "Continue processing".
- **Base UI migration of two widgets.** `SpanPopover` moves to the Base UI Popover with collision-aware positioning and `OverflowMenu` to the Base UI Menu, each keeping its current keyboard behaviour and markup contracts. `ConfirmInline`, `PillSelect`, checkboxes and progress bars are not migrated here.
- **Depends on** `tighten-workspace-copy-and-feedback` being archived first. Its notice hook, busy button and trimmed copy are prerequisites, and its spec deltas must be synced before this change's deltas are written against them.

## Capabilities

### New Capabilities

None. All behaviour belongs to the existing workspace capability.

### Modified Capabilities

- `jd-fit-workspace-ui`:
  - **One primary action per stage**: becomes "at most one"; indexed, extracting, parsing and cleanup-complete states carry none; the try-JD scenario is removed.
  - **Explicit indexing sequence**: the "Indexing completes" scenario no longer ends with "Try a job description" as the primary action.
  - **Client-chained extract and parse**: the never-processed state offers "Start processing".
  - **Rail-based draft corrections**: adds the unsaved-edits guard behaviour and the visible edit affordance.
  - **Document-first review layout**: adds the read-only mode for approved revisions on indexed and approved file pages.
  - **Highlight-to-attach source spans**: the dismissible selection hint.
  - New requirements added to this capability: quiet rows, read-only approved content view, and leave guard for unsaved edits.

## Impact

- **Code.** `app/lib/experience/workspace/stage.ts` and `copy.ts` (action removal, label change, primary rules), `ExperienceRow.tsx`, `FilePageClient.tsx` (read-only rail wiring, guard, hint dismissal), `ExperienceRail.tsx`, `EvidenceCard.tsx` and `InlineField.tsx` (read-only mode and affordance), a new `useLeaveGuard` hook, `SpanPopover.tsx` and `OverflowMenu.tsx` (Base UI migration), `StageHeader.tsx`.
- **Dependencies.** None beyond `@base-ui/react`, already present after the first change.
- **API and data.** No API, request body, route or database change. The read-only view uses the detail response and the existing revision export endpoint only.
- **Tests.** `stage.test.ts` (no try-JD action, primary rules per state, "Start processing"), `experienceListContracts.test.ts`, `filePageContracts.test.ts` and `experienceReviewContracts.test.ts` (read-only mode has no editing controls, guard intercepts internal links and never sends a request, popover and menu keep their keyboard contracts). `retryConflicts.browser.mjs` is updated for the Base UI menu and popover selectors.
- **Docs.** `README.md` and `app/lib/experience/README.md` sentences describing "Try a job description" and the indexed page are updated, and the browser walkthrough is recorded as required by the project's apply guidance.
- **Sequencing.** Design, spec deltas and tasks for this change are written only after `tighten-workspace-copy-and-feedback` is archived and its deltas are synced into `openspec/specs/jd-fit-workspace-ui/spec.md`.
