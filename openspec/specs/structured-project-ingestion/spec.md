# structured-project-ingestion Specification

## Purpose

Turns personal experience files into source-linked structured revisions that a user reviews before publication into the project evidence index. Preserves reliable citations and revision identity for downstream JD-fit retrieval and quality evaluations.

## Requirements

### Requirement: Separate experience upload workflow
The system SHALL accept DOCX and selectable-text PDF experience files through a workflow separate from generic document upload. It SHALL NOT require user-authored JSON, perform OCR, or convert legacy binary DOC files in v1.

#### Scenario: Experience file is uploaded
- **WHEN** the user uploads a supported experience file
- **THEN** the system creates or resolves a source identity and begins an experience ingestion workflow without inserting generic document chunks

#### Scenario: Legacy DOC is uploaded
- **WHEN** the user uploads a legacy binary DOC file
- **THEN** the system reports the unsupported format without extracting, parsing, or publishing evidence

#### Scenario: Unsupported or unreadable file
- **WHEN** the file is unsupported, encrypted without usable text, image-only, empty, or still unusably garbled after available extraction attempts
- **THEN** the system reports that text extraction cannot proceed and does not invoke structured parsing or publish evidence

### Requirement: Bounded ingestion
The system SHALL enforce documented upload, extraction, structured-output, and execution limits. It SHALL report limit violations or truncated extraction/output explicitly rather than silently indexing incomplete experience.

#### Scenario: Source exceeds a supported limit
- **WHEN** an experience file or its extracted text exceeds a configured limit
- **THEN** the system explains the violated limit and requests a smaller or split document without publishing partial evidence

#### Scenario: Structured generation is truncated
- **WHEN** generation ends because of an output limit or produces an incomplete response
- **THEN** the system records a parsing failure and does not treat the partial response as a valid draft

### Requirement: Private source retention
The system SHALL retain the original experience file privately and expose it only through the trusted personal-tool access boundary. It SHALL NOT publish permanent public file URLs or expose service-role credentials to the browser.

#### Scenario: Original file is opened
- **WHEN** the user opens or downloads an experience source through the personal tool
- **THEN** the server authorizes the request at the private deployment boundary and returns the requested source without making its storage object public

### Requirement: Immutable source provenance
The system SHALL retain ordered normalized source blocks with stable identifiers, source/extraction hashes, parser versions, and available location information. Citation references SHALL identify valid spans within that retained text, not generated replacement text.

#### Scenario: Extracted text becomes citation source
- **WHEN** extraction succeeds
- **THEN** the system freezes the normalized block text and retains enough information to reconstruct referenced passages exactly

#### Scenario: Exact file location is unavailable
- **WHEN** the extractor cannot reliably recover PDF page or Word paragraph coordinates
- **THEN** the system retains block order and exact normalized-text spans without fabricating file coordinates

### Requirement: Source-grounded structured experience
The system SHALL organize experience into a versioned structured representation of projects or general responsibilities, factual fields, and focused evidence items. Populated factual fields and evidence SHALL reference retained source passages; missing facts SHALL remain null or empty.

#### Scenario: Two projects appear in one file
- **WHEN** the file describes two distinguishable projects
- **THEN** the draft represents them separately and links their fields and evidence to their respective source passages

#### Scenario: Experience has no named project
- **WHEN** the source describes role responsibilities without a named project
- **THEN** the draft represents general experience without inventing a project name

#### Scenario: Source contains qualified outcomes
- **WHEN** a source describes a team result, a planned activity, or a qualified metric
- **THEN** the structured representation preserves that attribution, completion status, and qualification rather than promoting it to an individual completed accomplishment

### Requirement: Structured-output validation
The system SHALL validate structure, required fields, allowed values, reference ownership and span bounds before offering a draft for approval. Structural validity SHALL NOT be presented as proof of semantic accuracy.

#### Scenario: Invalid structured response
- **WHEN** the parser returns malformed JSON, unsupported fields or values, invalid references, or references to another source
- **THEN** the system rejects the response with a recoverable parsing error and does not publish it

#### Scenario: Valid but ambiguous interpretation
- **WHEN** a valid response contains an interpretation that requires user confirmation
- **THEN** the review view shows the proposed interpretation beside its source passages before approval

