# Design

## Context

See `proposal.md` for motivation and `specs/jd-fit-evaluation/spec.md` for the behavior contract.

Observed implementation:

- The app is a Next.js App Router project. The current Search page in `app/page.tsx` posts to `/api/search` and renders a generic answer plus generic sources.
- `/api/search` embeds the query, calls the unfiltered `match_documents` RPC, expands generic document context, and calls the generic `generateAnswer()` helper.
- `generateAnswer()` is configured for generic Q&A with a 512 token default and no structured response validation, so it is not suitable for JD parsing or a cited fit report.
- `add-structured-project-ingestion` adds the separate experience workflow and the ingestion-owned `searchApprovedExperienceEvidence()` helper over `match_approved_experience_chunks`.
- Approved search returns parent-expanded lineage for active indexed evidence. Each hit carries its source ID, revision ID, approved content hash, and logical experience, parent, and chunk IDs, plus `metadata.source_span` and `metadata.evidence_logical_ids`. Ingestion guarantees the chunk text equals the retained span text. The helper also supports source selection, which this change does not use.
- The updated ingestion contract makes active indexed evidence authoritative for retrieval. A latest approved but not indexed revision is candidate work, not searchable JD-fit evidence.
- `add-structured-project-ingestion` is accepted and archived (`openspec/changes/archive/2026-11-13-add-structured-project-ingestion/`), and its contract is synced to `openspec/specs/structured-project-ingestion/spec.md`. A revision drafted from an approved one keeps its logical IDs, so only `revision_id` and `approved_content_hash` distinguish R1 from R2.
- The approved-search helper has no production caller yet; only ingestion tests import it. JD-fit uses it unchanged.
- Development, dev-server runs, and verification use remote Supabase project `lwljmmfcvmbnrfstltzj`. There is no local database.

## Goals / Non-Goals

**Goals:**

- Add a dedicated JD-fit request/response surface that is separate from generic search.
- Keep the existing generic `/api/search` behavior available and compatible.
- Use only active approved experience evidence through the ingestion-owned helper.
- Search all eligible indexed experience sources on every evaluation.
- Produce categorical, citation-grounded fit reports with visible gaps and validation diagnostics.
- Keep JD-fit read-only with respect to ingestion state.

**Non-Goals:**

- No database migrations or changes to foundation evidence tables/RPCs.
- No changes to approval, indexing, publication retry, deletion, storage cleanup, or migration-history reconciliation.
- No use of unpublished latest-approved candidates, retained approval history, generic document chunks, or physical vector IDs as JD-fit evidence.
- No numeric score, resume rewrite, cover letter, interview advice, agent loop, or formal RAG benchmark.
- No source selection or source picker in this version.
- No modification of ingestion code, including the approved-search helper.

## Decisions

### Decision 1: Add a dedicated JD-fit endpoint and keep generic search intact

Add `POST /api/jd-fit` for JD-fit evaluation. The request accepts `jdText` only; unknown fields, including `sourceIds`, are rejected with a validation error. It returns parsed requirements, requirement-level fit classifications, cited evidence, gaps, and diagnostics. It does not reuse `/api/search`, and `/api/search` does not branch into JD-fit.

The Search page gains an explicit mode switch. Generic mode keeps the current `/api/search` request and response state. JD-fit mode posts to `/api/jd-fit` and renders a structured report. The Search page shows no source picker and never calls the experiences API.

The route rejects requests from other origins before any parsing, retrieval, or model call, using the same approach as the experience routes' check in `app/lib/experience/apiRoutes.ts`. JD-fit adds its own equivalent check rather than editing that ingestion helper.

Alternative: add an auto-detect branch inside `/api/search`. Rejected because it would blur generic search compatibility and make JD prompt-injection and citation rules harder to isolate.

### Decision 2: Build a small `app/lib/jdFit` pipeline

Use a dedicated module family rather than extending generic search helpers:

| Module | Responsibility |
| --- | --- |
| `contracts.ts` | Request, response, fit-label, citation, diagnostics, and validation schemas |
| `requirements.ts` | Bounded JD requirement extraction and prompt-injection-resistant JD framing |
| `retrieval.ts` | Per-requirement calls to `searchApprovedExperienceEvidence()` across all eligible indexed sources, at most four at a time |
| `context.ts` | Deduplication, grouping, and context budget enforcement |
| `report.ts` | Categorical report generation with required citation handles |
| `validation.ts` | Citation validation, unsupported-claim detection, and safe downgrade/retry rules |

This shape mirrors the structured-ingestion separation between generic Gemini helpers and validated structured generation. It also makes the read-only retrieval boundary easy to test.

Alternative: put all logic in the route handler. Rejected because parsing, retrieval budgeting, generation, and citation validation each need focused tests.

### Decision 3: Use dedicated Gemini structured generation settings

Add JD-fit-specific configuration such as:

| Setting | Default |
| --- | --- |
| Model | `JD_FIT_MODEL`, else `GEMINI_GENERATION_MODEL`, else `gemini-flash-lite-latest` |
| Requirement prompt version | `jd-fit-requirements-v1` |
| Report prompt version | `jd-fit-report-v1` |
| Validation version | `jd-fit-validation-v1` |
| Max requirements | 20 |
| Retrieval per requirement | 8 |
| Context budget | 16,000 characters or a token-equivalent bounded helper |
| Overall request deadline | `JD_FIT_DEADLINE_MS`, default 120,000 ms |
| Max output tokens per generation | `JD_FIT_MAX_OUTPUT_TOKENS`, default 16,384 |
| Retrieval concurrency | 4 requirement lookups at a time |

