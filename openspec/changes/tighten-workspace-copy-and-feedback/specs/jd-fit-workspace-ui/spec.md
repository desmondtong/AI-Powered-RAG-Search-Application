# Spec Delta

## ADDED Requirements

### Requirement: Single-source stage explanation
The explanation of how the six stages work SHALL appear in exactly two places: a collapsed "How it works" section on the Experience page and the Fit Check empty state. Stage labels, helper sentences, list rows, the drop zone and page subtitles SHALL NOT restate how the pipeline works.

#### Scenario: Experience page with files
- **WHEN** the user opens `/experience` and at least one file exists
- **THEN** the six-stage explanation is collapsed by default, and no row, subtitle or drop-zone text explains the stages

#### Scenario: Explanation is wanted
- **WHEN** the user expands "How it works"
- **THEN** the six stages are listed with one sentence each

#### Scenario: Fit Check with nothing indexed
- **WHEN** the Fit Check empty state is shown
- **THEN** it explains the six stages, and this is the only explanatory text on that page

### Requirement: No repeated sentences across rows
List rows SHALL NOT carry a helper sentence that is identical across rows in the same state. A row's helper SHALL be either the next step for that file or omitted, with file-specific facts carried on the meta line.

#### Scenario: Several indexed files
- **WHEN** the list shows more than one indexed file
- **THEN** each row shows its stage label and a meta line with its own type, size and indexed date, and no explanatory sentence is repeated under each row

#### Scenario: A file needs action
- **WHEN** a row is in a state with a next step, such as a draft awaiting review
- **THEN** its helper states that next step in one sentence

### Requirement: Transient outcome notices
Outcomes of user actions that need no decision SHALL be reported through a transient notice: one at a time, in a fixed position that does not cover the review rail, dismissed on its own after about five seconds, dismissible earlier, and able to carry one action. Errors and anything requiring a choice SHALL NOT be reported this way and SHALL stay in place.

#### Scenario: Draft is saved
- **WHEN** a draft save succeeds
- **THEN** a notice reads that the draft was saved, in addition to the header's saved state

#### Scenario: Approval succeeds
- **WHEN** approval succeeds
- **THEN** a notice names the approved version number

#### Scenario: Indexing completes
- **WHEN** the index sequence reports `indexed`
- **THEN** a notice says the file is searchable and offers a link to Fit Check

#### Scenario: File is deleted
- **WHEN** a delete succeeds and the user is returned to the list
- **THEN** a notice on the list names the deleted file, with no undo

#### Scenario: Background stage change
- **WHEN** periodic re-reading finds that a file moved from `parsing` to `draft` or from `indexing` to `indexed`
- **THEN** a notice names the file and its new state, with a link to open it, once per transition

#### Scenario: A request fails
- **WHEN** any request returns an error
- **THEN** the error is shown in place as before and no transient notice is used for it

#### Scenario: Notices queue
- **WHEN** a second outcome occurs while a notice is visible
- **THEN** the earlier notice is replaced or the later one waits; two are never shown at once

### Requirement: Pending state on controls
A control whose request is in flight SHALL show a busy indicator, keep its own colour, refuse further activation and expose `aria-busy`. Busy SHALL be visually distinct from a disabled control and from the approval gate's locked state.

#### Scenario: Short action is running
- **WHEN** the user activates Save draft, Approve, Edit, Delete, Browse files or Add span
- **THEN** that control shows a spinner in place of its leading icon until the request settles

#### Scenario: Long action is running
- **WHEN** the index sequence or an evaluation is running
- **THEN** its control shows the spinner and the page also shows the existing progress bar or a report skeleton

#### Scenario: Gate is locked
- **WHEN** the approval checklist still has open items
- **THEN** the approve control keeps the disabled style and lock icon and does not look busy

### Requirement: Undo for local draft removals
Removing an evidence item or a source span in the review rail SHALL be undoable from the outcome notice until that notice dismisses. Undo SHALL restore the item or span at its original position and mark the draft as having unsaved changes. No request SHALL be sent by the removal or the undo.

#### Scenario: Evidence item is removed and restored
- **WHEN** the user removes an evidence item and chooses Undo before the notice dismisses
- **THEN** the item reappears in its previous position with its spans, and the header shows unsaved changes

#### Scenario: Undo after a save
- **WHEN** the user removes a span, saves the draft, and chooses Undo while the notice is still visible
- **THEN** the span is restored locally and the draft shows unsaved changes again

#### Scenario: Notice expires
- **WHEN** the notice dismisses without Undo
- **THEN** the removal stands and no further undo is offered for it

#### Scenario: Draft revision changes
- **WHEN** a different draft revision is loaded while an undo is pending
- **THEN** that undo is discarded

### Requirement: Fit report filtering
The four count tiles SHALL be pressable filters. Pressing a tile SHALL show only that group's requirement cards; pressing it again SHALL show all groups. In the unfiltered view each group heading SHALL stay visible under the top bar while its group scrolls. Filter changes SHALL be announced.

#### Scenario: Weak is selected
- **WHEN** the user presses the Weak tile
- **THEN** only Weak cards are shown, the tile is marked pressed, and the live region reads how many Weak requirements are shown

