# Spec Delta

## Purpose

Defines how JD Fit Check presents the experience pipeline and JD-fit evaluation in the browser, so that a user always knows which stage each file is in, what to do next, and where every claim in a fit report comes from. It covers presentation only; ingestion and evaluation behavior are owned by `structured-project-ingestion` and `jd-fit-evaluation`.

## ADDED Requirements

### Requirement: Product identity
The application SHALL present itself as "JD Fit Check" in the top-bar wordmark and the document title metadata. It SHALL NOT show the scaffold title "Create Next App" or the legacy heading "RAG Search".

#### Scenario: Any page is opened
- **WHEN** the user opens any page of the application
- **THEN** the browser tab title contains "JD Fit Check" and the top bar shows the "JD Fit Check" wordmark

### Requirement: Two-destination navigation
The top bar SHALL offer exactly two destinations, "Fit Check" (`/`) and "Experience" (`/experience`), mark the current one, and show a status pill with the number of experience files that currently have an active indexed revision.

#### Scenario: Some files are indexed
- **WHEN** two experience sources have an active indexed revision
- **THEN** the status pill reads "2 files indexed and searchable"

#### Scenario: Nothing is indexed
- **WHEN** no experience source has an active indexed revision
- **THEN** the status pill reads "No files indexed yet"

#### Scenario: The count cannot be loaded
- **WHEN** the source list request fails
- **THEN** the status pill is omitted or neutral, the rest of the page still works, and no error is presented as a zero count

#### Scenario: A file page is open
- **WHEN** the user is on `/experience/[id]`
- **THEN** the "Experience" destination is marked current

### Requirement: Experience routes and redirects
Experience pages SHALL live at `/experience` (list) and `/experience/[id]` (file page). The legacy paths `/documents` and `/experiences/[id]` SHALL permanently redirect to their new equivalents. API paths SHALL NOT change.

#### Scenario: Legacy list URL is opened
- **WHEN** the user opens `/documents`
- **THEN** the browser is permanently redirected to `/experience`

#### Scenario: Legacy file URL is opened
- **WHEN** the user opens `/experiences/abc`
- **THEN** the browser is permanently redirected to `/experience/abc`

#### Scenario: API is called after the rename
- **WHEN** any page reads or mutates experience data
- **THEN** it uses the unchanged `/api/experiences` routes

### Requirement: Six-stage pipeline presentation
Every experience file SHALL be presented on a six-stage stepper (Upload, Extract, Parse, Review, Approve, Index) derived only from the source and revision state returned by the API, with one plain-language stage label and one helper sentence. Raw status strings and revision UUIDs SHALL NOT be the primary presentation.

#### Scenario: Draft awaiting review
- **WHEN** a source's status is `draft`
- **THEN** Upload, Extract and Parse show as done, Review shows as current, and the label describes the draft as ready for review

#### Scenario: Work is in progress
- **WHEN** a source's status is `extracting`, `parsing` or `indexing`
- **THEN** the corresponding stage shows as in progress and the helper says the user can leave the page

#### Scenario: A stage failed
- **WHEN** a source's status is `failed` with a failure stage
- **THEN** the failed stage is marked failed, later stages show as not started, and the helper explains the failure in plain language using the failure message the API returned

#### Scenario: Indexed with a newer draft in review
- **WHEN** a source has an active indexed revision and a newer draft
- **THEN** the stepper shows Review as current for the new draft and the helper states that the indexed version stays searchable until the new one is approved and indexed

#### Scenario: Revisions are referred to
- **WHEN** the UI needs to distinguish revisions, such as the searchable, latest approved and draft revisions
- **THEN** it names approved revisions as "version N" using the API's approved version numbers, names an open draft as "Draft for version N+1" where N is the latest approved number (or "Draft for version 1" when none exists), and never shows a revision UUID

### Requirement: One primary action per stage
Each file row and file-page header SHALL show exactly one primary action, chosen from the source's API-provided `next_action`, `actions` and failure `recoverable_action`. All other available actions SHALL be placed in an overflow menu. The UI SHALL NOT offer an action the API does not allow.

