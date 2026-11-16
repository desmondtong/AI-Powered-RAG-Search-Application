# Proposal

## Why

The redesigned workspace explains itself permanently and reacts to the user silently. Every stage header renders a label, a guidance sentence and a detail block, and the copy deck filled all three for every state with tutorial prose, so a returning user with six indexed files reads "version 1" five times on one card, the same sentence six times on the list, and the six-stage legend on two pages. At the same time, every action writes its outcome into that same persisted-state view: buttons grey out, a pill flips in a header that is scrolled off-screen during review, removed items vanish with no undo, and a background stage change rewrites a row without a word. The Fit report has the same shape: four count tiles that do nothing, and the Weak and Missing cards at the bottom of a long scroll. Both symptoms come from the same cause, so they are fixed together, before the structural follow-up change (`settle-workspace-structure`) builds on the result.

## What Changes

- **Copy taxonomy.** Every string in the copy module is classed as a label (always shown), an instruction (shown only while there is a next action) or an explanation (shown once, on demand). Terminal states such as indexed get a label and one fact. List rows never carry a sentence that is identical across rows. The six-stage explanation lives in exactly two places: a collapsed "How it works" section on the Experience page and the Fit Check empty state. The standalone legend, the Fit Check intro paragraph, the drop-zone hint, the "Step N of 6" prefix under the stepper, and the duplicated indexed count on the Fit Check page are removed. The top-bar pill reads "N files indexed".
- **Copy authority.** The copy module in the code becomes the source of truth for wording. The Stitch project keeps authority over the Porcelain and Cobalt visual system only; its screens may show older copy.
- **Transient feedback layer.** A toast primitive with one polite live region reports outcomes that need no decision: draft saved, version approved, indexed and searchable (with a link to Fit Check), evidence or span removed (with Undo), file deleted, upload started, and a file that became ready for review while the list or page was polling. One toast at a time, bottom-left so it never covers the sticky gate rail, auto-dismissed after five seconds. Errors never become toasts; they stay inline exactly as today.
- **Pending state on controls.** The shared Button gains a busy state: a spinner replaces the leading icon, the button keeps its own colour and sets `aria-busy`. Busy is visually distinct from disabled and from the gate's locked state, which keeps its grey and lock icon. Short actions (save, approve, create draft, delete, upload, attach) show the spinner alone; long ones (index sequence, evaluate) keep their progress bar or skeleton as well.
- **Undo for local draft removals.** Removing an evidence item or a source span is undoable from the toast until it dismisses. Undo restores the item at its original position and marks the draft dirty. Deleting a file is not undoable, because the delete endpoint has no soft-delete, and the proposal says so.
- **Fit report filtering.** The four count tiles become pressable filters: pressing one shows only that group's cards, pressing it again shows all. In the unfiltered view the group headings stick under the top bar while their group scrolls. The filtered state is announced. The "Gaps to address" panel is replaced by a one-line gaps note shown in the Weak and Missing views, so the gap list is no longer duplicated below the cards. Group order stays Strong to Missing. The Evaluate loading state becomes a report skeleton instead of a sentence.
- **Fit Check page.** The headline becomes a short name, the intro paragraph is removed, and the footer line keeps only the character count and the keyboard shortcut.
- **UI primitive layer.** New generic widgets (toast, filter toggle group, tooltip, the "How it works" collapsible) are built on the headless Base UI library (`@base-ui/react`), styled with the existing tokens. The report's Diagnostics disclosure, today a native `<details>`, moves to the same Collapsible so both disclosures share one pattern. No other existing widget is migrated in this change. Domain components (document pane, rail, gate, stepper, inline field) remain hand-built.
- **Not in this change.** Removing the per-row and header "Try a job description" button, the read-only view of approved content on the indexed file page, the unsaved-edits leave guard, and migrating the popover and menus to Base UI. Those belong to `settle-workspace-structure`, which depends on this change being archived.

## Capabilities

### New Capabilities

None. Every behaviour here is a presentation rule of the existing workspace capability.

### Modified Capabilities

- `jd-fit-workspace-ui`:
  - **Two-destination navigation**: the status pill wording is shortened.
  - **Six-stage pipeline presentation**: the helper sentence is restricted to the next step or one state fact, and the pipeline explanation moves to one collapsed section per page.
  - **Fit Check input and empty state**: the intro paragraph goes; the empty state remains the one place the pipeline is explained on that page.
  - **Fit report presentation**: tiles become filters, group headings stick, the gaps panel becomes a note inside the Weak and Missing views, and loading shows a skeleton.
  - **Accessible workspace interactions**: one polite live region carries transient outcomes and filter announcements; busy controls expose `aria-busy`.
  - New requirements added to this capability: single-source stage explanation, no repeated row sentences, transient outcome notices, pending state on controls, undo for local draft removals, and Fit report filtering.

## Impact

- **Code.** `app/lib/experience/workspace/copy.ts` and `stage.ts` (strings and helper selection), `app/experience/_components/ui.tsx` (busy Button), a new toast provider mounted in `app/layout.tsx`, `app/components/TopBar.tsx`, `app/page.tsx`, `app/components/JdFitPanel.tsx`, `app/components/FitReport.tsx`, `app/lib/jdFit/ui.ts` (filter helpers), `app/experience/page.tsx` and `StageLegend.tsx` (collapsed "How it works"), `ExperienceRow.tsx`, `DropZone.tsx`, `FilePageClient.tsx` and `StageHeader.tsx` (slot rules, toast calls), `useDraftEditor.ts` (undo), `EvidenceCard.tsx`.
- **Dependency.** Adds `@base-ui/react`. No other new dependency.
- **API and data.** No API, request body, route or database change. The protected approval, indexing and state-transition logic is untouched.
- **Tests.** `stage.test.ts`, `jdFit/ui.test.ts`, `experienceListContracts.test.ts`, `filePageContracts.test.ts` and `experienceReviewContracts.test.ts` gain or adjust assertions. New unit tests cover the copy classes, the filter helpers and the undo buffer.
- **Docs.** `README.md`, `app/lib/experience/README.md` and `app/lib/jdFit/README.md` sentences that quote removed copy are updated. The browser walkthrough required by the project's apply guidance is recorded there as before.
