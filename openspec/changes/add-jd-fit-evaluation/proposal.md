# Proposal

## Why

Structured experience ingestion gives the app a trusted, active, approved evidence corpus, but users still need a workflow that turns a pasted job description into an evidence-backed fit report. This change adds that workflow without modifying ingestion publication, retry, or deletion behavior.

## What Changes

- Add an explicit JD-fit mode on the existing Search page for pasted job descriptions while preserving the current generic search mode and `/api/search` contract.
- Add a dedicated JD-fit API/helper flow that parses a pasted JD into bounded structured requirements, retrieves active indexed experience evidence per requirement, classifies fit, and returns a cited categorical report.
- Use the ingestion-owned approved-search contract only; JD-fit searches active indexed evidence and does not infer searchability from `latest_approved_revision_id` or retained approval history.
- Treat the pasted JD as untrusted input. Embedded instructions in the JD must not change prompts, tools, retrieval scope, or output rules.
- Generate fit categories and explanations rather than numeric scores. Every positive match must cite retrieved approved evidence; missing evidence must be reported as missing or weak instead of inferred.
- Support optional source selection using ingestion semantics: omitted means all eligible active indexed sources, explicit empty means no matches, and stale/ineligible selections produce an explicit error without widening search.
- Add bounded context budgeting, deterministic validation of citations, prompt/model/version diagnostics, and focused tests for generic-search compatibility, selected-source behavior, and unsupported-claim prevention.
- Gate apply work on `add-structured-project-ingestion` being accepted and archived/synced, or on an equivalent accepted approved-search/export contract being present.

Out of scope:

- Implementing, fixing, or verifying ingestion publication retry policy, leases, stale-candidate handling, deletion, or remote Supabase migration state.
- Indexing approved revisions, triggering ingestion retries, modifying active/latest-approved pointers, or reading unpublished approved candidates as searchable evidence.
- Numeric fit scores, resume rewriting, cover-letter generation, application advice, interview coaching, autonomous agent loops, or a formal RAG quality benchmark.
- Changing generic document upload/search behavior, generic `/api/search`, or evidence-index foundation tables/RPCs.

## Capabilities

### New Capabilities

- `jd-fit-evaluation`: Parses pasted job descriptions, retrieves active approved experience evidence, and produces cited categorical fit reports.

### Modified Capabilities

- None. `project-evidence-index` remains unchanged, and `structured-project-ingestion` is a dependency whose accepted approved-search/export contracts are consumed but not modified by this change.

## Impact

- Frontend: Search page gains an explicit JD-fit mode or panel beside the existing generic search mode; generic search remains available and compatible.
- Server/API: new dedicated JD-fit endpoint and helper modules for JD parsing, requirement retrieval, report generation, citation validation, and context budgeting.
- Retrieval: consumes `searchApprovedExperienceEvidence()` / `match_approved_experience_chunks`; does not call ingestion index/approval/delete endpoints.
- Model usage: adds dedicated Gemini prompt/schema configuration for JD parsing and fit report generation instead of reusing the generic `generateAnswer()` helper.
- Tests: add unit/contract tests and small synthetic fixtures for JD parsing, retrieval selection, report citation rules, stale/ineligible source selection, and generic-search regression.