#### Scenario: Draft is ready
- **WHEN** a source is in `draft`
- **THEN** the primary action opens or continues review and re-parsing is offered only in the overflow menu

#### Scenario: Approved revision awaits indexing
- **WHEN** a source is `approved`
- **THEN** the primary action is "Index now"

#### Scenario: Extraction failed
- **WHEN** the failure's recoverable action is to retry extraction
- **THEN** the primary action is "Retry extract" and "Upload a different file" is offered alongside it

#### Scenario: Secondary actions are needed
- **WHEN** the user opens the overflow menu
- **THEN** it lists only actions that apply to the current state, such as downloading the original, inspecting the accepted JSON, re-parsing into a new draft, editing from the approved revision, or deleting

### Requirement: Inline experience upload
The Experience page SHALL accept DOCX and PDF files through an inline drop zone with a browse control. It SHALL NOT use a modal that closes on its own. A successful upload SHALL open the new file's page; a failed upload SHALL show the API's error in place and keep the user's context.

#### Scenario: Upload succeeds
- **WHEN** the user drops or selects a supported file and the upload returns a source
- **THEN** the application navigates to that source's file page, where processing begins

#### Scenario: Byte-identical file is uploaded again
- **WHEN** the upload resolves to an existing source
- **THEN** the application navigates to the existing source's file page and shows its current state rather than restarting it

#### Scenario: Upload is rejected
- **WHEN** the upload returns an error such as an unsupported format or exceeding the size limit
- **THEN** the drop zone shows that error message and remains available for another attempt

### Requirement: Client-chained extract and parse
Immediately after a successful upload, the file page SHALL request extraction and, only if extraction succeeds, request parsing, using the existing separate API calls. Each stage SHALL report its own progress and failure. Revisiting a file left in `uploaded` or `extracted` SHALL offer an explicit "Continue processing" action rather than starting work automatically.

#### Scenario: Both stages succeed
- **WHEN** a file has just been uploaded and extraction and parsing both succeed
- **THEN** the page shows extraction then parsing in progress, then the parsed state with "Start review" as the primary action

#### Scenario: Extraction fails
- **WHEN** extraction fails
- **THEN** parsing is not requested, the Extract stage is marked failed with the API's message, and "Retry extract" is offered

#### Scenario: Parsing fails
- **WHEN** extraction succeeds and parsing fails
- **THEN** the Extract stage shows done, the Parse stage is marked failed with the API's message, and a parse retry is offered

#### Scenario: User returns to an unfinished file
- **WHEN** the user opens a file whose status is `uploaded` or `extracted` and no chain is running in this page
- **THEN** the page shows "Continue processing" and sends no request until the user clicks it

#### Scenario: Another execution holds the stage
- **WHEN** a stage request is rejected because another execution owns it
- **THEN** the page reports that work is already running, refreshes the state, and does not resend the request automatically

### Requirement: Live stage refresh
While a source is in `extracting`, `parsing` or `indexing` and this page is not itself waiting on that request, the file page and list SHALL periodically re-read source state until it settles, and SHALL stop polling when the page is hidden or the state is terminal.

#### Scenario: Work started elsewhere finishes
- **WHEN** the user opens a file page while the source is `parsing` and the parse completes
- **THEN** the page updates to the parsed state without a manual reload

#### Scenario: State settles
- **WHEN** the source reaches a status other than `extracting`, `parsing` or `indexing`
- **THEN** periodic re-reading stops

### Requirement: Document-first review layout
In the Review stage, the file page SHALL show the retained source blocks as the main pane, in order, each labelled by its position (b1, b2, …), with text used by any evidence item highlighted and blocks used by nothing tinted as unassigned. The structured experiences SHALL appear in a side rail beside the document.

#### Scenario: Draft is reviewed
- **WHEN** the user opens a draft for review
- **THEN** every retained block appears with its position label, evidence-referenced character ranges are highlighted, and unreferenced blocks carry an "unassigned" marker

