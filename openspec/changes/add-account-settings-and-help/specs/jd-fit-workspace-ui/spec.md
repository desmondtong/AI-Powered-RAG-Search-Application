# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Two-destination navigation`
- TO: `### Requirement: Top-bar navigation`

## MODIFIED Requirements

### Requirement: Top-bar navigation
The top bar SHALL offer exactly three destinations, in order: "Fit Check" (`/`), "Experience" (`/experience`) and "Help" (`/help`). It SHALL mark the current one. It SHALL show a status pill with the number of experience files that currently have an active indexed revision, worded without restating that indexed files are searchable. The account menu SHALL sit after the pill at the right end.

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

#### Scenario: Help is open
- **WHEN** the user is on `/help`
- **THEN** the "Help" destination is marked current

#### Scenario: Settings is open
- **WHEN** the user is on `/settings`
- **THEN** no destination is marked current

### Requirement: Porcelain and Cobalt visual system
All screens SHALL use the Porcelain & Cobalt tokens, with Nunito Sans headings and Source Sans 3 body text, in both light and dark themes. The theme SHALL follow the appearance setting: the light or dark token set when "Light" or "Dark" is chosen, and the operating-system colour preference on "Auto", the default. Each semantic colour SHALL keep a single meaning across screens.

#### Scenario: Dark preference
- **WHEN** the appearance is "Auto" and the operating system prefers a dark colour scheme
- **THEN** every screen renders with the dark token set, keeping text, highlights, fit labels and disabled states legible

#### Scenario: Dark chosen on a light system
- **WHEN** the appearance is "Dark" and the operating system prefers a light colour scheme
- **THEN** every screen renders with the dark token set, including form controls and scrollbars

#### Scenario: Light chosen on a dark system
- **WHEN** the appearance is "Light" and the operating system prefers a dark colour scheme
- **THEN** every screen renders with the light token set, including form controls and scrollbars

#### Scenario: Semantic colours are applied
- **WHEN** a screen shows actions, sourced evidence, unassigned text, items needing attention, completed stages and destructive or failed states
- **THEN** they use cobalt, cobalt wash, sand, amber, green and red respectively, and red is not used for anything else

### Requirement: Accessible workspace interactions
Stage changes, gate counts, report results, transient outcome notices and report filter changes SHALL be announced to assistive technology through polite live regions, with each outcome announced once. Busy controls SHALL expose `aria-busy`. Overflow menus, the account menu, the span popover, the approval gate, the report filter tiles and notice actions SHALL be operable by keyboard, and text selected with the keyboard SHALL be attachable the same way as a pointer selection.

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

#### Scenario: Keyboard account menu
- **WHEN** a keyboard user focuses the avatar and presses Enter, Space or ArrowDown
- **THEN** the menu opens with focus on its first item, the arrow keys move between items, Enter activates "Settings", and Escape closes the menu and returns focus to the avatar

### Requirement: Single-source stage explanation
The explanation of how the six stages work SHALL appear in exactly two places: the Experience section of the Help page and the Fit Check empty state. The Experience page SHALL NOT contain the explanation. It SHALL instead offer one short "How it works" link to the Help page's Experience section. Stage labels, helper sentences, list rows, the drop zone and page subtitles SHALL NOT restate how the pipeline works.

#### Scenario: Experience page with files
- **WHEN** the user opens `/experience` and at least one file exists
- **THEN** no stage explanation appears on the page, a "How it works" link points to `/help#experience`, and no row, subtitle or drop-zone text explains the stages

#### Scenario: Explanation is wanted
- **WHEN** the user activates the "How it works" link on the Experience page
- **THEN** the Help page opens at its Experience section, which lists the six stages with one sentence each

#### Scenario: Fit Check with nothing indexed
- **WHEN** the Fit Check empty state is shown
- **THEN** it explains the six stages, and this is the only explanatory text on that page

### Requirement: Leave guard for unsaved edits
While the review workspace has unsaved draft edits, the page SHALL guard every way of leaving it. Browser-level exits SHALL use the browser's own leave prompt. In-app links and notice links SHALL instead show an in-page confirmation offering "Save and leave", "Leave without saving" and "Stay". No guard SHALL apply when there are no unsaved edits.

#### Scenario: Tab is closed or reloaded
- **WHEN** the draft has unsaved edits and the user closes the tab, reloads or enters a new URL
- **THEN** the browser shows its own leave prompt

#### Scenario: In-app link is activated
- **WHEN** the draft has unsaved edits and the user activates the top-bar destinations, the wordmark, the account menu's "Settings" item, the breadcrumb or a notice's link action
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

## ADDED Requirements

### Requirement: Account menu
The top bar SHALL end with a round avatar button for the signed-in account. When a signed-in Google identity is available, the avatar SHALL show the account email's first letter or digit, uppercased, and its menu SHALL show the full email followed by a "Settings" item. Without an identity, as when running locally, the avatar SHALL be neutral and the menu SHALL offer only "Settings". The menu SHALL offer no sign-out.

#### Scenario: Signed in through IAP
- **WHEN** the hosted application is opened by `desmond@example.com`
- **THEN** the avatar shows "D", its accessible name includes the email, and opening it shows `desmond@example.com` and a "Settings" item

#### Scenario: No identity available
- **WHEN** the application runs without an IAP identity
- **THEN** the avatar shows a neutral person icon, its accessible name is "Account", and the menu shows only "Settings"

#### Scenario: Settings is chosen
- **WHEN** the user chooses "Settings" in the menu
- **THEN** the application navigates to `/settings` and the menu closes

#### Scenario: No sign-out
- **WHEN** the user opens the account menu
- **THEN** no item signs the user out or links to a Google sign-out

#### Scenario: Identity is shown, never trusted
- **WHEN** the forwarded identity is present or absent
- **THEN** no page content, API response or permission differs other than the avatar and the menu's email line

### Requirement: Top bar at phone width
At widths below 640 px the top bar SHALL fit the wordmark mark, all three destinations, the status pill and the avatar on one row without horizontal scrolling at 375 px. To fit, the pill SHALL shrink to its status dot and the number, keeping the full wording for assistive technology.

#### Scenario: Phone width with files indexed
- **WHEN** the top bar is shown at 375 px with three files indexed
- **THEN** Fit Check, Experience, Help, a pill reading "3" with its dot, and the avatar are all visible on one row, the page has no horizontal scroll, and the pill's accessible text is "3 files indexed"

#### Scenario: Wide screen
- **WHEN** the top bar is shown at 640 px or wider
- **THEN** the product name and the pill's full wording are visible