The deadline covers parsing, retrieval, and report generation; exceeding it returns an explicit timeout error and no partial report. The output cap is separate from the generic `GEMINI_MAX_OUTPUT_TOKENS` default of 512. These values mirror the structured-ingestion settings and can be tuned.

Both JD text and retrieved source passages are treated as inert data. Prompts must prohibit obeying instructions inside the JD or source passages. Require JSON responses and validate completion reason, shape, allowed fit labels, citation handles, and diagnostics. Allow at most one bounded repair or downgrade pass for completed but invalid report output; do not repair truncated or blocked generations into a confident report.

Alternative: reuse `generateAnswer()`. Rejected because it has generic instructions, no structured schema, small output limits, and no citation validation.

### Decision 4: Retrieve per requirement from active approved evidence only

For each extracted requirement, build a short retrieval query and call `searchApprovedExperienceEvidence(query, { matchCount, matchThreshold })` with no `sourceIds`, so every eligible active indexed source is searched. Do not call `/api/search`, `match_documents`, unfiltered evidence helpers, export endpoints for unselected evidence discovery, or any ingestion mutation endpoint.

Retrieval behavior:

- Lookups run at most four at a time and share the overall deadline.
- R1 active/R2 approved-but-not-indexed retrieves R1 until R2 replacement succeeds. Tests distinguish them by `revision_id` and `approved_content_hash`, because R2 drafted from an approved revision reuses R1's logical IDs.
- Deduplicate repeated chunks by source ID, revision ID, and logical chunk ID, falling back to the chunk row ID and retained source span when the logical chunk ID is null.

Alternative: query retained exports or latest approved revisions directly. Rejected because retained history supports inspection and fixtures, not live JD-fit search eligibility.

Alternative: send the whole indexed corpus to the model, or a hybrid that does so below a size threshold. Deferred: the corpus is currently small, so this would raise recall, but per-requirement retrieval was chosen for this change. Revisit if `add-rag-quality-evals` shows recall problems.

### Decision 5: Validate citations after report generation

Before report generation, assign temporary evidence handles to retrieved approved-search results. A positive or partial fit claim may cite only those handles. The validator resolves every returned citation back to the retrieved result's source, revision, logical IDs, and retained source-span metadata. Citation anchors are each hit's `metadata.source_span` and `metadata.evidence_logical_ids`; quoted evidence comes from the chunk text, which ingestion guarantees equals the span text.

Validation rules:

- Strong or partial fit claims require at least one valid citation.
- Missing, weak, or not-evidenced classifications must not hide unsupported positive claims in rationale text.
- Generated summaries, parent headers, embedding text, and physical vector UUIDs are not accepted as citation anchors.
- If a claim cites missing or invalid evidence, either repair once with the validation error or downgrade/remove the unsupported claim.

Alternative: rely on prompt instructions alone. Rejected because unsupported positive claims are the main product risk.

### Decision 6: Return diagnostics without creating a benchmark

The response includes non-sensitive diagnostics: model name, prompt versions, validation version, requirement count, retrieval count, deduped evidence count, and context-budget truncation indicators. These fields support future `add-rag-quality-evals` work but do not define a benchmark or ground-truth fixture format in this change.

Alternative: defer diagnostics to the later eval change. Rejected because model and prompt provenance are cheap to capture now and hard to reconstruct later.

## Risks / Trade-offs

- [Risk] Ingestion's approved-search contract could change in a later change. -> [Mitigation] Keep JD-fit dependent on the helper boundary and the synced `structured-project-ingestion` spec rather than ingestion internals.
- [Risk] LLM output may overstate fit. -> [Mitigation] Enforce categorical labels, require citations for positive claims, validate citations deterministically, and downgrade unsupported claims.
- [Risk] Retrieval can miss relevant evidence when requirements are broad or phrased differently. -> [Mitigation] Extract requirement-specific retrieval queries, retrieve multiple matches per requirement, and report weak/missing evidence visibly instead of inventing coverage.
- [Risk] Vector-only retrieval can miss evidence phrased differently from the JD, so the report would show a real skill as a gap. -> [Mitigation] Use requirement-specific queries and multiple hits per requirement, present gaps as not found in retrieved evidence, and measure recall in `add-rag-quality-evals`; full-corpus or hybrid evidence remains the documented fallback.
- [Risk] Browser verification against the remote database can leave synthetic data behind. -> [Mitigation] Prefer existing indexed experience; if a synthetic file is uploaded, record it and delete it through the Documents page afterward.
- [Risk] JD-fit can become slow with many requirements. -> [Mitigation] Bound requirement count, per-requirement top-K, deduped context, and model timeouts; return explicit limit errors when needed.
- [Risk] Generic Search page regressions are easy when adding modes. -> [Mitigation] Update search-page contract tests to assert generic mode still calls `/api/search` and JD-fit mode calls only the dedicated JD-fit surface.

## Migration Plan

1. Confirm the synced `structured-project-ingestion` spec still defines the active-approved search consumed here. This precondition was met by the 2026-11-13 archive.
2. Add JD-fit library modules and route tests with mocked model and approved-search helpers.
3. Add `POST /api/jd-fit` without database migrations.
4. Add the explicit Search page mode switch and JD-fit report rendering while preserving generic mode state and behavior.
5. Run `npm run test:jd-fit`, existing experience contract tests that cover approved search, generic search-page regression tests, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and strict OpenSpec validation.

Rollback is code-only: remove the JD-fit route, helper modules, UI mode, and tests. No database or storage rollback is expected because JD-fit is read-only.