#### Scenario: Evidence source is followed
- **WHEN** the user activates an evidence item's "Source" link in the rail
- **THEN** the document pane scrolls to and emphasises that item's referenced span

#### Scenario: Narrow viewport
- **WHEN** the viewport is too narrow for side-by-side panes
- **THEN** the document pane is shown first and the experience rail follows it, with no horizontal page scroll

### Requirement: Highlight-to-attach source spans
Users SHALL attach source spans by selecting text inside one source block and choosing a target evidence item in a popover. The resulting span SHALL be `{block_id, start, end}` with offsets into that block's retained text. The UI SHALL NOT offer manual block-ID or offset entry.

#### Scenario: Text within a block is selected
- **WHEN** the user selects a sentence inside block b6 and chooses "Add span" for an evidence item
- **THEN** that item gains a span whose `block_id` is b6's ID and whose `start` and `end` reproduce exactly the selected characters of b6's retained text

#### Scenario: Selection crosses blocks
- **WHEN** the selection starts in one block and ends in another
- **THEN** no span is offered and the popover tells the user to select text within one block, adding further spans one block at a time

#### Scenario: Selection is outside the source text
- **WHEN** the selection covers only labels, pills or rail content
- **THEN** no popover appears

#### Scenario: Popover is dismissed
- **WHEN** the user cancels the popover or presses Escape
- **THEN** the draft is unchanged

#### Scenario: Span is removed
- **WHEN** the user removes a span from an evidence item
- **THEN** only that span is removed and the highlight updates

### Requirement: Rail-based draft corrections
The experience rail SHALL let users edit the supported structured fields (title, organization, role, period, technologies, evidence summary, kind, attribution and activity status), remove evidence items, and save the draft. Saving SHALL use the existing draft version check and show the server's field errors next to the affected items.

#### Scenario: Attribution is corrected
- **WHEN** the user changes an evidence item's attribution from individual to team and saves
- **THEN** the draft is saved through the existing draft endpoint with the expected draft version and the rail reflects the saved state

#### Scenario: Evidence item has no span
- **WHEN** an evidence item has no source span
- **THEN** the rail marks it as needing attention with "Select from source" and "Remove" actions

#### Scenario: Save is rejected
- **WHEN** the draft save returns field errors
- **THEN** each error is shown on the matching experience or evidence item and nothing is reported as saved

#### Scenario: Unsaved changes exist
- **WHEN** the draft has local edits that are not saved
- **THEN** the page header says there are unsaved changes and the approve control saves them before approving

### Requirement: Merged approval gate
The file page SHALL present one "Before you can approve" checklist that combines the existing review acknowledgements, evidence items without a source span, the no-usable-evidence condition, and validation errors from the last save or approval attempt. Approve SHALL stay disabled, labelled "Approve · N items left", until the checklist is clear.

#### Scenario: Items remain
- **WHEN** one acknowledgement is unchecked and two evidence items lack a span
- **THEN** the gate shows those three items as open, links each to the place it can be fixed, and the button reads "Approve · 3 items left"

#### Scenario: Gate is clear
- **WHEN** all acknowledgements are checked, every evidence item has a span, the draft has no unsaved edits and there are no validation errors
- **THEN** the button reads "Approve" and, when clicked, sends the existing approval request with the current revision and draft version

#### Scenario: Gate is clear with unsaved edits
- **WHEN** the checklist is clear and the draft has unsaved edits
- **THEN** the button reads "Save & approve" and, when clicked, saves the draft through the existing draft endpoint and, only if the save succeeds, sends the approval request with the draft version the save returned

#### Scenario: Save fails during save and approve
- **WHEN** the save step of "Save & approve" returns field errors or a stale draft version
- **THEN** no approval request is sent and the errors appear in the gate

#### Scenario: Approval fails after a successful save
- **WHEN** the save succeeds but the approval request is rejected
- **THEN** the draft remains saved, the page shows it as saved, and the approval errors appear in the gate

#### Scenario: Server rejects approval
- **WHEN** the approval request returns validation errors or a stale draft version
- **THEN** the errors appear in the gate, the draft is not shown as approved, and stale-version errors prompt the user to reload the current draft