### Requirement: Human review before approval
The system SHALL let the user inspect source-linked experience, correct structured fields, adjust evidence references, remove incorrect items, and save a draft before explicit approval. V1 corrections SHALL remain grounded in the uploaded source; unsupported new claims SHALL require a revised source upload.

#### Scenario: User corrects a misattributed achievement
- **WHEN** the user changes an individual contribution interpretation to a team contribution and saves the draft
- **THEN** the system persists and revalidates the correction without indexing the draft

#### Scenario: User adds an unsupported claim
- **WHEN** a correction supplies a factual claim without supporting source references
- **THEN** approval is blocked with field-level guidance to select supporting text, remove the claim, or upload a revised source

#### Scenario: Draft contains no usable experience evidence
- **WHEN** every experience or evidence item is removed or no nonempty source-grounded evidence remains
- **THEN** the system blocks approval and explains that there is nothing to index

### Requirement: Approval freezes an exact revision
The system SHALL bind approval to the validated draft version and a canonical content hash. Approved JSON SHALL be immutable; later edits SHALL create a new draft requiring approval.

#### Scenario: Draft changed after review
- **WHEN** approval is requested with a draft version that no longer matches the stored draft
- **THEN** the system rejects the stale request and asks the user to review the current version

#### Scenario: Approved revision is edited
- **WHEN** the user edits previously approved experience
- **THEN** the system creates a separate draft and keeps the approved revision unchanged

### Requirement: Observable resumable lifecycle
The system SHALL distinguish uploaded, extracting, parsing, draft, approved, indexing, indexed, and failed work, with failure stage and recoverable next action. Interrupted work SHALL be resumable without relying on an untracked process after a request ends.

#### Scenario: Review is reopened
- **WHEN** the user reloads the page or returns later
- **THEN** the system restores the persisted draft or revision status and available actions

#### Scenario: Execution is interrupted
- **WHEN** parsing or embedding preparation is interrupted or times out
- **THEN** the system retains completed checkpoints, exposes retry after expired execution ownership is recovered, and does not falsely report successful indexing

### Requirement: Source-derived parent and child construction
The system SHALL derive parent context and child citation text from the approved revision's source references. It SHALL preserve focused child spans separately from contextual embedding input and retain lineage through source, revision, experience, evidence, and chunk identifiers.

#### Scenario: Context is added for retrieval
- **WHEN** an approved contribution is indexed with supported project or role headers
- **THEN** the headers appear in embedding input while the child's citation text remains an exact retained source span

#### Scenario: Evidence crosses several source spans
- **WHEN** an evidence item references noncontiguous passages
- **THEN** the system produces separately traceable child spans rather than presenting stitched text as one continuous quotation

#### Scenario: Parent context exceeds its limit
- **WHEN** an experience contains more source context than the configured parent limit
- **THEN** the system partitions it at source boundaries into project-section parents without mixing different experiences or silently losing indexed evidence

### Requirement: Atomic document revision publication
The system SHALL publish all parents and children of an approved document revision together only after required embeddings and validation succeed. Failed preparation or publication SHALL leave the previous active revision intact and SHALL NOT expose a partially published replacement.

#### Scenario: Embedding preparation fails midway
- **WHEN** one embedding fails after other embeddings were prepared
- **THEN** prepared work remains retryable but no portion of the replacement becomes eligible for ingestion-owned evidence search

#### Scenario: Multi-project publication fails
- **WHEN** publication encounters an invalid child while storing a multi-project revision
- **THEN** all new parents and children roll back and the previously active revision remains unchanged

#### Scenario: Replacement succeeds
- **WHEN** a complete approved replacement is published successfully
- **THEN** it becomes the source's sole active indexed revision and prior live parents and children are removed in the same database transaction, while prior approved JSON, source snapshots, and logical citation history remain retained until source deletion

#### Scenario: Older indexing work finishes after a newer approval
- **WHEN** a never-published older revision attempts publication after a newer candidate is approved or published for the same source, even with a valid indexing lease and complete staging
- **THEN** the system refuses the stale publication without changing the active revision, the newer approved candidate, or evidence

### Requirement: Idempotent upload and indexing retries
The system SHALL resolve byte-identical repeated uploads to the existing source. Publication retry success SHALL require the requested revision to remain both current active and latest approved, with a valid indexing lease and matching publication parameters and live evidence. Outdated indexing requests SHALL be rejected even if previously published. Explicit reparsing SHALL create a new reviewable revision rather than overwrite approval.

