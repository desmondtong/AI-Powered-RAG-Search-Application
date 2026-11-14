# Proposal

## Why

After uploading an experience file, users can't tell what stage it is in or what to do next. The UI shows the data model instead of the journey. The review header shows revision UUIDs. The toolbar has up to eight conditional buttons. Evidence spans are edited by typing block IDs and character offsets. The list shows allowed actions as a comma-joined string. The upload modal closes on its own. The API already returns `status`, `actions[]` and `next_action` for every source, but the UI doesn't use them. Now that JD-fit is the only product (generic search was retired on 2026-11-14), the app can be rebuilt around one journey: upload → extract → parse → review → approve → index → evaluate a job description. The approved design is the Stitch project "JD Fit Check" (1236888499776878501) with the "JD Fit Check · Porcelain & Cobalt" design system.

## What Changes

- **Product identity and navigation.** The product is named **JD Fit Check** in the wordmark, page titles and `app/layout.tsx` metadata, replacing "RAG Search" and "Create Next App". The app has two destinations: **Fit Check** (`/`) and **Experience** (`/experience`). The top bar has a status pill reading "N files indexed and searchable".
- **BREAKING (URLs).** `/documents` becomes `/experience` and `/experiences/[id]` becomes `/experience/[id]`. The old paths permanently redirect to the new ones. API routes under `/api/experiences` and `/api/jd-fit` do not change.
- **Experience list.** The upload drop zone is inline on the page, so no modal closes on its own, and uploading opens the new file's page. Each file is a row with a six-stage stepper (Upload, Extract, Parse, Review, Approve, Index), a plain-language stage label, a one-line helper, exactly one primary button and a "···" overflow menu. A legend explaining the six stages sits at the bottom.
- **File page (`/experience/[id]`).** One header serves every stage. It shows the stepper, one sentence about what is happening, one primary action, and everything else in the overflow menu. Revision UUIDs no longer appear in the main view. Right after upload, the client runs extract and then parse back to back, using the two existing API calls. Each stage reports its own failure and offers its own retry.
- **Review, document-first (layout B).** The retained source text is the wide centre pane: used spans are highlighted, unassigned blocks are tinted, and each block is labelled b1, b2, and so on. The structured experiences sit in a sticky right rail. To attach a span, the user highlights text and picks a target in a popover. This produces the same `{block_id, start, end}` triple the API accepts today. It replaces the block-ID and offset form entirely, with no fallback.
- **Approval gate.** A single "Before you can approve" checklist combines the existing review acknowledgements, evidence items that have no source span, and the server's validation errors. The Approve button reads "Approve · N items left" until the gate is clear. When the gate is clear but there are unsaved edits, the button reads "Save & approve": it saves the draft first and approves only if the save succeeds. Approval rules themselves do not change.
- **Index and conflicts.** Indexing still starts only when the user clicks "Index now". That one click runs every batch of the existing index calls, with no further clicks, until the revision is published. On HTTP 409 `index-candidate-stale`, the page stops, refreshes, shows which version is searchable, which is the latest approved and which was not indexed, and waits for an explicit "Index version N" click or "Look at version N first".
- **Approved version numbers (read-only API addition).** Each approved revision gets a per-source number in approval order. Source summaries and detail return these numbers so the UI can say "version 3" as the mockups do. Drafts and never-approved revisions have no number.
- **Citation context labels (read-only JD-fit addition).** Each JD-fit citation also carries the experience title, experience type and evidence kinds, read from the cited approved revision. Report captions can then show "file · project · kind" from the single `POST /api/jd-fit` response.
- **Fit Check page.** The page opens with an intro and the JD input. The report shows four stat tiles (Strong, Partial, Weak, Missing), then requirement cards grouped by fit label with a rationale and a quoted citation, then an "Open in source" link into the file page, a "Gaps to address" panel and collapsed diagnostics. When no file is indexed, the page shows an empty state that points to "Upload experience file".
- **Visual system.** Porcelain & Cobalt tokens for light and dark themes. Dark mode follows the operating-system setting on every screen. Headings use Nunito Sans and body text uses Source Sans 3, with no monospace. Semantic colours each have one job: cobalt for actions and sourced evidence, sand for unassigned text, amber for "needs attention", green for "done", and red only for destructive or failed states.

Out of scope:

