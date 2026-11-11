# Design

## Context

See `proposal.md` for motivation and `specs/jd-fit-evaluation/spec.md` for the behavior contract.

Observed implementation:

- The app is a Next.js App Router project. The current Search page in `app/page.tsx` posts to `/api/search` and renders a generic answer plus generic sources.
- `/api/search` embeds the query, calls the unfiltered `match_documents` RPC, expands generic document context, and calls the generic `generateAnswer()` helper.
- `generateAnswer()` is configured for generic Q&A with a 512 token default and no structured response validation, so it is not suitable for JD parsing or a cited fit report.
- `add-structured-project-ingestion` adds the separate experience workflow and the ingestion-owned `searchApprovedExperienceEvidence()` helper over `match_approved_experience_chunks`.
- Approved search already normalizes selected source IDs, treats explicit empty selection as no matches, returns parent-expanded lineage, and surfaces ineligible selected-source errors without widening search.
- The updated ingestion contract makes active indexed evidence authoritative for retrieval. A latest approved but not indexed revision is candidate work, not searchable JD-fit evidence.
- `add-structured-project-ingestion` still has unchecked retry-policy and acceptance follow-up tasks. Apply for this change should wait until that change is accepted and archived/synced, or until an equivalent approved-search/export contract is accepted.

## Goals / Non-Goals

**Goals:**

- Add a dedicated JD-fit request/response surface that is separate from generic search.
- Keep the existing generic `/api/search` behavior available and compatible.
- Use only active approved experience evidence through the ingestion-owned helper.
- Produce categorical, citation-grounded fit reports with visible gaps and validation diagnostics.
- Keep JD-fit read-only with respect to ingestion state.

**Non-Goals:**

- No database migrations or changes to foundation evidence tables/RPCs.
- No changes to approval, indexing, publication retry, deletion, storage cleanup, or migration-history reconciliation.
- No use of unpublished latest-approved candidates, retained approval history, generic document chunks, or physical vector IDs as JD-fit evidence.
- No numeric score, resume rewrite, cover letter, interview advice, agent loop, or formal RAG benchmark.

## Decisions

### Decision 1: Add a dedicated JD-fit endpoint and keep generic search intact

Add `POST /api/jd-fit` for JD-fit evaluation. The request accepts `jdText` and optional `sourceIds`. It returns parsed requirements, requirement-level fit classifications, cited evidence, gaps, and diagnostics. It does not reuse `/api/search`, and `/api/search` does not branch into JD-fit.

The Search page gains an explicit mode switch. Generic mode keeps the current `/api/search` request and response state. JD-fit mode posts to `/api/jd-fit` and renders a structured report. If source selection is exposed in the UI, load source options only for JD-fit mode and treat the endpoint validation as authoritative.

Alternative: add an auto-detect branch inside `/api/search`. Rejected because it would blur generic search compatibility and make JD prompt-injection and citation rules harder to isolate.

### Decision 2: Build a small `app/lib/jdFit` pipeline

Use a dedicated module family rather than extending generic search helpers:

| Module | Responsibility |
| --- | --- |
| `contracts.ts` | Request, response, fit-label, citation, diagnostics, and validation schemas |
| `requirements.ts` | Bounded JD requirement extraction and prompt-injection-resistant JD framing |
| `retrieval.ts` | Per-requirement calls to `searchApprovedExperienceEvidence()` with selected-source semantics |
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

Both JD text and retrieved source passages are treated as inert data. Prompts must prohibit obeying instructions inside the JD or source passages. Require JSON responses and validate completion reason, shape, allowed fit labels, citation handles, and diagnostics. Allow at most one bounded repair or downgrade pass for completed but invalid report output; do not repair truncated or blocked generations into a confident report.

Alternative: reuse `generateAnswer()`. Rejected because it has generic instructions, no structured schema, small output limits, and no citation validation.

### Decision 4: Retrieve per requirement from active approved evidence only