#### Scenario: Upload is retried after response loss
- **WHEN** the same file bytes are uploaded again
- **THEN** the system returns the existing source and its recoverable workflow state rather than creating duplicate sources or evidence

#### Scenario: Publication response is lost
- **WHEN** a revision's publication committed but its response was lost, and a retry obtains a new valid indexing lease while that revision remains current active and latest approved with matching publication parameters and live evidence
- **THEN** the system returns `status: indexed` and `already_published: true` without regenerating embeddings, requiring cleared staging, or duplicating or recreating parents or children

#### Scenario: Previously published revision is retried after a newer approval
- **WHEN** R1 published successfully and remains active, R2 is now the latest approved candidate, and an R1 indexing request is retried with an otherwise valid lease and matching parameters
- **THEN** the system rejects R1 as outdated without a publication-success response, leaves R1 active and searchable, and preserves R2's candidate identity and prepared work

#### Scenario: Previously published revision is retried after replacement
- **WHEN** R2 has successfully replaced R1 and an R1 indexing request is retried with an otherwise valid lease
- **THEN** the system rejects R1 as outdated, keeps R2 active, and does not recreate R1's removed live mappings, parents, or children or return historical-success acknowledgement

### Requirement: Validated publication retry responses
The system SHALL validate source ownership, approved and plan hashes, expected counts, chunking and embedding configuration, and live evidence before current-version retry success. Successful retries SHALL report validated current publication state, not inferred historical success. The system SHALL NOT add historical publication receipts.

#### Scenario: Current-version retry returns verified publication state
- **WHEN** a permitted current-active and latest-approved retry passes all publication validation
- **THEN** `revision_id` and `active_revision_id` identify that revision at success, `parent_count`, `child_count`, and `plan_hash` describe its validated live publication, progress shows zero remaining or newly prepared chunks, and `next_action` is null

#### Scenario: Publication parameters or source ownership do not match
- **WHEN** a current-version retry supplies another source's revision or mismatches the approved hash, plan hash, either expected count, chunking version, embedding model, task type, or dimensions, including missing or invalid required values
- **THEN** the system rejects the retry without changing publication evidence or pointers and does not silently substitute values to return success

#### Scenario: Current-version live evidence is incomplete
- **WHEN** a current-active and latest-approved retry has a valid indexing lease but live publication membership, configuration, or counts are missing or inconsistent
- **THEN** the system fails validation rather than trusting an indexed label, returning success, or recreating evidence through the retry

### Requirement: Fenced publication execution
The system SHALL require current, unexpired, source-owned indexing execution authority for publication and retry success. Successful publication SHALL atomically consume its matching lease. Rejected publication SHALL leave pre-call state unchanged; separate failure cleanup SHALL remain token-fenced and SHALL NOT clear another execution's lease or overwrite newer lifecycle state.

#### Scenario: Invalid execution authority is supplied
- **WHEN** publication or a current-version retry supplies a missing, expired, replaced, or wrong-stage execution token
- **THEN** the system rejects the request without publication success, evidence changes, or consumption of another execution's lease

#### Scenario: Successful publication consumes its lease
- **WHEN** first publication or a permitted current-version retry succeeds
- **THEN** its matching token, stage, expiry, and start fields are cleared atomically, no second completion write is issued, and another response-loss retry requires new valid execution authority

#### Scenario: Candidate changes during an indexing request
- **WHEN** a request passed an earlier latest-candidate check but a newer approval wins before publication
- **THEN** the system rejects the outdated request at publication rather than relying on the earlier snapshot, leaves pre-publication state unchanged, and any separate cleanup preserves newer execution ownership and lifecycle state

### Requirement: Actionable outdated indexing conflicts
The system SHALL return HTTP 409 with a stable stale-candidate classification and clear guidance for outdated indexing requests. The application SHALL stop that request sequence, refresh source, latest-approved, and active state, and require an explicit action against the refreshed candidate. It SHALL NOT automatically resubmit an outdated request or silently retarget it.

#### Scenario: Outdated request is rejected before preparation
- **WHEN** the requested revision is already outdated when indexing begins
- **THEN** the application explains that a newer approved revision must be reviewed before another indexing action, refreshes source detail, and sends no automatic retry for the outdated revision

