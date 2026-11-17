# Spec Delta

## MODIFIED Requirements

### Requirement: One primary action per stage
Each file row and file-page header SHALL show at most one primary action, chosen from the source's API-provided `next_action`, `actions` and failure `recoverable_action`. States with nothing for the user to do (indexed, extracting, parsing and unavailable) SHALL show none. All other available actions SHALL be placed in an overflow menu. The UI SHALL NOT offer an action the API does not allow.

#### Scenario: Draft is ready
- **WHEN** a source is in `draft`
- **THEN** the primary action opens or continues review and re-parsing is offered only in the overflow menu

#### Scenario: Approved revision awaits indexing
- **WHEN** a source is `approved`
- **THEN** the primary action is "Index now"

#### Scenario: Extraction failed
- **WHEN** the failure's recoverable action is to retry extraction
- **THEN** the primary action is "Retry extract" and "Upload a different file" is offered alongside it

#### Scenario: Indexed file
- **WHEN** a source is `indexed` with no open draft
- **THEN** no primary action is shown; the file page offers "Edit · starts draft for version N+1" as a secondary button and the overflow menu, and nothing on the row or page links to Fit Check

#### Scenario: Work is running
- **WHEN** a source is `extracting` or `parsing`
- **THEN** no primary action is shown

#### Scenario: Secondary actions are needed
- **WHEN** the user opens the overflow menu
- **THEN** it lists only actions that apply to the current state, such as downloading the original, inspecting the accepted JSON, re-parsing into a new draft, editing from the approved revision, or deleting

### Requirement: Client-chained extract and parse
Immediately after a successful upload, the file page SHALL request extraction and, only if extraction succeeds, request parsing, using the existing separate API calls. Each stage SHALL report its own progress and failure. Revisiting a file left in `uploaded` SHALL offer an explicit "Start processing" action, and a file left in `extracted` an explicit "Continue processing" action, rather than starting work automatically.

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
- **WHEN** the user opens a file whose status is `uploaded` and no chain is running in this page
- **THEN** the page shows "Start processing" and sends no request until the user clicks it

#### Scenario: User returns to a partly processed file
- **WHEN** the user opens a file whose status is `extracted` and no chain is running in this page
- **THEN** the page shows "Continue processing" and sends no request until the user clicks it

#### Scenario: Another execution holds the stage
- **WHEN** a stage request is rejected because another execution owns it
- **THEN** the page reports that work is already running, refreshes the state, and does not resend the request automatically

### Requirement: Document-first review layout
In the Review stage, the file page SHALL show the retained source blocks as the main pane, in order, each labelled by its position (b1, b2, …), with text used by any evidence item highlighted and blocks used by nothing tinted as unassigned. The structured experiences SHALL appear in a side rail beside the document. The same layout SHALL be used, read-only, for the approved revision shown on approved and indexed file pages.

#### Scenario: Draft is reviewed
- **WHEN** the user opens a draft for review
- **THEN** every retained block appears with its position label, evidence-referenced character ranges are highlighted, and unreferenced blocks carry an "unassigned" marker

#### Scenario: Evidence source is followed
- **WHEN** the user activates an evidence item's "Source" link in the rail
- **THEN** the document pane scrolls to and emphasises that item's referenced span

#### Scenario: Narrow viewport
- **WHEN** the viewport is too narrow for side-by-side panes
- **THEN** the document pane is shown first and the experience rail follows it, with no horizontal page scroll

#### Scenario: Approved revision is shown
- **WHEN** the user opens an approved or indexed file page
- **THEN** the document pane and experience rail show the latest approved revision in read-only mode, as described in "Read-only approved content view"

### Requirement: Highlight-to-attach source spans
Users SHALL attach source spans by selecting text inside one source block and choosing a target evidence item in a popover. The resulting span SHALL be `{block_id, start, end}` with offsets into that block's retained text. The UI SHALL NOT offer manual block-ID or offset entry. The popover SHALL stay fully inside the viewport, and the selection hint shown above the document SHALL be dismissible.

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
- **WHEN** the user cancels the popover, presses Escape or clicks outside it
- **THEN** the draft is unchanged and focus returns to the document

#### Scenario: Selection is near a viewport edge
- **WHEN** the selected text sits near the bottom or right edge of the viewport
- **THEN** the popover is placed on the side of the selection where it fits, without being clipped

#### Scenario: Span is removed
- **WHEN** the user removes a span from an evidence item
- **THEN** only that span is removed and the highlight updates

#### Scenario: Selection hint is dismissed
- **WHEN** the selection hint above the document is shown and the user activates its dismiss control
- **THEN** the hint disappears, nothing in the draft changes, and the hint returns only when a later action raises it again

### Requirement: Rail-based draft corrections
The experience rail SHALL let users edit the supported structured fields (title, organization, role, period, technologies, evidence summary, kind, attribution and activity status), remove evidence items, and save the draft. Each editable field SHALL show a visible edit affordance without hover or focus. Saving SHALL use the existing draft version check and show the server's field errors next to the affected items.

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
- **THEN** the page header says there are unsaved changes, the approve control saves them before approving, and leaving the page is guarded as described in "Leave guard for unsaved edits"

#### Scenario: Editable field at rest
- **WHEN** the rail shows an editable text field and the pointer is not over it and it does not have focus
- **THEN** the field shows an edit marker that distinguishes it from read-only text

