# Tasks

## 1. Preconditions and Contracts

- [ ] 1.1 Confirm `add-structured-project-ingestion` has been accepted and archived/synced, or confirm an equivalent accepted approved-search/export contract; verify the accepted spec exposes active-approved search with omitted/empty/ineligible source-selection semantics before editing application code.
- [ ] 1.2 Create `app/lib/jdFit` contract types and runtime schemas for requests, requirements, fit labels, citations, diagnostics, and responses; verify unit tests accept a valid fixture and reject numeric scores, missing JD text, unsupported labels, and malformed citations.
- [ ] 1.3 Add JD-fit test discovery, fixtures, and a scoped test command or extend the existing scoped TypeScript test setup; verify the JD-fit fixture tests compile and run without requiring Gemini or Supabase network access.
- [ ] 1.4 Document JD-fit response shape, fit labels, citation semantics, and configured limits near the new JD-fit modules; verify documented examples parse through the runtime schemas.

## 2. JD Parsing and Report Generation

- [ ] 2.1 Implement a dedicated bounded JD requirement extraction helper with JSON response validation, prompt versioning, completion-reason checks, and prompt-injection-resistant JD framing; verify mocked model tests for normal JDs, embedded malicious instructions, blocked output, truncated output, over-limit input, and over-limit requirement count.
- [ ] 2.2 Implement dedicated report generation with categorical labels, citation handles, model/prompt diagnostics, and no numeric scores; verify mocked model tests for strong, partial, weak, and missing-evidence outputs.
- [ ] 2.3 Implement one bounded repair or safe-downgrade path for completed invalid model output; verify truncated, blocked, empty, or deadline-expired generations are not repaired into confident reports.
- [ ] 2.4 Preserve the generic `generateAnswer()` defaults and generic Gemini helper behavior; verify tests prove JD-fit helpers do not call or mutate the generic answer helper.

## 3. Approved Evidence Retrieval and Budgeting

- [ ] 3.1 Implement per-requirement retrieval through `searchApprovedExperienceEvidence()` only; verify tests spy on retrieval calls and prove JD-fit does not call `/api/search`, `match_documents`, unfiltered evidence helpers, retained export for discovery, or ingestion mutation endpoints.
- [ ] 3.2 Preserve selected-source semantics in JD-fit retrieval; verify omitted selection searches all eligible sources, explicit empty selection returns no matches without embedding or RPC work, and stale/ineligible selection returns an explicit eligibility error without widening search.
- [ ] 3.3 Add an active-vs-latest retrieval regression fixture; verify when R1 is active/indexed and R2 is latest approved but not indexed, JD-fit uses the approved-search result for R1 and never reads R2 as evidence.
- [ ] 3.4 Add deterministic deduplication and context budgeting across requirement retrieval results; verify duplicate chunks/source spans collapse once, context trimming is deterministic, and diagnostics report retrieval and truncation counts.
- [ ] 3.5 Preserve parent-expanded citation lineage from approved-search results; verify retrieved evidence retains source ID, revision ID, approved hash, logical experience/parent/chunk IDs, parent context, and retained source-span metadata for validation.

## 4. Citation Validation and API Route

- [ ] 4.1 Implement citation validation for generated fit claims; verify every strong or partial fit claim requires valid retrieved evidence, invalid citations are rejected or downgraded, and weak/missing classifications cannot hide unsupported positive claims.
- [ ] 4.2 Implement `POST /api/jd-fit` with request validation, selected-source handling, bounded JD processing, read-only retrieval, report generation, and stable error responses; verify route tests for invalid JD, no active evidence, explicit empty selection, ineligible selection, model failure, and successful cited report.
- [ ] 4.3 Prove JD-fit is read-only against ingestion state; verify route/helper tests fail if evaluation calls approval, index, retry, publish, delete, storage cleanup, or draft mutation code paths.
- [ ] 4.4 Add API contract documentation or examples for `/api/jd-fit`; verify the documented request/response examples pass schema validation and include diagnostics without leaking service-role credentials or private storage paths.

## 5. Search Page JD-fit Mode

- [ ] 5.1 Add an explicit mode switch to the Search page with isolated state for generic search and JD-fit evaluation; verify contract tests show generic mode still fetches `/api/search` and JD-fit mode fetches `/api/jd-fit`.
- [ ] 5.2 Add JD-fit report rendering for requirement categories, citations, gaps, no-evidence state, source-eligibility errors, loading, and retryable failures; verify UI tests or static contract tests cover each state without changing the generic answer/source rendering.
- [ ] 5.3 Add optional source selection behavior for JD-fit mode if source options are displayed; verify untouched selection omits `sourceIds`, intentionally cleared selection sends an empty array, and backend eligibility errors are shown without client-side widening.
- [ ] 5.4 Keep generic document upload, generic search, and Documents experience workflows visually and behaviorally separate; verify existing generic and experience contract tests still pass after the Search page changes.

## 6. Integration Verification

- [ ] 6.1 Add a synthetic end-to-end JD-fit flow with mocked JD parsing, approved-search evidence, report generation, and citation validation; verify prompt-injection text is ignored, active approved evidence is cited, missing evidence is reported as a gap, and every positive claim has a retained-source citation.
- [ ] 6.2 Run the scoped JD-fit tests, `npm run test:experience`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`; verify all pass and record any environment limitations in implementation notes.
- [ ] 6.3 Run `openspec validate add-jd-fit-evaluation --strict`; verify the change passes strict validation after implementation.

## Workflow follow-up

- Apply this change only after the structured-ingestion approved-search/export contract is accepted and available.
- Archive/sync `add-jd-fit-evaluation` after implementation acceptance is complete.
- Propose formal RAG quality evaluations separately; this change only captures diagnostics needed to support that later work.
