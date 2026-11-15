# Design

## Context

See proposal.md for why this change is needed and specs/jd-fit-workspace-ui/spec.md for the requirements. This section covers only what shapes the approach.

- **The UI is three client pages over a stable API.** `app/page.tsx` renders `JdFitPanel`. `app/documents/page.tsx` lists sources and opens `UploadModal`. `app/experiences/[id]/ExperienceReviewClient.tsx` is 1,111 lines and does all of loading, actions, form editing, gating and indexing. The only server code the UI touches is `/api/experiences/**` and `/api/jd-fit`. Their routes and request bodies don't change; two responses gain read-only fields (Decisions 4 and 10).
- **What the API already provides.**
  - Each source summary has `status`, `actions` (from `availableExperienceActions`), `failure.{stage,code,message,recoverable_action}`, `cleanup_error`, `active_revision_id`, `latest_approved_revision_id` and `latest_draft_revision_id`.
  - The detail response adds `latest_extraction.blocks[]` (`block_id`, `order`, `text`), `latest_revision` with `draft_json.canonical_revision`, `source_warnings` and `omitted_block_coverage`, and `revisions[]`: the five most recent rows, each with `status`, `draft_version`, `created_at` and `approved_at`.
  - Upload returns `upload_state: "uploaded" | "already-uploaded"` and `next_action`.
  - Index is batched. Each call returns either `status: "indexing"`, `next_action: "index"` with `progress` (prepared and remaining chunks), or `status: "indexed"`.
  - JD-fit citations carry `source_id`, `source_file_name`, `revision_id`, `logical_experience_id`, `evidence_logical_ids`, `source_span {block_id,start,end}` and `quote`. They do not yet carry the project title or the evidence kind. Child chunk metadata has `evidence_kinds`, but the experience title exists only in the revision's `approved_json` (and inside embedding header text).
  - `experience_revisions` has no version column. Each approval sets an immutable `approved_at`, and edits create new revision rows.
  - The server prepares embeddings in batches of `EXPERIENCE_EMBEDDING_PREPARATION_BATCH_SIZE` (default 3) per index request, which keeps each request within its execution deadline.
- **Span offsets index into `block.text`.** They are UTF-16 code units, matching `block.text.slice(start, end)` in `app/lib/experience/contracts.ts`.
- **Static contract tests read page source files by path.** `documentsPageContracts`, `experienceReviewContracts`, `workflowDocs` and `jdFit/ui.test.ts` assert copy and fetch calls. The browser fixture `retryConflicts.browser.mjs` drives `/experiences/retry-fixture` by button names. Renaming files or copy breaks these tests, so they must move with the UI.
- **Approved design.** It is the Stitch project "JD Fit Check" (1236888499776878501) with the design-system asset `assets/97bc7c667b4e47129720a93547d53a3b`. It has light and dark screens for: Experience list, Experience pipeline states, Review (`experience-2026.docx`), Fit Check report, and Fit Check empty state. The user's decisions on 2026-11-14 are: layout B (document-first review), Warm Paper typography (Nunito Sans and Source Sans 3, no monospace), the Porcelain & Cobalt scheme, dark mode required, the product named "JD Fit Check", routes renamed with redirects, and no manual span form.

## Goals / Non-Goals

**Goals:**
- Move all status-to-presentation logic into pure, unit-tested functions. Components then render a view model and never branch on raw status strings.
- Break the review screen into components small enough to read and test, with the same API calls and payloads as today.
- Make light and dark themes a token swap, not per-component `dark:` classes.
- Keep every existing safety property: explicit indexing, no automatic retry after a 409, the draft-version check on save and approve, and no JD-fit call besides `POST /api/jd-fit {jdText}`.

