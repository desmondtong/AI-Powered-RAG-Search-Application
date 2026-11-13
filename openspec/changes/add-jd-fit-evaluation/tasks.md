# Tasks

## 1. Preconditions and Contracts

- [ ] 1.1 Confirm the synced `structured-project-ingestion` spec (archived 2026-11-13) still exposes active-approved search and parent-expanded lineage as this change consumes it, and that the approved-search helper is unchanged; record the check before editing application code.
- [ ] 1.2 Create `app/lib/jdFit` contract types and runtime schemas for requests, requirements, fit labels, citations, diagnostics, and responses; verify unit tests accept a valid fixture and reject numeric scores, missing JD text, unsupported labels, malformed citations, and unknown request fields such as `sourceIds`.
- [ ] 1.3 Add a `test:jd-fit` script with its own scoped TypeScript config that compiles `app/lib/jdFit/**` and `app/api/jd-fit/**` and whose `node --test` glob reaches every JD-fit test file; verify a placeholder test runs without Gemini or Supabase network access and `npm run test:experience` still runs unchanged.
- [ ] 1.4 Document JD-fit response shape, fit labels, citation semantics, and configured limits near the new JD-fit modules; verify documented examples parse through the runtime schemas.

## 2. JD Parsing and Report Generation

- [ ] 2.1 Implement a dedicated bounded JD requirement extraction helper with JSON response validation, prompt versioning, completion-reason checks, and prompt-injection-resistant JD framing; verify mocked model tests for normal JDs, embedded malicious instructions, blocked output, truncated output, over-limit input, and over-limit requirement count.
- [ ] 2.2 Implement dedicated report generation with categorical labels, citation handles, model/prompt diagnostics, and no numeric scores; verify mocked model tests for strong, partial, weak, and missing-evidence outputs.
- [ ] 2.3 Implement one bounded repair or safe-downgrade path for completed invalid model output; verify truncated, blocked, empty, or deadline-expired generations are not repaired into confident reports.
- [ ] 2.4 Preserve the generic `generateAnswer()` defaults and generic Gemini helper behavior; verify tests prove JD-fit helpers do not call or mutate the generic answer helper.

## 3. Approved Evidence Retrieval and Budgeting

- [ ] 3.1 Implement per-requirement retrieval through `searchApprovedExperienceEvidence()` only; verify tests spy on retrieval calls and prove JD-fit does not call `/api/search`, `match_documents`, unfiltered evidence helpers, retained export for discovery, or ingestion mutation endpoints.
- [ ] 3.2 Search all eligible indexed sources on every evaluation; verify retrieval calls never pass `sourceIds`, a request containing `sourceIds` is rejected before retrieval, and lookups run at most four at a time within the overall deadline.
- [ ] 3.3 Add an active-vs-latest retrieval regression fixture; verify when R1 is active/indexed and R2 is latest approved but not indexed, JD-fit evidence and citations carry R1's `revision_id` and `approved_content_hash`, never R2's, without relying on logical IDs that both revisions share.
- [ ] 3.4 Add deterministic deduplication and context budgeting across requirement retrieval results; verify duplicate chunks/source spans collapse once, including hits whose logical chunk ID is null, context trimming is deterministic, and diagnostics report retrieval and truncation counts.
- [ ] 3.5 Preserve parent-expanded citation lineage from approved-search results; verify retrieved evidence retains source ID, revision ID, approved hash, logical experience/parent/chunk IDs, `metadata.evidence_logical_ids`, parent context, and `metadata.source_span` for validation.

## 4. Citation Validation and API Route

- [ ] 4.1 Implement citation validation for generated fit claims; verify every strong or partial fit claim requires valid retrieved evidence, invalid citations are rejected or downgraded, and weak/missing classifications cannot hide unsupported positive claims.
- [ ] 4.2 Implement `POST /api/jd-fit` with request validation, same-origin rejection, bounded JD processing, an overall deadline, read-only retrieval, report generation, and stable error responses; verify route tests for invalid JD, unknown request fields, cross-origin request, no active evidence, deadline exceeded, model failure, and successful cited report.
- [ ] 4.3 Prove JD-fit is read-only against ingestion state; verify route/helper tests fail if evaluation calls approval, index, retry, publish, delete, storage cleanup, or draft mutation code paths.
- [ ] 4.4 Add API contract documentation or examples for `/api/jd-fit`; verify the documented request/response examples pass schema validation and include diagnostics without leaking service-role credentials or private storage paths.

## 5. Search Page JD-fit Mode

- [ ] 5.1 Add an explicit mode switch to the Search page with isolated state for generic search and JD-fit evaluation; verify contract tests show generic mode still fetches `/api/search` and JD-fit mode fetches `/api/jd-fit`, and extend the Search page contract test so it still asserts no `/api/experiences` reference.
- [ ] 5.2 Add JD-fit report rendering for requirement categories, citations, gaps, no-evidence state, loading, and retryable failures; verify UI tests or static contract tests cover each state without changing the generic answer/source rendering.
- [ ] 5.3 Keep generic document upload, generic search, and Documents experience workflows visually and behaviorally separate; verify existing generic and experience contract tests still pass after the Search page changes.

## 6. Integration Verification

- [ ] 6.1 Add a synthetic end-to-end JD-fit flow with mocked JD parsing, approved-search evidence, report generation, and citation validation; verify prompt-injection text is ignored, active approved evidence is cited, missing evidence is reported as a gap, and every positive claim has a retained-source citation.
- [ ] 6.2 Run `npm run test:jd-fit`, `npm run test:experience`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`; verify all pass and record any environment limitations in implementation notes.
- [ ] 6.3 Run `openspec validate add-jd-fit-evaluation --strict`; verify the change passes strict validation after implementation.
- [ ] 6.4 Run browser acceptance verification for JD-fit mode against remote Supabase project `lwljmmfcvmbnrfstltzj`: start the app with `npm run dev`, open the local URL in a real browser or browser automation session, switch to JD-fit mode on the Search page, paste a sample JD, submit the evaluation, and verify loading, cited fit report, gaps/no-evidence state, retryable error state, and return to generic search mode all behave correctly. Prefer existing indexed experience; if a synthetic experience file must be uploaded, record it and delete it through the Documents page afterward. Record the URL, steps performed, observed results, data created and removed, screenshots if useful, and any limitations in the implementation notes.

## Workflow follow-up

- The structured-ingestion approved-search contract is accepted and synced, so apply can start.
- Archive/sync `add-jd-fit-evaluation` after implementation acceptance is complete.
- Propose formal RAG quality evaluations separately; this change only captures diagnostics needed to support that later work.
