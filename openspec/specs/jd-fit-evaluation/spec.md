# jd-fit-evaluation Specification

## Purpose

Lets users evaluate a pasted job description against active approved experience evidence and receive a grounded, categorical fit report without changing ingestion behavior.

## Requirements

### Requirement: Explicit JD-fit workflow
The system SHALL expose JD-fit evaluation as an explicit user-selected workflow for pasted job descriptions while keeping the generic search workflow available and unchanged.

#### Scenario: User chooses JD-fit mode
- **WHEN** the user enters a job description in JD-fit mode
- **THEN** the system evaluates it through the JD-fit workflow rather than the generic document search workflow

#### Scenario: User stays in generic search
- **WHEN** the user enters a query in generic search mode
- **THEN** the system uses the existing generic search behavior and does not invoke JD-fit evaluation

### Requirement: JD input is untrusted data
The system SHALL treat job description text as untrusted input. JD content MUST NOT override system instructions, retrieval scope, tool choices, citation rules, or output validation.

#### Scenario: JD contains embedded instructions
- **WHEN** the pasted JD includes directions to ignore rules, call other tools, hide sources, or change scoring
- **THEN** the system treats those directions as job-description content and preserves the configured JD-fit behavior

### Requirement: Bounded JD requirement extraction
The system SHALL extract a bounded set of job requirements from the JD and reject or explicitly truncate inputs that exceed configured processing limits.

#### Scenario: JD can be parsed
- **WHEN** the JD is within supported limits and contains role requirements
- **THEN** the system returns normalized requirement items for evaluation without fabricating missing requirements

#### Scenario: JD exceeds limits
- **WHEN** the JD exceeds configured size or requirement-count limits
- **THEN** the system reports the limit condition instead of silently evaluating an incomplete JD

### Requirement: Active approved evidence retrieval
The system SHALL retrieve evidence only through the ingestion-owned approved-search contract over active indexed approved revisions. It MUST NOT infer searchability from latest approved candidates or retained approval history.

#### Scenario: Replacement is approved but not indexed
- **WHEN** R1 is active and indexed while R2 is approved, preparing, or failed
- **THEN** JD-fit retrieval uses R1 until atomic replacement succeeds, and retrieved evidence and citations carry R1's revision ID and approved content hash rather than R2's

#### Scenario: No active approved evidence exists
- **WHEN** no eligible active indexed approved evidence is available
- **THEN** the report states that no approved evidence is available and does not use generic document chunks

### Requirement: All indexed experience sources
The system SHALL evaluate every JD against all eligible active indexed experience sources. The JD-fit request MUST NOT accept a source selection in this version.

#### Scenario: Evaluation searches all eligible sources
- **WHEN** a user submits a JD for evaluation
- **THEN** retrieval searches all eligible active indexed experience sources without a source filter

#### Scenario: Request includes a source selection
- **WHEN** a JD-fit request includes a source selection or another unsupported field
- **THEN** the system rejects the request with a validation error and does not run retrieval

### Requirement: Requirement-level fit classification
The system SHALL classify each extracted requirement with categorical fit labels and short evidence-grounded rationale. It MUST NOT expose numeric fit scores.

#### Scenario: Requirement has strong evidence
- **WHEN** retrieved approved evidence directly supports a JD requirement
- **THEN** the report marks that requirement with a positive categorical fit and explains the match using cited evidence

#### Scenario: Requirement lacks support
- **WHEN** retrieved evidence is missing, indirect, weak, or contradictory for a requirement
- **THEN** the report marks the requirement as missing or weak rather than inferring experience

### Requirement: Citation-grounded report
The system SHALL cite retained approved evidence for every positive or partially positive fit claim. Citations MUST resolve to retrieved source spans, not generated summaries, headers, or physical vector identifiers.

#### Scenario: Positive claim is generated
- **WHEN** the report says the candidate matches or partially matches a requirement
- **THEN** that claim includes citations that resolve to retained approved source passages

#### Scenario: Citation validation fails
- **WHEN** a generated claim cites missing, unreturned, stale, or non-source evidence
- **THEN** the system rejects or revises the claim before returning the report

### Requirement: Evidence gaps are visible
The system SHALL surface gaps, weak matches, and unsupported assumptions clearly in the report instead of hiding them in summary text.

#### Scenario: Evidence is absent for a required skill
- **WHEN** the JD requires a skill and approved evidence does not support it
- **THEN** the report lists that requirement as a gap or weak match with no positive citation

### Requirement: Bounded context and diagnostics
The system SHALL enforce retrieval, deduplication, context, and generation limits and include non-sensitive diagnostic metadata for model, prompt, retrieval, and validation versions.

#### Scenario: Retrieved evidence exceeds context budget
- **WHEN** evidence retrieval returns more context than the JD-fit budget allows
- **THEN** the system deduplicates or trims context deterministically and reports diagnostics without fabricating coverage

#### Scenario: Report is returned
- **WHEN** JD-fit evaluation succeeds
- **THEN** the response includes model, prompt, retrieval, and validation version metadata that can support later evaluation

#### Scenario: Evaluation exceeds the overall deadline
- **WHEN** parsing, retrieval, and report generation do not finish within the configured overall deadline
- **THEN** the system returns an explicit timeout error and no partial report

### Requirement: Same-origin JD-fit requests
The system SHALL reject JD-fit requests that do not come from the application's own origin before parsing the JD, retrieving evidence, or calling a model.

#### Scenario: Cross-origin request is made
- **WHEN** another website causes a browser to send a JD-fit request
- **THEN** the system rejects it with an origin error and makes no model or database calls

### Requirement: Generic search compatibility
The system SHALL preserve the current generic search route and response contract. Generic search MUST NOT silently route through approved experience search or JD-fit evaluation.

#### Scenario: Generic search request is made
- **WHEN** a client calls the generic search API with a normal query
- **THEN** the response follows the existing generic search contract and does not require structured experience ingestion

### Requirement: No ingestion mutation
The system SHALL NOT create, approve, index, retry, publish, delete, or otherwise mutate experience-ingestion state during JD-fit evaluation.

#### Scenario: JD-fit evaluation runs
- **WHEN** the system evaluates a JD against approved evidence
- **THEN** it performs read-only retrieval and report generation without calling ingestion mutation endpoints or publication retry machinery