#### Scenario: Approval succeeds
- **WHEN** approval succeeds
- **THEN** the page shows the approved state with "Index now" as the primary action and does not start indexing

### Requirement: Explicit indexing sequence
Indexing SHALL start only from an explicit user click. One click SHALL index every batch: the page repeats the existing index request for the same revision, with no fixed step limit, until it reports `indexed`, a failure, a conflict, or no progress, while showing chunk counts. A page opened in `indexing` without an active sequence SHALL offer "Continue indexing" and send nothing until clicked.

#### Scenario: Indexing completes
- **WHEN** the user clicks "Index now" once and successive index responses report remaining chunks, then `indexed`
- **THEN** the page sends each follow-up request without further clicks, shows chunk progress, and finally shows the indexed state with "Try a job description" as the primary action

#### Scenario: Indexing stops making progress
- **WHEN** two consecutive index responses report the same number of remaining chunks
- **THEN** the sequence stops and the page offers "Continue indexing"

#### Scenario: User leaves during indexing
- **WHEN** the user navigates away while a sequence is running
- **THEN** no further index requests are sent after the one in flight, and returning to the page offers "Continue indexing"

#### Scenario: Approval just succeeded
- **WHEN** a revision becomes approved
- **THEN** no index request is sent until the user clicks "Index now"

#### Scenario: Indexing was interrupted
- **WHEN** the user opens a file whose status is `indexing` and this page has no sequence running
- **THEN** the page offers "Continue indexing" and sends no index request until it is clicked

### Requirement: Outdated indexing conflict presentation
When an index request returns HTTP 409 for an outdated candidate, the page SHALL stop the sequence, refresh state, explain that a newer approved version exists, and show which revision is searchable now, which is latest approved and which was not indexed. It SHALL wait for an explicit index or review choice and never resend automatically.

#### Scenario: Newer approval wins
- **WHEN** an index request returns 409 `index-candidate-stale`
- **THEN** no further index request is sent, state is refreshed, the searchable, latest approved and not-indexed revisions are shown by version number, and the user is offered "Index version N" for the latest approved revision or "Look at version N first"

#### Scenario: Refresh fails after a conflict
- **WHEN** the refresh after a 409 fails
- **THEN** the page reports the refresh failure, keeps indexing stopped, and offers only a manual refresh until it succeeds

#### Scenario: Conflict is not about staleness
- **WHEN** an index request returns 409 for another reason, such as another execution owning the lease
- **THEN** the page shows that reason rather than the newer-version explanation

### Requirement: Editing an indexed or approved file
For a source with an approved or indexed revision and no open draft, the UI SHALL offer an edit action that creates a new draft from the latest approved revision through the existing endpoint, and SHALL state that the current searchable version is unaffected until the new draft is approved and indexed.

#### Scenario: User edits an indexed file
- **WHEN** the user chooses "Edit" on an indexed file
- **THEN** a new draft is created from the approved revision, the page enters Review for that draft, and the searchable revision is described as unchanged

### Requirement: In-page destructive confirmation
Deleting a source and retrying a pending cleanup SHALL use the existing delete endpoint and SHALL ask for confirmation inside the page, never through a native browser dialog. The confirmation SHALL say that the file stops being searchable immediately.

#### Scenario: User deletes a file
- **WHEN** the user chooses "Delete" and confirms in the page
- **THEN** the delete request is sent, and the file leaves the list or shows "cleanup pending" with a retry if storage cleanup did not finish

#### Scenario: User cancels deletion
- **WHEN** the user dismisses the confirmation
- **THEN** no request is sent

### Requirement: Fit Check input and empty state
The Fit Check page SHALL show an intro, a job-description input and an "Evaluate fit" button that submits only the JD text. When the source list shows no indexed file, it SHALL disable evaluation and show an empty state whose primary action is "Upload experience file".

#### Scenario: No file is indexed
- **WHEN** the source list loads and no source has an active indexed revision
- **THEN** the JD input and "Evaluate fit" are disabled, and the empty state explains the six stages and links to the Experience upload

