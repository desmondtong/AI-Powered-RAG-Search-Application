# Spec Delta

## Purpose

Provides repeatable quality evaluations for approved-evidence retrieval and JD-fit reports using versioned fixtures, retained source-span ground truth, and deterministic quality reports.

## ADDED Requirements

### Requirement: Versioned evaluation fixtures
The system SHALL define versioned fixtures that bind retained experience exports, job descriptions, expected requirements, expected evidence, expected gaps, expected citations, and threshold metadata.

#### Scenario: Fixture is loaded
- **WHEN** an evaluation fixture is loaded
- **THEN** the system validates its schema version, fixture ID, JD input, retained export references, expected outcomes, and thresholds before running evaluation

#### Scenario: Fixture is malformed
- **WHEN** required fixture fields are missing, duplicated, or incompatible with the declared schema version
- **THEN** the evaluation fails before invoking retrieval or report evaluation

### Requirement: Source-span ground truth
The system SHALL use retained source spans and logical IDs as ground truth anchors. Physical vector row IDs, generated summaries, parent headers, and embedding text MUST NOT be accepted as ground truth citations.

#### Scenario: Expected citation uses retained span
- **WHEN** expected evidence references a retained export span and logical evidence identity
- **THEN** the evaluator can match JD-fit citations against that stable source-span anchor

#### Scenario: Expected citation uses vector row ID
- **WHEN** a fixture uses a physical vector row ID as the expected citation anchor
- **THEN** the fixture is rejected as invalid ground truth

### Requirement: Deterministic offline evaluation
The system SHALL provide a deterministic evaluation mode that runs without network access, live Gemini calls, remote Supabase mutation, or real Storage operations.

#### Scenario: Offline evaluation runs
- **WHEN** deterministic evaluation is started with local fixtures and mocked model outputs
- **THEN** the run completes using fixture data and produces the same results for the same versions

#### Scenario: Network-only dependency is required
- **WHEN** a deterministic run would require a live model, remote database write, or Storage operation
- **THEN** the run fails with a configuration error instead of performing the operation

### Requirement: Requirement extraction evaluation
The system SHALL evaluate JD requirement extraction against fixture expectations for required skills, responsibilities, seniority signals, must-have constraints, and unsupported inferred requirements.

#### Scenario: Expected requirement is missing
- **WHEN** JD-fit output omits a fixture-required requirement
- **THEN** the report records a requirement-extraction failure for that fixture

#### Scenario: Unsupported requirement is invented
- **WHEN** JD-fit output adds a material requirement not supported by the fixture JD
- **THEN** the report records an unsupported extraction finding

### Requirement: Retrieval quality evaluation
The system SHALL evaluate approved-evidence retrieval against expected source-span evidence, selected-source behavior, active-vs-latest behavior, and gap cases.

#### Scenario: Expected evidence is retrieved
- **WHEN** retrieval returns evidence matching the fixture's expected retained source spans
- **THEN** the report counts those matches toward retrieval recall

#### Scenario: Active evidence differs from latest approved
- **WHEN** a fixture models R1 active and R2 latest approved but not indexed
- **THEN** the evaluator expects retrieval and JD-fit citations to use R1 evidence only

#### Scenario: Selected source is ineligible
- **WHEN** a fixture selects an ineligible source
- **THEN** the evaluator expects an explicit eligibility error without widened retrieval

### Requirement: JD-fit report quality evaluation
The system SHALL evaluate final JD-fit reports for fit-label correctness, cited positive claims, visible gaps, unsupported positive claims, and absence of numeric candidate scores.

#### Scenario: Positive claim has valid citation
- **WHEN** a report marks a requirement as strong or partial fit
- **THEN** the evaluator requires every material positive claim to cite matched retained evidence

#### Scenario: Missing evidence is hidden
- **WHEN** a required skill has no supporting evidence but the report presents it as matched
- **THEN** the evaluator records an unsupported positive-claim failure

#### Scenario: Numeric fit score appears
- **WHEN** a report exposes a numeric candidate fit score
- **THEN** the evaluator records a contract failure

### Requirement: Thresholded quality reports
The system SHALL produce machine-readable and human-readable quality reports with per-fixture results, aggregate metrics, configured thresholds, diagnostics, and pass/fail status.

#### Scenario: Metrics meet thresholds
- **WHEN** all required metrics meet their configured thresholds
- **THEN** the evaluation reports a passing status with fixture and aggregate details

#### Scenario: Metrics fail thresholds
- **WHEN** any required metric falls below threshold or any contract failure occurs
- **THEN** the evaluation reports a failing status with actionable failure details

### Requirement: Version and provenance diagnostics
The system SHALL record fixture, runner, JD-fit, prompt, model, retrieval, validation, and approved-export versions in each evaluation report.

#### Scenario: Evaluation report is generated
- **WHEN** an evaluation completes
- **THEN** the report includes version and provenance metadata sufficient to compare later runs

### Requirement: Optional live-model smoke evaluation
The system SHALL allow an explicitly opt-in live-model smoke mode that records provider/model diagnostics but is not required for deterministic CI pass/fail.

#### Scenario: Live smoke is enabled
- **WHEN** the operator explicitly enables live-model smoke evaluation
- **THEN** the system may call the configured model and marks the report as live-model, non-deterministic evidence

#### Scenario: Live smoke is not enabled
- **WHEN** the normal deterministic eval command runs
- **THEN** the system does not call live model providers

### Requirement: Generic workflow compatibility
The system SHALL preserve generic upload/search behavior and SHALL NOT require generic documents, generic search, or production UI flows to run quality evaluations.

#### Scenario: Generic search exists beside evals
- **WHEN** quality evaluations are added
- **THEN** existing generic search remains usable without running structured ingestion, JD-fit, or eval fixtures

### Requirement: No product-state mutation
The system SHALL NOT mutate structured-ingestion, JD-fit, generic-document, remote database, or Storage state during quality evaluation unless a future explicitly authorized fixture mode says otherwise.

#### Scenario: Evaluation runs
- **WHEN** deterministic or live-smoke evaluation runs
- **THEN** it reads fixtures and allowed contracts without approving, indexing, retrying, publishing, deleting, or uploading production data
