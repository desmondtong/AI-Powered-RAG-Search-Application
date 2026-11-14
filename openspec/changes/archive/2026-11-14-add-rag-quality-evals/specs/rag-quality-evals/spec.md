# Spec Delta

## Purpose

Provides repeatable quality evaluations for approved-evidence retrieval and JD-fit reports using versioned synthetic fixtures, revision-anchored source-span ground truth, a deterministic offline mode, a live mode over a seeded synthetic corpus, and thresholded quality reports.

## ADDED Requirements

### Requirement: Versioned evaluation fixtures
The system SHALL define versioned fixtures that bind authored synthetic experience text, a job description, expected requirements, expected evidence passages, expected gaps, distractor passages, and thresholds. Fixture experience text SHALL be synthetic; real resumes, personal documents, or internal sources MUST NOT be committed.

#### Scenario: Fixture is loaded
- **WHEN** an evaluation fixture is loaded
- **THEN** the system validates its schema version, fixture ID, JD input, experience text, expected outcomes, distractors, and thresholds before running any evaluation

#### Scenario: Fixture is malformed
- **WHEN** required fixture fields are missing, duplicated, or incompatible with the declared schema version
- **THEN** the evaluation fails before invoking retrieval or report evaluation

#### Scenario: Expected passage is not in the fixture text
- **WHEN** an expected evidence or distractor passage is not an exact substring of the fixture's experience text
- **THEN** the fixture is rejected as invalid ground truth

### Requirement: Revision-anchored ground truth
The system SHALL resolve expected evidence to anchors made of source identity, `revision_id`, `approved_content_hash`, logical IDs, and a retained source span, derived from the retained revision export. Physical vector row IDs, generated summaries, parent headers, and embedding text MUST NOT be accepted as ground truth anchors.

#### Scenario: Expected passage resolves against a retained export
- **WHEN** an expected passage is located in the retained source blocks of a revision export
- **THEN** the evaluator produces an anchor carrying that revision's identity and the passage's source span, and matches JD-fit citations by revision identity and span overlap

#### Scenario: Sibling revisions share logical IDs
- **WHEN** two revisions of the same source share logical IDs and source blocks
- **THEN** the evaluator distinguishes them by `revision_id` and `approved_content_hash`, not by logical IDs alone

#### Scenario: Anchor uses vector row ID
- **WHEN** a fixture or adapter supplies a physical vector row ID as an expected anchor
- **THEN** the anchor is rejected as invalid ground truth

### Requirement: Deterministic offline evaluation
The system SHALL provide a deterministic evaluation mode that runs the accepted JD-fit pipeline with scripted model output and scripted search, without network access, live Gemini calls, Supabase access, or Storage operations.

#### Scenario: Offline evaluation runs
- **WHEN** deterministic evaluation is started with local fixtures
- **THEN** the run completes using fixture data only and produces identical report objects for identical fixture, runner, and contract versions

#### Scenario: External dependency is required
- **WHEN** a deterministic run would require a live model, a database call, or a Storage operation
- **THEN** the run fails with a configuration error instead of performing the operation

#### Scenario: Scripted inputs are labeled
- **WHEN** a deterministic report includes requirement-extraction or retrieval metrics
- **THEN** the report labels those metrics as harness checks over scripted inputs, not as measurements of model or ranking quality

### Requirement: Requirement extraction evaluation
The system SHALL evaluate JD requirement extraction against fixture expectations for expected requirements, must-have versus preferred importance, and unsupported requirements invented from the JD.

#### Scenario: Expected requirement is missing
- **WHEN** JD-fit output contains no requirement matching a fixture-expected requirement
- **THEN** the report records a requirement-extraction miss for that fixture

#### Scenario: Unsupported requirement is invented
- **WHEN** JD-fit output adds a material requirement not supported by the fixture JD
- **THEN** the report records an unsupported extraction finding

### Requirement: Retrieval quality evaluation
The system SHALL evaluate approved-evidence retrieval against expected evidence anchors and distractor anchors, reporting recall, distractor precision, and ingestion coverage as separate findings.

#### Scenario: Expected evidence is retrieved
- **WHEN** retrieval returns a hit whose revision identity and source span match an expected anchor
- **THEN** the report counts that match toward retrieval recall

#### Scenario: Distractor is retrieved
- **WHEN** retrieval returns a hit matching a fixture distractor anchor for a requirement
- **THEN** the report counts that hit against distractor precision for that requirement

#### Scenario: Expected passage was never indexed
- **WHEN** no evidence in the retained revision export covers an expected passage
- **THEN** the report records an ingestion-coverage miss for that passage and does not count it as a retrieval miss

### Requirement: Active-vs-latest revision evaluation
The system SHALL verify that JD-fit evidence and citations carry the active indexed revision's identity when a later revision of the same source is approved but not indexed.

#### Scenario: Latest approved revision is not indexed
- **WHEN** a fixture source has R1 active and indexed and R2 latest approved but not indexed
- **THEN** the evaluator requires every citation for that source to carry R1's `revision_id` and `approved_content_hash`, and records a contract failure for any R2 identity

### Requirement: JD-fit report quality evaluation
The system SHALL evaluate final JD-fit reports for fit-label correctness, cited positive claims, visible gaps, and unsupported positive claims.

#### Scenario: Positive claim has valid citation
- **WHEN** a report marks a requirement as strong or partial fit
- **THEN** the evaluator requires at least one citation on that requirement to match an expected evidence anchor for it