### Requirement: Explicit indexing sequence
Indexing SHALL start only from an explicit user click. One click SHALL index every batch: the page repeats the existing index request for the same revision, with no fixed step limit, until it reports `indexed`, a failure, a conflict, or no progress, while showing chunk counts. A page opened in `indexing` without an active sequence SHALL offer "Continue indexing" and send nothing until clicked.

#### Scenario: Indexing completes
- **WHEN** the user clicks "Index now" once and successive index responses report remaining chunks, then `indexed`
- **THEN** the page sends each follow-up request without further clicks, shows chunk progress, and finally shows the indexed state with no primary action, while the outcome notice carries the link to Fit Check

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

## ADDED Requirements

### Requirement: Quiet list rows
A list row SHALL show a primary button only when the file is waiting on the user: not yet processed or partly processed, a draft awaiting or in review, an approved revision awaiting indexing, interrupted indexing, a failure with a retry, or a pending cleanup. Every row SHALL open its file page when activated anywhere outside its buttons and overflow menu.

#### Scenario: Indexed row
- **WHEN** the list shows an indexed file with no open draft
- **THEN** the row shows its name, stepper, label, meta line and overflow menu, and no button

#### Scenario: Running row
- **WHEN** the list shows a file that is extracting or parsing
- **THEN** the row shows no button

#### Scenario: Row needs the user
- **WHEN** the list shows a draft awaiting review
- **THEN** the row shows one primary button that opens the file page

#### Scenario: Row is activated
- **WHEN** the user clicks a row's label, meta line or empty space
- **THEN** the file page opens, and the row exposes a single link named after the file to assistive technology

#### Scenario: Row controls are used
- **WHEN** the user activates a row's primary button or overflow menu
- **THEN** only that control acts and the row link is not followed

### Requirement: Read-only approved content view
On an approved or indexed file page with no open draft, the page SHALL load the latest approved revision through the existing revision export endpoint and show its source blocks and experiences in the review layout with every editing control absent. "Inspect accepted JSON" SHALL stay in the overflow menu as the raw view.

#### Scenario: Indexed page is opened
- **WHEN** the user opens an indexed file page
- **THEN** the page shows the approved revision's source blocks with evidence highlights and its experiences in the rail, with field values as plain text and kind, attribution and activity status as static labels

#### Scenario: No editing controls
- **WHEN** the read-only view is shown
- **THEN** there are no inline editors, selects, remove controls, span remove or add controls, "Select from source" actions, attach control, selection popover, approval gate or save button, and no request other than the export read is sent

#### Scenario: Source link in read-only mode
- **WHEN** the user activates "Source: bN" on an evidence item in the read-only rail
- **THEN** the document pane scrolls to and emphasises that span

#### Scenario: Export cannot be loaded
- **WHEN** the export request fails
- **THEN** the page shows the error in place of the view with a retry, and the header, Edit and overflow menu keep working

#### Scenario: Citation is opened on an indexed page
- **WHEN** the user follows "Open in source" from a Fit Check citation to an indexed file page
- **THEN** the cited span is resolved against the blocks shown in the read-only view and highlighted there, or the different-version notice is shown when it does not resolve

#### Scenario: Edit is chosen
- **WHEN** the user chooses "Edit · starts draft for version N+1" from the read-only view
- **THEN** the page creates the draft as before and switches to the editable review workspace for it

### Requirement: Leave guard for unsaved edits
While the review workspace has unsaved draft edits, the page SHALL guard every way of leaving it. Browser-level exits SHALL use the browser's own leave prompt. In-app links and notice links SHALL instead show an in-page confirmation offering "Save and leave", "Leave without saving" and "Stay". No guard SHALL apply when there are no unsaved edits.

#### Scenario: Tab is closed or reloaded
- **WHEN** the draft has unsaved edits and the user closes the tab, reloads or enters a new URL
- **THEN** the browser shows its own leave prompt

#### Scenario: In-app link is activated
- **WHEN** the draft has unsaved edits and the user activates the top-bar destinations, the wordmark, the breadcrumb or a notice's link action
- **THEN** navigation does not happen, the in-page confirmation appears with focus on "Stay", and no request is sent

#### Scenario: User stays
- **WHEN** the user chooses "Stay" or presses Escape in the confirmation
- **THEN** the confirmation closes, the edits remain and the user stays on the page

#### Scenario: User leaves without saving
- **WHEN** the user chooses "Leave without saving"
- **THEN** the application navigates to the chosen destination and no save request is sent

#### Scenario: User saves and leaves
- **WHEN** the user chooses "Save and leave"
- **THEN** the draft is saved through the existing draft endpoint and, only if the save succeeds, the application navigates to the chosen destination

#### Scenario: Save fails while leaving
- **WHEN** the save step of "Save and leave" returns field errors or a stale draft version
- **THEN** the user stays on the page, the confirmation closes and the errors appear as for any other save

#### Scenario: Browser back button
- **WHEN** the draft has unsaved edits and the user presses the browser back button on a browser where the page can intercept it
- **THEN** the same in-page confirmation appears and the user stays on the page until they choose to leave

#### Scenario: Field is still being edited
- **WHEN** the user has typed into an inline field without committing it and then activates an in-app link
- **THEN** the typed value is committed first and the guard treats the draft as having unsaved edits

#### Scenario: No unsaved edits
- **WHEN** the draft has no unsaved edits, or the page shows no draft
- **THEN** links navigate immediately and the browser shows no leave prompt
