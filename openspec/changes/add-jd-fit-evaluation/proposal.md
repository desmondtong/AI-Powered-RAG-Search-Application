# Proposal

## Why

Structured experience ingestion gives the app a trusted, active, approved evidence corpus, but users still need a workflow that turns a pasted job description into an evidence-backed fit report. This change adds that workflow without modifying ingestion publication, retry, or deletion behavior.

## What Changes

- Add an explicit JD-fit mode on the existing Search page for pasted job descriptions while preserving the current generic search mode and `/api/search` contract.
- Add a dedicated JD-fit API/helper flow that parses a pasted JD into bounded structured requirements, retrieves active indexed experience evidence per requirement, classifies fit, and returns a cited categorical report.
- Use the ingestion-owned approved-search contract only; JD-fit searches active indexed evidence and does not infer searchability from `latest_approved_revision_id` or retained approval history.
- Treat the pasted JD as untrusted input. Embedded instructions in the JD must not change prompts, tools, retrieval scope, or output rules.
- Generate fit categories and explanations rather than numeric scores. Every positive match must cite retrieved approved evidence; missing evidence must be reported as missing or weak instead of inferred.
- Evaluate every JD against all eligible active indexed experience sources. The request accepts the pasted JD only; source selection is deferred to a later change.
- Add bounded context budgeting, deterministic validation of citations, prompt/model/version diagnostics, and focused tests for generic-search compatibility, all-source retrieval, same-origin request handling, and unsupported-claim prevention.
- Build on the accepted `structured-project-ingestion` contract. `add-structured-project-ingestion` is archived and its approved-search contract is synced to the main spec, so the apply gate is met.

Out of scope:

- Implementing, fixing, or verifying ingestion publication retry policy, leases, stale-candidate handling, deletion, or remote Supabase migration state.
- Indexing approved revisions, triggering ingestion retries, modifying active/latest-approved pointers, or reading unpublished approved candidates as searchable evidence.
- Numeric fit scores, resume rewriting, cover-letter generation, application advice, interview coaching, autonomous agent loops, or a formal RAG quality benchmark.
- Changing generic document upload/search behavior, generic `/api/search`, or evidence-index foundation tables/RPCs.
- Source selection or a source picker. Every evaluation searches all eligible indexed sources; selection can return in a later change together with its UI.
- A full-corpus or hybrid evidence strategy. This change uses per-requirement retrieval only.

## Capabilities

### New Capabilities

- `jd-fit-evaluation`: Parses pasted job descriptions, retrieves active approved experience evidence, and produces cited categorical fit reports.

### Modified Capabilities

- None. `project-evidence-index` remains unchanged, and `structured-project-ingestion` is a dependency whose accepted approved-search/export contracts are consumed but not modified by this change.

## Impact

- Frontend: Search page gains an explicit JD-fit mode or panel beside the existing generic search mode; generic search remains available and compatible.
- Server/API: new dedicated JD-fit endpoint and helper modules for JD parsing, requirement retrieval, report generation, citation validation, and context budgeting.
- Retrieval: consumes `searchApprovedExperienceEvidence()` / `match_approved_experience_chunks`; does not call ingestion index/approval/delete endpoints. The helper is used unchanged and without a source list; no ingestion code is modified.
- Model usage: adds dedicated Gemini prompt/schema configuration for JD parsing and fit report generation instead of reusing the generic `generateAnswer()` helper.
- Tests: add unit/contract tests and small synthetic fixtures for JD parsing, all-source retrieval, report citation rules, rejection of unsupported request fields, cross-origin rejection, and generic-search regression.
- Operations: development and browser verification use remote Supabase project `lwljmmfcvmbnrfstltzj`; no local database is created or used.
