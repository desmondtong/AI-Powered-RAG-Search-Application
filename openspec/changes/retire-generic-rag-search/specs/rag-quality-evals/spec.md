# Spec Delta

## MODIFIED Requirements

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
- **THEN** every experience source in the project is deleted through the accepted deletion function and no evidence-index row is touched directly

#### Scenario: Project is not allowed
- **WHEN** any corpus command runs and the configured Supabase project does not match the allowed project reference
- **THEN** the command refuses before any write

### Requirement: Read-only evaluation runner
The evaluation runner SHALL NOT create, approve, index, retry, publish, delete, upload, or otherwise mutate experience, evidence-index, database, or Storage state in any mode. Mutation SHALL occur only in the corpus commands.

#### Scenario: Runner executes
- **WHEN** deterministic or live evaluation runs
- **THEN** mutation spies on ingestion, JD-fit, evidence-index, database, and Storage seams observe no calls

## REMOVED Requirements

### Requirement: Generic workflow compatibility
**Reason**: The generic upload and search workflow is retired along with its routes, so there is no generic behavior left for quality evaluations to preserve. The requirement's second concern, that evals never depend on production UI flows, is already guaranteed by "Deterministic offline evaluation" and "Live evaluation over a seeded corpus", which run entirely through fixtures and the seeded corpus.
**Migration**: None. Quality evaluations never read or wrote generic documents; the offline and live eval commands are unchanged.