**Non-Goals:**
- No new routes, request fields or query parameters on the API, and no Supabase migrations. The only API changes are the read-only response fields in Decisions 4 and 10.
- No change to the server's index batch size or to indexing and publication logic.
- No client-side state library, data-fetching library or component kit. The app keeps React state and `fetch`, as it does today.
- No manual theme toggle, no persistence of UI preferences, no cancelling an in-flight stage.

## Decisions

### 1. One new UI capability; backend specs only gain two ADDED requirements
All presentation rules go in `jd-fit-workspace-ui`. Existing requirements in `structured-project-ingestion` and `jd-fit-evaluation` keep their wording because the redesign still satisfies every scenario in them. For example, the 409 scenarios already require refresh, an explicit action and a visible distinction between active and candidate revisions. The two new data contracts are ADDED requirements in their owning capabilities: "Approved version numbers" in `structured-project-ingestion` and "Citation context labels" in `jd-fit-evaluation`.
- *Alternative:* MODIFIED deltas on the four ingestion requirements and three JD-fit requirements named in the handoff. Rejected because it would mix button labels into backend contracts, and the delta rules would force carrying every existing scenario through unchanged.

### 2. Routes and redirects
New files are `app/experience/page.tsx` and `app/experience/[id]/page.tsx`. `app/documents/` and `app/experiences/` are deleted. `next.config.ts` gains `async redirects()` with `{ source: "/documents", destination: "/experience", permanent: true }` and `{ source: "/experiences/:id", destination: "/experience/:id", permanent: true }`. Next.js returns a 308 for these.
- *Alternative:* keep the stub pages and call `redirect()` from them. Rejected because config redirects run before rendering and need no page files.

### 3. Pure presentation model
A new module, `app/lib/experience/workspace/`, is compiled by the existing `tsconfig.experience-tests.json` glob, so it needs no new test config. Its parts:
- **`stage.ts`.** `toStageView(source, detail?)` returns `{ steps: StepState[6], label, helper, tone, primary: Action | null, overflow: Action[] }`. `StepState` is one of `done | current | running | failed | upcoming`. `Action` has an `id` (`continue-processing`, `retry-extract`, `retry-parse`, `start-review`, `continue-review`, `index-now`, `continue-indexing`, `retry-index`, `try-jd`, `edit-approved`, `reparse`, `download-original`, `inspect-json`, `delete`, `retry-delete`, `upload-different`, `open`) and a label. The function only offers actions present in `source.actions`, `failure.recoverable_action`, or the existing UI conditions (`canCreateDraftFromApproved`, `canRetryDelete`, export availability).
- **`gate.ts`.** `buildApprovalGate(draft, detail, fieldErrors, dirty)` returns checklist items and `remaining`.
- **`selection.ts`.** `rangeToSpan(container, range)` and `spanCovers(...)`, plus their pure core `offsetsWithin(blockText, prefixLength, selectedText)`.
- **`revisionLabels.ts`.** "Version N" for approved revisions from the API's version numbers, "Draft for version N+1" for an open draft, and the formatted `approved_at` as secondary detail.
- **`summary.ts`.** `countIndexed(sources)`, which counts sources with a non-null `active_revision_id`.

Stage mapping (status → step states; S = step):

| status | S1 Upload | S2 Extract | S3 Parse | S4 Review | S5 Approve | S6 Index | primary |
|---|---|---|---|---|---|---|---|
| uploaded | done | upcoming | upcoming | upcoming | upcoming | upcoming | Continue processing (or auto-chain) |
| extracting | done | running | upcoming | … | … | … | none |
| extracted | done | done | upcoming | … | … | … | Continue processing |
| parsing | done | done | running | … | … | … | none |
| draft | done | done | done | current | upcoming | upcoming | Start review / Continue review |
| approved | done | done | done | done | done | current | Index now |
| indexing | done | done | done | done | done | running | Continue indexing |
| indexed | all done (S6 shows "Indexed") | | | | | | Try a job description |
| indexed and latest_draft newer than active | S1–S3 done | | | current "Review (new draft)" | upcoming | upcoming | Continue review |
| failed | done up to `failure.stage`; that step is failed | | | | | | the recoverable retry |
| cleanup-pending | neutral | | | | | | Retry delete |