- Any change to API routes, request bodies, the ingestion state machine, validation, approval rules, indexing batch size or publication, JD-fit retrieval scope, or model calls. The only API changes are the two read-only response additions above.
- Database migrations. Version numbers are computed from existing `approved_at` values, and citation labels are read from existing approved revision content.
- A manual theme toggle, mobile-specific layouts beyond stacking panes at narrow widths, and cancelling an in-flight extract or parse.

## Capabilities

### New Capabilities

- `jd-fit-workspace-ui`: the browser workspace for JD Fit Check. It covers product identity and navigation, routes and redirects, the experience list, the file page's stage presentation and client-side extract→parse chaining, document-first review with highlight-to-attach spans, the merged approval gate, explicit indexing and the 409 conflict presentation, the Fit Check page and report presentation, and the light and dark visual system. It owns presentation rules only. It relies on `structured-project-ingestion` and `jd-fit-evaluation` for behavior and must not contradict them.

### Modified Capabilities

- `structured-project-ingestion`: adds the requirement "Approved version numbers". Existing requirements are unchanged; revision IDs stay the only identifiers actions accept.
- `jd-fit-evaluation`: adds the requirement "Citation context labels". Existing requirements are unchanged: citations still resolve to retained source spans, and the label lookup is read-only.

All other presentation rules go into the new UI capability instead of being spread across the backend specs. The existing backend requirements, such as human review, the resumable lifecycle, actionable outdated-indexing conflicts, citation grounding and visible gaps, remain satisfied as written.

## Impact

- **Routes and pages.** New `app/experience/page.tsx` and `app/experience/[id]/page.tsx`. Removed `app/documents/page.tsx` and `app/experiences/[id]/*`. Permanent redirects for `/documents` and `/experiences/:id` go in `next.config.ts`. Rewritten `app/page.tsx` and `app/layout.tsx`, which gets metadata, fonts and the theme.
- **Components.** `Navigation.tsx` becomes the top bar with the status pill. `JdFitPanel.tsx` is rebuilt around the new report layout. `UploadModal.tsx` is replaced by an inline drop zone. `ExperienceReviewClient.tsx`, currently 1,111 lines, is split into a stage header, a document pane, an experience rail, a span popover and an approval gate.
- **Client helpers.** A new pure presentation module maps `status`, `actions`, `failure` and revision data to a stepper state, stage label, helper text, primary action and overflow actions. It also builds the gate checklist, maps a DOM text selection to a span triple, and resolves a citation to a source span. `app/lib/experience/uploadUi.ts` and `app/lib/jdFit/ui.ts` are updated for the new copy and fit-label tokens.
- **Styling.** `app/globals.css` gains Porcelain & Cobalt tokens as Tailwind v4 theme variables, with a `prefers-color-scheme: dark` override. Nunito Sans and Source Sans 3 are loaded through `next/font/google`, replacing Geist.
- **Tests.** Static UI contract tests that read the old file paths or assert old copy are rewritten for the new files and copy: `documentsPageContracts`, `experienceReviewContracts`, `uploadUi`, `workflowDocs`, and the UI section of `jdFit/ui.test.ts`. The invariants those tests protect are kept. The browser fixture `retryConflicts.browser.mjs` moves to `/experience/[id]` and the new button labels. New unit tests cover the presentation module.
- **API additions.** `app/lib/experience/apiService.ts` adds `active_version_number` and `latest_approved_version_number` to source summaries, and `approved_versions[]` to source detail. `app/lib/jdFit/contracts.ts`, `context.ts` and `retrieval.ts` add `experience_title`, `experience_type` and `evidence_kinds` to citations through one read-only query of the cited revisions' approved content. Route files under `app/api/**` do not change.
- **Eval fixtures.** `app/lib/ragQualityEvals` adapters, scenarios and anchor tests that build JD-fit citations gain the new fields. The `rag-quality-evals` spec is unaffected.
- **Docs.** The browser steps in `app/lib/experience/README.md` and `app/lib/jdFit/README.md` are updated to the new routes and labels, and both READMEs document the new response fields.
- **No changes** to the ingestion state machine, approval, indexing or publication logic, JD-fit retrieval scope or prompts, Supabase migrations or remote data.
- **Housekeeping.** `docs/handoff/fit-check-redesign.md` asks to be deleted once this change is proposed. That deletion is left to the user.