#### Scenario: Publication detects a late candidate conflict
- **WHEN** a newer approval makes an in-flight indexing request outdated at publication
- **THEN** the application handles the conflict with the same clear message and state refresh, preserves the displayed distinction between active search evidence and candidate work, and waits for an explicit indexing action

#### Scenario: Refresh after a conflict fails
- **WHEN** the application cannot refresh source state after an outdated-request conflict
- **THEN** it reports the refresh failure, keeps indexing stopped, and does not use stale detail or a retry action to automatically resend or retarget the request

#### Scenario: Conflict is not caused by an outdated candidate
- **WHEN** execution ownership or another publication condition causes a conflict without a newer approved candidate
- **THEN** the system reports the relevant conflict rather than treating every SQLSTATE `40001` as candidate staleness or blindly retrying the request

### Requirement: Approved active evidence search boundary
The system SHALL expose an ingestion-owned retrieval contract that searches only active approved indexed revisions. An explicitly supplied source selection SHALL constrain candidates before top-K retrieval; unknown or ineligible selected sources SHALL NOT widen the search.

#### Scenario: Unapproved or standalone evidence exists
- **WHEN** retrieval is invoked through the ingestion-owned contract
- **THEN** draft, failed, inactive, deleted, and standalone evidence without an approved publication relationship is excluded

#### Scenario: A replacement is approved but not successfully published
- **WHEN** R1 remains the active indexed revision while R2 is approved, preparing, or has failed publication
- **THEN** retrieval continues to use R1 until atomic replacement succeeds, even though R1 is no longer the latest approved candidate, and rejecting an R1 indexing retry does not hide or delete its active evidence

#### Scenario: Source selection is supplied
- **WHEN** the caller selects a subset of indexed experience sources
- **THEN** similarity ranking and top-K selection operate only within that subset and results retain parent context and citation lineage

#### Scenario: Selection is explicitly empty or stale
- **WHEN** the caller supplies an empty selection or selects sources that are no longer eligible
- **THEN** the system returns no matches or an explicit eligibility error rather than searching all sources

### Requirement: Reproducible revision export
The system SHALL expose the retained structured revision, source-reference resolution, canonical hash, and parser/model/prompt/schema/chunking/embedding configuration versions for trusted downstream consumers. Logical IDs SHALL survive permitted retries and retained exports of the same frozen revision; retained history SHALL NOT authorize publication of an outdated revision.

#### Scenario: Accepted revision is reused for evaluation
- **WHEN** a downstream evaluation requests a retained approved revision
- **THEN** it receives the same accepted JSON, source passages, and logical identifiers even if physical vector rows were replaced

#### Scenario: LLM reparses the original source
- **WHEN** a new parse generates different experience boundaries
- **THEN** it receives a distinct revision identity and does not claim unchanged logical IDs across independent parses

### Requirement: Experience deletion consistency
The system SHALL immediately make a deleted experience source ineligible for retrieval and remove its parents, children, revisions, and staging work through a coordinated lifecycle. Storage cleanup failures SHALL be visible and retryable without restoring search eligibility.

#### Scenario: Source is deleted during indexing
- **WHEN** deletion wins the source lifecycle lock while an indexing request is running
- **THEN** publication is refused, its evidence is removed or remains unpublished, and retry cannot resurrect the deleted source

#### Scenario: Previously published revision is retried after deletion
- **WHEN** a publication retry targets a previously published revision of a tombstoned, cleanup-pending, or removed source
- **THEN** the system rejects the request regardless of prior success or an old token, returns no cached publication success, and does not recreate evidence or restore source eligibility

#### Scenario: Storage cleanup fails
- **WHEN** database evidence removal succeeds but original-file deletion fails
- **THEN** the system reports cleanup pending, retains only the information needed to retry cleanup, and returns no evidence for the source

### Requirement: Generic workflow compatibility
The system SHALL preserve generic upload, search, list/detail/file access, and deletion behavior while adding explicit experience controls. This change SHALL NOT implement JD-fit generation or silently route existing Search requests to the evidence index.

#### Scenario: Generic document remains usable
- **WHEN** the user uploads, searches, previews, or deletes a document through existing generic controls
- **THEN** the generic workflow remains available independently of experience review and indexing

#### Scenario: Indexed experience appears in Documents
- **WHEN** the user opens the experience section
- **THEN** source status, review actions, and indexed counts reflect the experience lifecycle rather than generic chunk metadata