`failure.stage` maps to a step as follows: `extracting → S2`, `parsing → S3`, `indexing → S6`. Any other value falls back to labelling the failure without marking a step.
- *Alternative:* keep the conditionals inline in components, as today. Rejected because that is the source of the eight-button toolbar, and those conditionals can't be unit-tested.

### 4. Approved version numbers computed on the server
The Stitch mocks say "version 3" and "draft v4". The UI needs a number per approved revision that is correct however long the history is, so the server computes it.
- **Rule.** For one source, take every revision with a non-null `approved_at` and order by `approved_at`, then `id` as a tiebreak. The 1-based position is the version number. Approval timestamps are immutable, so numbers never change. Drafts, re-parsed drafts and failed revisions that were never approved get no number.
- **Where it is computed.** A pure function `numberApprovedVersions(rows)` in `app/lib/experience/` turns `{id, approved_at}` rows into a map.
  - `getExperienceSourceDetail` runs one extra read (`select id, approved_at from experience_revisions where source_id = ? and approved_at is not null`) and adds `approved_versions: [{ revision_id, version_number, approved_at }]` to the detail response.
  - `sourceSummary` gains `active_version_number` and `latest_approved_version_number` (null when there is no such revision).
  - `listExperienceSources` runs one read across all sources' approved revisions and fills the same two summary fields per source.
- **UI labels.** "Version 3", "Draft for version 4" (latest approved + 1, or 1 when none exist), and the formatted `approved_at` as secondary detail. The 409 buttons are "Index version N" and "Look at version N first". The indexed state's secondary button is "Edit · starts draft for version N+1".
- **Not an identifier.** Every endpoint still takes revision IDs. The number is display-only.
- *Alternative:* a `version_number` column filled by the approve RPC. Rejected because it needs a migration and a backfill, and the computed value is equally stable.
- *Alternative:* dates only, with no numbers. Rejected by the user on 2026-11-15 in favour of matching the mockups.

### 5. Client-side extract→parse chain, started only after a new upload
`useStageRunner(sourceId)` exposes `runChain(from: "extract" | "parse")`. It POSTs `/extract`, refreshes the detail, and, only if the new status is `extracted`, POSTs `/parse` and refreshes again. Each step records its own error.
- **Auto-start handoff.** The upload handler writes `sessionStorage["jdfit:autostart:<id>"] = "1"` only when `upload_state === "uploaded"` and `status === "uploaded"`, then calls `router.push("/experience/<id>")`. The file page reads that key once, removes it, and starts the chain. A reload or a later visit finds no key and shows "Continue processing". A byte-identical re-upload (`already-uploaded`) never sets the key.
- **Lease conflicts.** A 409 from extract or parse, which means another execution owns the lease, triggers a refresh and polling. It is never re-POSTed.
- **Copy.** The Stitch copy "You can leave this page; it resumes where it stopped" is replaced with "You can leave this page. If it isn't finished when you come back, choose Continue processing." The client chain does not continue in the background, and the copy must not promise that it does.
- *Alternative:* auto-run any outstanding stage whenever the page opens. Rejected because parsing calls the model, so it costs money, and a stale tab would fire work without the user asking.

