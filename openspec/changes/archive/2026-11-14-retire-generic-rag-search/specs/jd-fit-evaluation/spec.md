# Spec Delta

## ADDED Requirements

### Requirement: Primary JD-fit workflow
The system SHALL expose JD-fit evaluation as the application's primary workflow for pasted job descriptions. Evaluation SHALL run only when the user explicitly submits a job description.

#### Scenario: User submits a job description
- **WHEN** the user enters a job description and requests evaluation
- **THEN** the system evaluates it through the JD-fit workflow against approved experience evidence

#### Scenario: Job description is not submitted
- **WHEN** the user types or edits a job description without requesting evaluation
- **THEN** the system performs no retrieval or model call

## MODIFIED Requirements

### Requirement: Active approved evidence retrieval
The system SHALL retrieve evidence only through the ingestion-owned approved-search contract over active indexed approved revisions. It MUST NOT infer searchability from latest approved candidates or retained approval history.

#### Scenario: Replacement is approved but not indexed
- **WHEN** R1 is active and indexed while R2 is approved, preparing, or failed
- **THEN** JD-fit retrieval uses R1 until atomic replacement succeeds, and retrieved evidence and citations carry R1's revision ID and approved content hash rather than R2's

#### Scenario: No active approved evidence exists
- **WHEN** no eligible active indexed approved evidence is available
- **THEN** the report states that no approved evidence is available, marks every requirement as unsupported, and does not draw evidence from any other source

## REMOVED Requirements

### Requirement: Explicit JD-fit workflow
**Reason**: The requirement defined JD-fit as one of two user-selected modes beside generic search. Generic search is retired, so the mode switch and the "user stays in generic search" behavior no longer exist. The surviving behavior is restated by the added requirement "Primary JD-fit workflow".
**Migration**: The JD-fit request route and contract are unchanged. The home page presents the JD-fit input directly instead of behind a mode switch.

### Requirement: Generic search compatibility
**Reason**: The generic search route and its response contract are retired along with the generic document workflow. JD-fit is the application's only evaluation path, so there is no generic route to keep separate from approved experience search.
**Migration**: Clients that called the generic search route have no replacement; the application's only retrieval is JD-fit over approved experience evidence through its existing route and request contract, which are unchanged.