#### Scenario: Missing evidence is presented as matched
- **WHEN** a requirement the fixture expects to be weak or missing is reported as strong or partial
- **THEN** the evaluator records an unsupported positive-claim failure

#### Scenario: Expected gap is visible
- **WHEN** a requirement the fixture expects to be weak or missing appears in the report's gaps with a gap label
- **THEN** the evaluator counts it toward gap visibility

### Requirement: Upstream contract checks
The system SHALL fail an evaluation run on any violation of the accepted upstream contracts it depends on, regardless of aggregate metric results.

#### Scenario: Source selection is offered to JD-fit
- **WHEN** a JD-fit request carrying a source selection is submitted during evaluation
- **THEN** the evaluator requires it to be rejected before retrieval and records a contract failure otherwise

#### Scenario: Retrieval receives a source selection
- **WHEN** the retrieval adapter observes a search call that carries a source selection
- **THEN** the report records a contract failure

#### Scenario: Numeric fit score appears
- **WHEN** a report response contains a numeric fit score field
- **THEN** the report records a contract failure

### Requirement: Thresholded quality reports
The system SHALL produce machine-readable and human-readable quality reports with per-fixture findings, aggregate metrics, configured thresholds, provenance, mode, and pass/fail status.

#### Scenario: Metrics meet thresholds
- **WHEN** all required metrics meet their configured thresholds and no contract failure occurred
- **THEN** the evaluation reports a passing status with fixture and aggregate details

#### Scenario: Metrics fail thresholds
- **WHEN** any required metric falls below threshold or any contract failure occurs
- **THEN** the evaluation reports a failing status naming the metric category, fixture, and requirement involved

### Requirement: Version and provenance diagnostics
The system SHALL record fixture schema and runner versions, JD-fit diagnostics (model, prompt, validation versions), and the configuration versions of every cited revision's export (parser, prompt, model, chunking, embedding) in each report.

#### Scenario: Evaluation report is generated
- **WHEN** an evaluation completes
- **THEN** the report includes version and provenance metadata sufficient to compare later runs and to attribute changes to JD-fit, ingestion, or fixtures

### Requirement: Live evaluation over a seeded corpus
The system SHALL provide an explicitly opt-in live mode that runs real JD-fit against the seeded synthetic corpus in the allowed test project and marks its report as live, non-deterministic evidence.

#### Scenario: Live mode is enabled
- **WHEN** the operator explicitly enables live evaluation and the configured project matches the allowed project
- **THEN** the system calls the configured model and approved search, resolves anchors from the corpus manifest and revision exports, and marks the report as live

#### Scenario: Live mode is not enabled
- **WHEN** the deterministic eval command runs
- **THEN** the system does not call live model providers, Supabase, or Storage

#### Scenario: Corpus is missing or stale
- **WHEN** live evaluation starts and the corpus manifest is absent, names sources that are no longer active and indexed, or records fixture versions that differ from the current fixtures
- **THEN** the run fails with a configuration error naming the seed command instead of evaluating partial or outdated data

#### Scenario: Corpus is reused
- **WHEN** live evaluation runs against a manifest whose sources are active and indexed and whose fixture versions match
- **THEN** the run evaluates without seeding, deleting, or otherwise writing experience data

### Requirement: Seeded corpus lifecycle
The system SHALL provide separate, explicitly flagged commands that seed synthetic fixture sources through the accepted ingestion workflow, tear down seeded sources, and reset all experience sources, each refusing to run unless the configured project matches the allowed test project.

#### Scenario: Seed runs
- **WHEN** the seed command runs with the live flag against the allowed project and no manifest exists
- **THEN** each fixture source is uploaded, extracted, parsed, approved, and indexed through the accepted ingestion functions, and a local manifest records its source, revision, and content-hash identities together with the fixture versions seeded

#### Scenario: Seed runs over an existing corpus
- **WHEN** the seed command runs while a manifest already exists
- **THEN** it refuses unless an explicit replace option is given, in which case it tears down the manifest sources before seeding

#### Scenario: Active-vs-latest fixture is seeded
- **WHEN** a fixture declares a latest-approved-not-indexed revision
- **THEN** seeding approves and indexes R1, then creates and approves a grounded R2 draft without indexing it, and records both identities in the manifest

#### Scenario: Teardown runs
- **WHEN** the teardown command runs
- **THEN** every source listed in the manifest is deleted through the accepted deletion function and any cleanup-pending result is reported for retry

#### Scenario: Reset runs
- **WHEN** the reset command runs with its own explicit flag against the allowed project
- **THEN** every experience source in the project is deleted through the accepted deletion function and generic documents are left untouched

#### Scenario: Project is not allowed
- **WHEN** any corpus command runs and the configured Supabase project does not match the allowed project reference
- **THEN** the command refuses before any write

### Requirement: Read-only evaluation runner
The evaluation runner SHALL NOT create, approve, index, retry, publish, delete, upload, or otherwise mutate experience, generic-document, database, or Storage state in any mode. Mutation SHALL occur only in the corpus commands.

#### Scenario: Runner executes
- **WHEN** deterministic or live evaluation runs
- **THEN** mutation spies on ingestion, JD-fit, generic document, database, and Storage seams observe no calls

### Requirement: Generic workflow compatibility
The system SHALL preserve generic upload and search behavior and SHALL NOT require generic documents or production UI flows to run quality evaluations.

#### Scenario: Generic search exists beside evals
- **WHEN** quality evaluations are added
- **THEN** existing generic search remains usable without running structured ingestion, JD-fit, or eval fixtures