### 6. Index sequence loop
`runIndexSequence(revisionId)` is guarded by a ref, the same pattern as today's `indexRequestInFlight`. It POSTs `/index` with `{ revision_id }` and repeats while the response has `status === "indexing" && next_action === "index"`. Each step updates `progress`. There is no fixed step ceiling, so a file of any size indexes from one click. The loop stops on `indexed`, on an error, on a 409, when two consecutive responses report the same `remaining_chunks` (no progress), or when the component unmounts (an `AbortController` flag; no request is cancelled mid-flight).
- **Why the server batching stays.** Each request prepares only a few chunks (`EXPERIENCE_EMBEDDING_PREPARATION_BATCH_SIZE`, default 3) so it finishes within the request deadline and keeps its lease checkpoints. Doing every batch in one request would risk timeouts on larger files. The client chain gives the "all at once" experience without changing server behaviour.
- **Leaving the page.** There is no background worker, so a sequence runs only while the page is open. The request in flight still completes on the server. On return, the page offers "Continue indexing", and the copy says so: "Indexing · P of T chunks prepared. Keep this page open until it finishes."
- **On a 409.** The page reads `error.code`. For `index-candidate-stale` it shows the conflict panel (Decision 4 labels), refreshes, and disables all index actions until the refresh succeeds. For any other code it shows the server message. Neither case triggers a retry.
- **On a no-progress stop or unmounting.** The page shows "Continue indexing".
- The current UI already requires a separate click per batch call. Driving the batches from one click keeps the explicit-start rule, because the user clicked to index this specific revision. The 409 rule still stops the whole sequence.

### 7. Highlight-to-attach mapping
- **Rendering.** Each block renders its text inside `<div data-block-id=... data-block-text>` with `white-space: pre-wrap`. Highlights are nested `<mark>` elements whose concatenated text equals `block.text` exactly. Gutter labels and pills sit outside that element.
- **Mapping a selection.** On `selectionchange` or `mouseup` (and on a keyboard "Attach selection" button for keyboard users), the page finds the `[data-block-text]` ancestors of the anchor and focus.
  - If they differ, the popover says "Select text within one block."
  - Otherwise, `start` is the length of `Range(blockStart → selectionStart).toString()` and `end` is `start + selection.toString().length`. Leading and trailing whitespace is then trimmed inward.
  - Before offering "Add span", the page asserts `block.text.slice(start, end) === trimmedSelection`. If the assertion fails, no span is offered.
- **Popover.** It is anchored under the selection and lists the evidence items as "Experience title · kind · (no span)", with items that have no span first. Selecting "Add span" pushes the span onto `evidence.source_refs` and marks the draft dirty.
- **Edge cases.** Selecting text that is already highlighted works the same way. Overlapping spans on one item are allowed; the server's validation decides whether they are acceptable.
- *Alternative:* the CSS Custom Highlight API for marks. Deferred. Nested `<mark>` works everywhere and keeps the offset arithmetic simple.

### 8. Rail editing and the merged gate
- **Rail editing.** The rail shows field values with "from source, block N" captions, where N is the 1-based block order. Activating a value turns it into an inline input. Enum fields (kind, attribution, activity status) are small selects styled as pills. "Remove" deletes an evidence item; "×" on a span chip removes one span. Saving keeps today's PATCH body, `{ revision_id, expected_draft_version, draft }`.
- **Gate items.** The gate lists:
  1. The warnings acknowledgement checkbox, shown only when there are warnings.
  2. The unassigned-blocks acknowledgement checkbox, shown only when coverage reports unreferenced blocks. It lists their b-labels.
  3. "N evidence items still need a source span".
  4. "Nothing to index" when there are zero evidence items.
  5. One item per server field error from the last save or approve.

  Approve is enabled only when `remaining === 0`.
- **Save & approve.** Approve sends only `revision_id` and `expected_draft_version`, so unsaved local edits would silently not be approved. When the gate is clear and the draft is dirty, the button reads "Save & approve" and runs:
  1. PATCH the draft with the current `expected_draft_version`.
  2. If the save fails (field errors or a stale version), stop, show the errors in the gate, and send no approval.
  3. If the save succeeds, mark the draft clean and POST approve with the `draft_version` the save returned.
  4. If approval fails, the draft stays saved and clean, and the approval errors appear in the gate.

  The button is disabled while either request is in flight. The header's separate "Save draft" button remains for saving without approving.