#### Scenario: Index count is unavailable
- **WHEN** the source list cannot be loaded
- **THEN** evaluation stays enabled and the existing no-evidence report handles the case where nothing is indexed

#### Scenario: User evaluates a JD
- **WHEN** the user clicks "Evaluate fit" or presses Cmd/Ctrl+Enter with non-empty text
- **THEN** exactly one JD-fit request is sent with a body containing only the JD text

#### Scenario: User only types
- **WHEN** the user types or edits the JD without submitting
- **THEN** no JD-fit request is sent

### Requirement: Fit report presentation
A successful report SHALL show four count tiles (Strong, Partial, Weak, Missing), requirement cards grouped in that order showing fit label, importance, requirement text, rationale and citations, a "Gaps to address" panel, and collapsed diagnostics. Fit SHALL be shown only as categorical labels, with no numeric score or percentage.

#### Scenario: Report is shown
- **WHEN** a report with strong, partial, weak and missing assessments is returned
- **THEN** the tiles show each count, cards appear under their fit group, and every positive or partial card shows its quoted citations captioned "file name · experience title · evidence kinds" from the citation's fields

#### Scenario: Citation has no experience title
- **WHEN** a citation's `experience_title` is null
- **THEN** the caption uses "General experience" for general experience or omits the title segment for a project, and omits the kinds segment when `evidence_kinds` is empty

#### Scenario: Claim was downgraded
- **WHEN** an assessment is marked as downgraded
- **THEN** its card notes that a claim without valid evidence was removed

#### Scenario: Gaps exist
- **WHEN** the report lists gaps
- **THEN** the gaps panel lists each with its fit label and importance and explains that a gap means the indexed files do not say it

#### Scenario: Evaluation fails
- **WHEN** the JD-fit request returns an error
- **THEN** the page shows the error message and offers "Try again" only when the error is retryable

#### Scenario: No approved evidence
- **WHEN** the report status is `no_evidence`
- **THEN** the page shows "No approved evidence available" with a link to the Experience page

### Requirement: Open citation in source
Each citation SHALL offer "Open in source", which opens the cited source's file page and highlights the cited span when the shown extraction contains that block and the offsets reproduce the quoted text. Otherwise it SHALL show the quote and say that the span belongs to a version whose text is not displayed.

#### Scenario: Span resolves
- **WHEN** the user opens a citation whose block and offsets match the displayed source text
- **THEN** the file page scrolls to that block and highlights exactly the cited characters

#### Scenario: Span does not resolve
- **WHEN** the cited block is absent or its text at the cited offsets differs from the quote
- **THEN** the file page shows the citation quote with a notice instead of highlighting unrelated text

### Requirement: Porcelain and Cobalt visual system
All screens SHALL use the Porcelain & Cobalt tokens, with Nunito Sans headings and Source Sans 3 body text, in both light and dark themes. The theme SHALL follow the operating-system colour preference. Each semantic colour SHALL keep a single meaning across screens.

#### Scenario: Dark preference
- **WHEN** the operating system prefers a dark colour scheme
- **THEN** every screen renders with the dark token set, keeping text, highlights, fit labels and disabled states legible

#### Scenario: Semantic colours are applied
- **WHEN** a screen shows actions, sourced evidence, unassigned text, items needing attention, completed stages and destructive or failed states
- **THEN** they use cobalt, cobalt wash, sand, amber, green and red respectively, and red is not used for anything else

### Requirement: Accessible workspace interactions
Stage changes, gate counts and report results SHALL be announced to assistive technology. Overflow menus, the span popover and the approval gate SHALL be operable by keyboard, and text selected with the keyboard SHALL be attachable the same way as a pointer selection.

#### Scenario: Keyboard span attachment
- **WHEN** a keyboard user selects text within a block and opens the attach control
- **THEN** focus moves into the popover, the target can be chosen and "Add span" activated by keyboard, and focus returns to the document afterwards

#### Scenario: Stage changes
- **WHEN** a stage finishes or fails while the user is on the file page
- **THEN** the new stage label is announced through a polite live region