For each extracted requirement, build a short retrieval query and call `searchApprovedExperienceEvidence(query, { matchCount, matchThreshold, sourceIds })`. Do not call `/api/search`, `match_documents`, unfiltered evidence helpers, export endpoints for unselected evidence discovery, or any ingestion mutation endpoint.

Retrieval behavior:

- Omitted `sourceIds` passes `undefined`, meaning all eligible active indexed sources.
- Empty `sourceIds` short-circuits to no matches and a no-evidence report.
- Stale or ineligible `sourceIds` surface the approved-search eligibility error and do not fall back to all sources.
- R1 active/R2 approved-but-not-indexed retrieves R1 until R2 replacement succeeds.
- Deduplicate repeated chunks by source ID, revision ID, logical chunk ID, and retained source span.

Alternative: query retained exports or latest approved revisions directly. Rejected because retained history supports inspection and fixtures, not live JD-fit search eligibility.

### Decision 5: Validate citations after report generation

Before report generation, assign temporary evidence handles to retrieved approved-search results. A positive or partial fit claim may cite only those handles. The validator resolves every returned citation back to the retrieved result's source, revision, logical IDs, and retained source-span metadata.

Validation rules:

- Strong or partial fit claims require at least one valid citation.
- Missing, weak, or not-evidenced classifications must not hide unsupported positive claims in rationale text.
- Generated summaries, parent headers, embedding text, and physical vector UUIDs are not accepted as citation anchors.
- If a claim cites missing or invalid evidence, either repair once with the validation error or downgrade/remove the unsupported claim.

Alternative: rely on prompt instructions alone. Rejected because unsupported positive claims are the main product risk.

### Decision 6: Return diagnostics without creating a benchmark

The response includes non-sensitive diagnostics: model name, prompt versions, validation version, requirement count, retrieval count, deduped evidence count, selected-source mode, and context-budget truncation indicators. These fields support future `add-rag-quality-evals` work but do not define a benchmark or ground-truth fixture format in this change.

Alternative: defer diagnostics to the later eval change. Rejected because model and prompt provenance are cheap to capture now and hard to reconstruct later.

## Risks / Trade-offs

- [Risk] `add-structured-project-ingestion` may still change before archive. -> [Mitigation] Gate implementation on the accepted approved-search/export contract and keep JD-fit code dependent on the helper boundary rather than ingestion internals.
- [Risk] LLM output may overstate fit. -> [Mitigation] Enforce categorical labels, require citations for positive claims, validate citations deterministically, and downgrade unsupported claims.
- [Risk] Retrieval can miss relevant evidence when requirements are broad or phrased differently. -> [Mitigation] Extract requirement-specific retrieval queries, retrieve multiple matches per requirement, and report weak/missing evidence visibly instead of inventing coverage.
- [Risk] Source selection UI can drift from backend eligibility. -> [Mitigation] Treat UI filtering as advisory; `/api/jd-fit` relies on approved-search validation and surfaces eligibility errors without widening search.
- [Risk] JD-fit can become slow with many requirements. -> [Mitigation] Bound requirement count, per-requirement top-K, deduped context, and model timeouts; return explicit limit errors when needed.
- [Risk] Generic Search page regressions are easy when adding modes. -> [Mitigation] Update search-page contract tests to assert generic mode still calls `/api/search` and JD-fit mode calls only the dedicated JD-fit surface.

## Migration Plan

1. Wait for `add-structured-project-ingestion` to be accepted and archived/synced, or confirm an equivalent approved-search/export contract is present.
2. Add JD-fit library modules and route tests with mocked model and approved-search helpers.
3. Add `POST /api/jd-fit` without database migrations.
4. Add the explicit Search page mode switch and JD-fit report rendering while preserving generic mode state and behavior.
5. Run focused JD-fit tests, existing experience contract tests that cover approved search, generic search-page regression tests, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and strict OpenSpec validation.

Rollback is code-only: remove the JD-fit route, helper modules, UI mode, and tests. No database or storage rollback is expected because JD-fit is read-only.