- *Alternative:* debounced auto-save on every edit. Rejected (user choice, 2026-11-15) because it multiplies draft saves and version bumps.
- *Alternative:* a "Save first" checklist item. Rejected as an extra step with no safety benefit over Save & approve.

### 9. Workspace summary provider
`app/components/WorkspaceSummaryProvider.tsx` is a client context mounted in `app/layout.tsx`. It GETs `/api/experiences` on mount and on `refresh()`, and exposes `{ sources, indexedCount, status }`. The top bar pill, the Fit Check empty state, the report header ("N files searched") and the Experience list all read from it, and pages call `refresh()` after mutations. If the fetch fails, `indexedCount` is `null`. In that case the pill hides and Fit Check stays enabled (spec: "Index count is unavailable").
- This keeps `app/page.tsx`, `JdFitPanel.tsx` and `app/lib/jdFit/ui.ts` free of `/api/experiences`, so the existing JD-fit isolation assertion in `jdFit/ui.test.ts` still holds without changes.

### 10. Fit report presentation and citations
- **Report layout.** `app/lib/jdFit/ui.ts` gains `FIT_GROUP_ORDER`, `groupAssessmentsByFit` and fit-label token classes that use the new semantic tokens. It also gains `citationHref(citation)`, which returns `/experience/<source_id>?cite=<block_id>:<start>:<end>&rev=<revision_id>`. The report header shows "N requirements · M files searched · T s", where T is the client-measured elapsed time.
- **Citation labels in the pipeline.** `JdFitCitationSchema` gains `experience_title: string | null`, `experience_type: "project" | "general-experience"` and `evidence_kinds: EvidenceKind[]`.
  - After retrieval, the pipeline collects the distinct `revision_id`s of retrieved evidence. It reads their `approved_json` in one query (`select id, source_id, approved_json from experience_revisions where id in (...)`), scoped to the retrieved source IDs.
  - It builds a lookup from `logical_experience_id` to `{title, type}` and from evidence `logical_id` to `kind`.
  - `citationFromEvidence` fills the new fields. Kinds are de-duplicated in approved-JSON order.
  - On a failed read or a missing ID, the title is null and the kinds list is empty, and the report is still returned.
  - The query is read-only and only touches revisions retrieval already returned, so "No ingestion mutation" and "Active approved evidence retrieval" still hold. The lookup counts against the existing overall deadline.
- **Citation caption.** "file name · experience title · kinds". A null title shows "General experience" for general experience and is omitted for a project. Empty kinds are omitted.
- *Alternative:* the browser fetching each cited revision's export. Rejected (user choice, 2026-11-15) because it means extra requests per report. The pipeline gives everything in the one `POST /api/jd-fit` response.
- *Alternative:* store the title in chunk metadata at index time. Rejected because existing indexed files would need re-indexing to get it.
- **Opening a citation.** The file page parses `cite`. It highlights and scrolls only if the block exists in `latest_extraction.blocks` and `block.text.slice(start, end)` equals the decoded quote. Otherwise it shows the quote with the "different version" notice from the spec.

### 11. Theme tokens, fonts and icons
`app/globals.css` defines CSS custom properties on `:root`. A `@media (prefers-color-scheme: dark)` block overrides them, and `@theme inline` maps them to Tailwind v4 colour utilities (`bg-ground`, `bg-card`, `text-ink`, `border-hairline`, `bg-cobalt`, `bg-evidence-wash`, `bg-sand-wash`, `bg-amber-wash`, `text-green`, `text-red`, `bg-fit-strong`, …). Components use only these utilities, never `dark:` variants or literal hex values.

Fonts are `Nunito_Sans` and `Source_Sans_3` from `next/font/google`, exposed as `--font-heading` and `--font-body`. They replace Geist.

Icons are a small set of inline SVG components: check, close, more, upload, warning, error, lock, arrow, link, refresh and bolt. Material Symbols is not used, which avoids an icon webfont request.

Token values (light / dark):