#### Scenario: Filter is cleared
- **WHEN** the user presses the pressed tile again
- **THEN** all groups are shown in Strong, Partial, Weak, Missing order

#### Scenario: Empty group is pressed
- **WHEN** the user presses a tile whose count is zero
- **THEN** the view says there are no requirements with that fit and offers to show all

#### Scenario: Keyboard use
- **WHEN** a keyboard user focuses the tiles
- **THEN** arrow keys move between tiles and Space or Enter toggles the focused one

## MODIFIED Requirements

### Requirement: Two-destination navigation
The top bar SHALL offer exactly two destinations, "Fit Check" (`/`) and "Experience" (`/experience`), mark the current one, and show a status pill with the number of experience files that currently have an active indexed revision, worded without restating that indexed files are searchable.

#### Scenario: Some files are indexed
- **WHEN** two experience sources have an active indexed revision
- **THEN** the status pill reads "2 files indexed"

#### Scenario: Nothing is indexed
- **WHEN** no experience source has an active indexed revision
- **THEN** the status pill reads "No files indexed"

#### Scenario: The count cannot be loaded
- **WHEN** the source list request fails
- **THEN** the status pill is omitted or neutral, the rest of the page still works, and no error is presented as a zero count

#### Scenario: A file page is open
- **WHEN** the user is on `/experience/[id]`
- **THEN** the "Experience" destination is marked current

### Requirement: Six-stage pipeline presentation
Every experience file SHALL be presented on a six-stage stepper (Upload, Extract, Parse, Review, Approve, Index) derived only from the source and revision state returned by the API, with one plain-language stage label and, when the state has a next step or one fact worth stating, one helper sentence. The helper SHALL NOT explain how the pipeline works or repeat the label. Raw status strings and revision UUIDs SHALL NOT be the primary presentation.

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

#### Scenario: Indexed file
- **WHEN** a source's status is `indexed`
- **THEN** the label names the searchable version once, the file page helper states the experience and evidence counts and the indexed time once, the list row has no helper, and no text on the row or page repeats the version number or explains what indexing is

#### Scenario: Revisions are referred to
- **WHEN** the UI needs to distinguish revisions, such as the searchable, latest approved and draft revisions
- **THEN** it names approved revisions as "version N" using the API's approved version numbers, names an open draft as "Draft for version N+1" where N is the latest approved number (or "Draft for version 1" when none exists), and never shows a revision UUID

### Requirement: Fit Check input and empty state
The Fit Check page SHALL show a short heading, a job-description input and an "Evaluate fit" button that submits only the JD text, with no introductory paragraph. The indexed-file count SHALL appear once, in the top bar. When the source list shows no indexed file, it SHALL disable evaluation and show an empty state whose primary action is "Upload experience file".

#### Scenario: No file is indexed
- **WHEN** the source list loads and no source has an active indexed revision
- **THEN** the JD input and "Evaluate fit" are disabled, and the empty state explains the six stages and links to the Experience upload

#### Scenario: Files are indexed
- **WHEN** the source list loads with indexed files
- **THEN** the page shows the heading, the input and the character count with the keyboard shortcut, and the indexed count is not repeated below the input

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
A successful report SHALL show four pressable count tiles (Strong, Partial, Weak, Missing), requirement cards grouped in that order showing fit label, importance, requirement text, rationale and citations, a gaps note in the Weak and Missing views, and collapsed diagnostics. While a report is loading the page SHALL show a report skeleton. Fit SHALL be shown only as categorical labels, with no numeric score or percentage.

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
- **WHEN** the report lists gaps and the Weak or Missing filter is active
- **THEN** a one-line note explains that a gap means the indexed files do not say it, and the gap requirements are not listed a second time below the cards

#### Scenario: Report is loading
- **WHEN** the JD-fit request is in flight
- **THEN** the page shows tile and card placeholders in the report's layout and the Evaluate control is busy

#### Scenario: Evaluation fails
- **WHEN** the JD-fit request returns an error
- **THEN** the page shows the error message and offers "Try again" only when the error is retryable

#### Scenario: No approved evidence
- **WHEN** the report status is `no_evidence`
- **THEN** the page shows "No approved evidence available" with a link to the Experience page

### Requirement: Accessible workspace interactions
Stage changes, gate counts, report results, transient outcome notices and report filter changes SHALL be announced to assistive technology through polite live regions, with each outcome announced once. Busy controls SHALL expose `aria-busy`. Overflow menus, the span popover, the approval gate, the report filter tiles and notice actions SHALL be operable by keyboard, and text selected with the keyboard SHALL be attachable the same way as a pointer selection.

#### Scenario: Keyboard span attachment
- **WHEN** a keyboard user selects text within a block and opens the attach control
- **THEN** focus moves into the popover, the target can be chosen and "Add span" activated by keyboard, and focus returns to the document afterwards

#### Scenario: Stage changes
- **WHEN** a stage finishes or fails while the user is on the file page
- **THEN** the new stage label is announced through a polite live region

#### Scenario: Outcome notice appears
- **WHEN** a transient notice is shown
- **THEN** its text is announced once, its action is reachable by keyboard, and Escape dismisses it

#### Scenario: Report filter changes
- **WHEN** the user presses a count tile
- **THEN** the number and fit of the shown requirements is announced