| token | light | dark |
|---|---|---|
| ground | #F4F6F9 | #0F1218 |
| card | #FFFFFF | #151A24 |
| raised (popovers, menus) | #FFFFFF + shadow 0 8px 24px rgba(17,24,39,.08) | #19212E + shadow 0 8px 24px rgba(0,0,0,.4) |
| subtle surface | #FAFBFD | #19212E |
| hairline / strong border | #D5DBE5 / #94A3B8 | #252F3F / #2E3B4E |
| ink / secondary / muted / subtle | #111827 / #475569 / #64748B / #94A3B8 | #E4E8EE / #98A5B7 / #657285 / #657285 |
| cobalt / hover / on-cobalt | #1F3A93 / #172E77 / #FFFFFF | #6F8BE8 / #5C79DA / #0B1019 |
| evidence wash / border / text | #E8EEFF / #88A5E8 / #162C6E | rgba(111,139,232,.16) / #6F8BE8 / #E4E8EE |
| sand wash / border / label | #F9F4EB / #E4D5BC / #8D6B30 | rgba(220,190,140,.12) / rgba(220,190,140,.28) / #DCC296 |
| amber base / wash / border / text | #D97706 / #FEF3C7 / #FDE68A / #92400E | #E0A045 / rgba(224,160,69,.12) / rgba(224,160,69,.3) / #E0A045 |
| green base / wash / border | #15803D / #DCFCE7 / #BBF7D0 | #52B788 / rgba(82,183,136,.14) / rgba(82,183,136,.3) |
| red base / wash / border | #DC2626 / #FEE2E2 / #FECACA | #E56B6F / rgba(229,107,111,.14) / rgba(229,107,111,.3) |
| disabled bg / text | #E2E8F0 / #94A3B8 | #181F2C / #657285 |
| fit strong | #15803D on #DCFCE7 | #52B788 on 14% wash |
| fit partial | #B45309 on #FEF3C7 | #E0A045 on 12% wash |
| fit weak | #475569 on #E6EAF0 | #98A5B7 on 12% wash |
| fit missing | #991B1B on #FEE2E2 | #E56B6F on 12% wash |

Shapes and type:
- **Radius.** Buttons, inputs and chips are 8px. Cards, panels and popovers are 14px. Pills are fully rounded.
- **Type scale.** headline-xl is 32/40 at 700, headline-lg 24/32 at 700, headline-md 18/26 at 700, and title-sm 16/24 at 600, all in Nunito Sans. body-lg is 16/26, body-md 14/22, body-sm 13/18, label-md 12/16 at 600, and label-caps 11/14 at 600 with 0.08em tracking, all in Source Sans 3.
- **Layout.** The top bar is 56px. Content max width is 1040px for the list and 960px for Fit Check. Review uses up to 1536px on a 12-column grid, with the document taking 8 columns and the rail 4.

### 12. Component breakdown
- **Shell.** `app/components/TopBar.tsx` replaces `Navigation.tsx` and holds the wordmark, nav and status pill. `app/components/icons.tsx` holds the inline SVG icons.
- **Experience list.** `app/experience/page.tsx` renders the header, `DropZone` and a list of `ExperienceRow`s, followed by `StageLegend`.
- **File page.** `app/experience/[id]/FilePageClient.tsx` owns the detail, the runner and the index sequence. Its children are:
  - `StageHeader`, with the stepper, guidance line, primary button and `OverflowMenu`
  - `FailureInset`
  - `ConflictPanel`
  - `ReviewWorkspace`, which contains `DocumentPane`, `ExperienceRail` (built from `ExperienceCard`s and `EvidenceCard`s), `SpanPopover` and `ApprovalGate`
  - `AcceptedJsonPanel`, opened from the overflow menu
  - `ConfirmInline`, used for delete and retry-delete
- **Fit Check.** `app/page.tsx` renders the intro, `JdFitPanel` (input), and either `FitReport` (tiles, `RequirementCard`, `GapsPanel`, `Diagnostics`) or `FitEmptyState`.

### 13. Copy deck (from the approved light screens, adjusted per Decisions 5–6)

| Surface | Copy |
|---|---|
| Experience header | "Experience". Subtitle: "Your uploaded files. Each one moves through six stages before Fit Check can search it." |
| Drop zone | "Upload experience file". "Drop a DOCX or selectable-text PDF here, or browse. Max 10 MB." Hint: "Uploading takes you straight to the file." |
| Legend: The six stages | 1 · Upload: "Your file is kept privately. Nothing is searchable yet." |
| | 2 · Extract: "Text is pulled out and frozen as the source of every citation." |
| | 3 · Parse: "Projects and evidence are proposed, each tied to a sentence in the text." |
| | 4 · Review: "You check and fix the proposal. Only what the file says can be kept." |
| | 5 · Approve: "The reviewed version is frozen. Later edits start a new draft." |
| | 6 · Index: "Embeddings are prepared and the file becomes searchable in Fit Check." |
| Processing | "Reading the text in <file>, then finding the projects and evidence in it. Usually under a minute." Status line: "Step 1 of 2 · extracting" or "Step 2 of 2 · parsing". |
| Parsed | "We found N experiences and M pieces of evidence. W extraction warnings and U unassigned blocks to look at. Nothing is searchable until you approve." Primary: "Start review". |
| Review guidance | "Step 4 of 6 · Review. We found N experiences in your file. Check each one against the source, fix or remove anything that isn't supported, then approve." |
| Gate | Title: "Before you can approve". Items: "I've read the N extraction warnings". "I've checked the N unassigned blocks (b1, b7, …) and they don't belong in any experience". "N evidence items still need a source span". Footer: "Approving freezes version N. Indexing is a separate step you start yourself." Button: "Approve · N items left", "Save & approve" or "Approve". |
| Missing span | "No source span. Select the sentence in the document that says this, or remove the item." Actions: "Select from source", "Remove". |
| Approved | "Version N is approved and frozen. Indexing prepares embeddings so Fit Check can search it. It is the last step, and you start it. If an earlier version is indexed, it stays searchable until this one replaces it." Status line: "Approved version N · ready for indexing". Primary: "Index now". |
| Indexing | "Indexing · P of T chunks prepared". "Keep this page open until it finishes." |
| Indexed | "Searchable in Fit Check since <time> · version N · X experiences, Y evidence items." "Any query against this file cites exact sentence spans from version N." Primary: "Try a job description". Secondary: "Edit · starts draft for version N+1". |
| Indexed with a newer draft (list row) | "Indexed · draft for version N+1 in review". "Version N stays searchable until the new version is approved and indexed." |
| Conflict | "A newer approved version exists." "Version L was approved after this indexing started, so version K was not indexed. The state below has been refreshed. Version A is still the one Fit Check searches." Fact strip: "Searchable now · version A" / "Latest approved · version L" / "Not indexed · version K (superseded)". Buttons: "Index version L", "Look at version L first". |
| Fit Check intro | "How well does your experience fit this role?" "Paste a job description. Every requirement is checked against your approved, indexed experience and cited back to the exact sentence in your file." |
| Fit Check empty | "Fit Check needs at least one indexed experience file". "Upload a DOCX or PDF that describes your projects. You'll review what we find in it, approve it, and index it. About ten minutes the first time. After that, paste any job description here." Button: "Upload experience file". |
| Gaps | "Gaps to address · N". "A gap means your indexed files don't say it, not that you can't do it. If you have done it, add it to your experience file and re-upload." |
| Diagnostics summary | "Diagnostics · model, prompt versions, retrieval counts". Rows show the existing diagnostics fields. |

### 14. Tests move with the UI
- **Static contract tests.** These are rewritten against the new file paths. They keep asserting the invariants:
  - fetch targets and the `expected_draft_version` payload
  - `/index` is reachable only from a click handler
  - the 409 branch sets a refresh-required flag and makes no second `/index` call
  - there is no `type="number"` offset input and no block-ID `<select>`
  - `JdFitPanel` posts only `{ jdText }`

  Assertions on retired copy ("Edit Approved", "Inspect Accepted JSON", "Download Original", "Embedding preparation", "Ready to index", "Upload Experience") are replaced with the new labels.
- **Unit tests.** New tests cover `stage.ts` (every row of the mapping table), `gate.ts` (including the Save & approve state), `selection.ts` (pure offset core: ASCII, multi-node, whitespace trim, mismatch rejection, non-BMP characters), `revisionLabels.ts`, `summary.ts`, `numberApprovedVersions`, the citation label lookup, and the new `jdFit/ui.ts` helpers.
- **Contract and eval tests.** `jdFit/contracts.test.ts` and `report.test.ts` cover the new citation fields. Fixtures in `jdFit/testFixtures.ts` and the `ragQualityEvals` adapters, scenarios and anchor tests gain the fields so the strict `JdFitResponseSchema` still parses them. `apiEndpoints.test.ts` covers the new summary and detail fields.
- **Browser fixture.** `retryConflicts.browser.mjs` is updated to `/experience/retry-fixture` and the new button names.

## Risks / Trade-offs

- [DOM selection offsets drift from `block.text`, for example through whitespace normalisation or browser differences] → Text renders with `pre-wrap` inside a dedicated element. The exact `slice === selection` check runs before offering a span, the server revalidates every span, and unit tests cover the pure offset core.
- [A one-click index sequence could run longer than the user expects, or loop on a stuck revision] → It shows visible progress, stops when two responses make no progress, stops on unmount and stops on any non-`indexing` response. Continuing after a stop requires another click.
- [Adding required fields to the strict citation schema breaks eval fixtures and any recorded responses] → Fixtures are updated in the same task group. `test:rag-eval` runs with that group. Live eval runs produce fresh responses that include the fields.
- [The citation label query adds latency to JD-fit] → It is one indexed primary-key read over at most a handful of revisions, and it runs inside the existing overall deadline.
- [Version numbers could shift if an approved revision row were ever deleted] → Approved revisions are only removed by deleting the whole source, so numbers within a live source never shift.
- [Renaming routes breaks bookmarks and README steps] → Permanent redirects for both legacy paths, and README browser steps updated in the same change.
- [Copy assertions in tests make future copy edits noisy] → New tests assert behavior markers and the presence of copy keys from a single copy module, not long sentences.
- [Dark-mode contrast on washes, especially sand and amber, may fall short of WCAG AA] → The token table uses the Stitch dark values. The browser walkthrough checks every screen in dark mode, and any failing pair is adjusted only in `globals.css`.
- [The summary provider adds one `GET /api/experiences` per page load] → It is cheap, read-only, and already happens on the list page today. The provider is shared, so the request isn't duplicated.

## Migration Plan

1. Land the two read-only API additions first, with their tests. Old pages ignore the new fields. Then land the tokens, fonts, provider and top bar. With that alone the app still works on the old pages.
2. Add `/experience` and `/experience/[id]` alongside the old pages, then switch the redirects on and delete `app/documents` and `app/experiences` in the same commit, so no path 404s.
3. Rollback is a git revert. There are no migrations or data changes, and the API changes only add response fields, so nothing remote needs undoing.
4. Verification follows `openspec/config.yaml → operations.apply.guidance`: run `npm run dev`, then walk through the whole journey in a real browser in both light and dark mode. The journey is: upload, then auto extract→parse, review with highlight-to-attach, the gate, approve, Index now, indexed, Fit Check report, and Open in source. Also check the legacy redirects, the empty state, and a 409 using the existing fixture. Record the command, URL, steps, observations and any limitations.
