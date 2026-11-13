# Design

## Context

See `proposal.md` for motivation and `specs/rag-quality-evals/spec.md` for the behavior contract.

Observed state as of this revision:

- `structured-project-ingestion` and `jd-fit-evaluation` are accepted and archived; both are in the durable spec inventory alongside `project-evidence-index`.
- JD-fit is implemented under `app/lib/jdFit` with `POST /api/jd-fit`. `evaluateJobDescription(body, dependencies)` accepts injectable `client`, `search`, `now`, and limit overrides, so the pipeline can be driven without the route. Test helpers `ScriptedModelClient`, `scriptedSearch`, and `makeHit` already exist in `app/lib/jdFit/testFixtures.ts`.
- The JD-fit request schema is strict: only `jdText` is accepted and `sourceIds` is rejected before retrieval. Retrieval calls `searchApprovedExperienceEvidence` without `sourceIds`.
- Each `JdFitCitation` carries `source_id`, `revision_id`, `approved_content_hash`, `logical_experience_id`, `logical_parent_id`, `logical_chunk_id`, `evidence_logical_ids`, `source_span`, and `quote`.
- `JdFitDiagnostics` carries model, prompt, and validation versions plus retrieval counts; it does not carry ingestion configuration versions. Those live in the revision export's `configuration_versions` (parser, prompt, model, chunking, embedding), reachable read-only via `getExperienceRevisionExport`.
- Archived JD-fit task 3.3 records that sibling revisions R1 and R2 share logical IDs; only `revision_id` and `approved_content_hash` distinguish them.
- Source filtering (`sourceIds`) exists only inside `match_approved_experience_chunks` and the ingestion-owned search helper, and is already covered by `test:experience`.
- Scoped test commands exist: `npm run test:experience` and `npm run test:jd-fit`, each with its own tsconfig and output directory.
- Development and verification run against the remote Supabase project only; there is no local database. The project currently holds test data only, and the owner has authorized clearing and reseeding experience sources there.
- Ingestion extraction and structured parsing use Gemini and are not deterministic; retained source blocks are produced deterministically by the parser from the uploaded file.

## Goals / Non-Goals

**Goals:**

- Measure what unit tests cannot: whether JD-fit cites the right evidence, finds the expected requirements, keeps gaps visible, and resists distractors.
- Keep a deterministic mode that runs in CI with no secrets and proves the grounding, citation, gap, and contract rules.
- Make the live mode's ground truth reproducible by owning the corpus: authored synthetic experience, seeded through the real ingestion pipeline, torn down afterwards.
- Separate failure categories so a red result points at JD-fit, retrieval, ingestion coverage, or the fixture itself.
- Keep the evaluation runner read-only in every mode; confine writes to explicitly flagged corpus commands guarded by an allowed-project check.

**Non-Goals:**

- No changes to ingestion, approved search, JD-fit prompts, endpoints, or UI.
- No migrations, schema changes, or migration-history work.
- No applicant ranking, numeric scoring, analytics dashboard, or prompt-optimization loop.
- No attempt to make live model output reproducible run to run.
- No evaluation of generic documents or generic search quality.

## Decisions

### Decision 1: Drive the pipeline through `evaluateJobDescription`, not the HTTP route

Both modes call `evaluateJobDescription` directly with injected dependencies. Offline injects `ScriptedModelClient` and `scriptedSearch`; live injects nothing and lets the real Gemini client and `approvedEvidenceSearch` resolve. The retrieval adapter in both modes is a thin wrapper that records every search call so the runner can assert no `sourceIds` were passed.

Alternative: evaluate via `POST /api/jd-fit`. Rejected because the route adds same-origin checks and a server process without adding evaluation signal; the function seam already carries the full contract.

### Decision 2: Fixtures are text, DOCX is generated at seed time

A fixture is a validated JSON/TS object: `fixture_id`, `schema_version`, `experience` (ordered paragraphs of synthetic text), `jd_text`, `expected_requirements`, `expected_evidence` (requirement ID to passage substrings), `expected_gaps`, `distractors` (requirement ID to passage substrings that look relevant but are not), `revision_plan` (`single` or `active-r1-latest-r2-unindexed` with the R2 grounded edit), and `thresholds`.

The seed command renders each fixture's paragraphs into a minimal DOCX (a stored ZIP with `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`) using Node's built-ins, with no new dependency. Mammoth reads stored entries. Keeping fixtures as text means one source of truth for the passage substrings used as ground truth.

Alternative: commit DOCX binaries. Rejected because expected passages would then have to be kept in sync with opaque files by hand.

### Decision 3: Ground truth is a passage substring, resolved to a revision-anchored span

Fixture authors write expected evidence and distractors as exact substrings of the fixture text. The runner resolves each substring into an anchor:

```
passage substring
   -> locate in retained source_blocks of the revision export (block_id, start, end)
   -> attach source_id, revision_id, approved_content_hash from the manifest/export
   -> attach logical IDs of any evidence whose resolved_source_refs overlap the span
```

A citation matches an anchor when `source_id`, `revision_id`, and `approved_content_hash` are equal and the citation's `source_span` overlaps the anchor span within the same `block_id`. Logical IDs are recorded for diagnostics but never used alone to decide a match, because sibling revisions share them.

Offline, the "export" is synthesized from the fixture text by the fixture loader (one block per paragraph), and `makeHit` is given the resolved span and revision identity, so the same matching code runs in both modes.

Alternative: anchor on logical evidence IDs. Rejected: it cannot distinguish R1 from R2, and offline fixtures would have to invent IDs the live pipeline never assigns.

### Decision 4: Two modes with different meaning per metric

| Metric | Offline (scripted model, scripted search) | Live (real model, real search over seeded corpus) |
| --- | --- | --- |
| requirement recall / unsupported requirements | harness check: proves the scorer flags misses and inventions | real signal on extraction quality |
| retrieval recall | harness check: scripted hits echo the fixture | real signal on embedding and ranking |
| distractor precision | harness check | real signal: distractors are seeded alongside expected passages |
| ingestion coverage | not applicable (synthesized export covers everything) | real signal: expected passage never became evidence |
| active-vs-latest | harness check over seeded R1/R2 hits | real signal: SQL function and JD-fit must prefer R1 |
| citation validity, unsupported positive claims, gap visibility | real signal: validation and report rules are the code under test | real signal |
| contract checks | real signal | real signal |

Reports label offline extraction and retrieval metrics as harness checks so nobody reads them as model quality. Thresholds apply per mode; a live threshold may be looser than its offline counterpart.

Alternative: a single mode with mocks only. Rejected because retrieval recall over scripted search measures nothing about ranking.

### Decision 5: Corpus lifecycle is a separate command with layered guards

```
+-----------+     +-----------+
| seed      | --> | eval live | <-- repeat as often as needed
| (writes,  |     | (reads)   |
|  once)    |     +-----------+
+-----------+
      |
      v   only when the operator chooses
+------------+   +------------------------------+
| teardown   |   | reset: deletes ALL experience |
| (deletes   |   | sources, then seed again      |
|  manifest) |   +------------------------------+
+------------+
```

The corpus is resident by default: it stays in the test project between live runs so repeated evaluations cost only the JD-fit calls, and the Search page has known data to exercise. `seed` refuses to run while a manifest exists; the operator runs `teardown` (or `reset`) first, or passes an explicit `--replace` that tears down the manifest sources before seeding. Fixture changes therefore require a deliberate reseed, and the manifest records the fixture schema version and a content hash of each fixture so the live preflight can fail with "corpus is stale, reseed" when fixtures have changed since seeding.

- `seed` calls the ingestion service functions directly (`uploadExperienceSourceFromFile`, `extractExperienceSource`, `parseExperienceSource`, `approveExperienceRevision`, `indexExperienceRevision`, and for the active-vs-latest plan `createDraftFromApprovedRevision`, `saveExperienceDraft`, `approveExperienceRevision` without indexing). It does not go through HTTP routes, which carry same-origin mutation guards meant for the browser. Each seeded file name carries a recognizable fixture prefix.
- `seed` writes a manifest to an ignored local directory (for example `.rag-eval/manifest.json`) recording, per fixture, `source_id`, each `revision_id` and `approved_content_hash`, and which revision is active.
- `teardown` deletes every manifest source through `deleteExperienceSource` and reports `cleanup-pending` results for retry.
- `reset` deletes every experience source listed by `listExperienceSources`. It needs its own flag in addition to the live flag. Generic documents are never touched.
- Guards, applied before any write: `RAG_EVAL_LIVE=1` must be set; `RAG_EVAL_ALLOWED_PROJECT_REF` must equal the project ref parsed from `NEXT_PUBLIC_SUPABASE_URL`; `reset` additionally requires `RAG_EVAL_ALLOW_RESET=1`. The deterministic npm script never reads these variables and never imports the corpus module.

Alternative: insert rows directly or seed via SQL. Rejected: the point of seeding through the product pipeline is that the corpus is exactly what a user would have produced, and it exercises ingestion end to end for free.

### Decision 6: Ingestion non-determinism is a reported category, not a fixture failure

Gemini decides which evidence items to create during parsing, so an expected passage may never become a chunk. The live runner checks each expected anchor against the export's `resolved_source_refs` before scoring retrieval: if no evidence covers the passage, it records an ingestion-coverage miss and excludes the passage from retrieval recall. That keeps retrieval numbers honest and points the failure at ingestion.

Alternative: treat uncovered passages as retrieval misses. Rejected because it blames the search for a parsing decision.

### Decision 7: Separate findings first, aggregate second, contract failures always fatal

Per-fixture findings carry a category (`requirement-miss`, `unsupported-requirement`, `retrieval-miss`, `distractor-hit`, `coverage-miss`, `citation-invalid`, `unsupported-positive-claim`, `gap-hidden`, `wrong-revision`, `contract`), the fixture ID, the requirement ID, and a message. Aggregates are computed from findings. Any `contract` or `wrong-revision` finding fails the run regardless of thresholds.

Alternative: a single blended score. Rejected because the actionable category matters more than the number.

### Decision 8: Report object plus optional files in an ignored directory

The runner returns a report object and can print JSON; a helper renders compact Markdown. File output defaults to the same ignored local directory as the manifest, so repeated runs do not churn committed files. Report fields: run ID, timestamps, mode, fixture schema and runner versions, JD-fit diagnostics, per-cited-revision export configuration versions, per-fixture findings, aggregates, thresholds, pass/fail.

Alternative: node test assertions only. Rejected because live results need to be compared across runs and read by a human.

## Risks / Trade-offs

- [Risk] Live runs spend Gemini calls for seeding (extraction, parsing, embedding) and evaluation. -> Keep fixture count small, make live explicit, and never run it in CI.
- [Risk] The resident corpus drifts from the fixtures, or a failed teardown leaves partial data. -> Manifest records fixture hashes and the live preflight fails on a stale corpus; `teardown` is idempotent and reports `cleanup-pending`; `reset` is the backstop.
- [Risk] A corpus command runs against a project with real data later. -> Allowed-project ref check before every write, separate flag for `reset`, fixture-prefixed file names.
- [Risk] Live results fluctuate between runs. -> Mark reports live/non-deterministic, apply looser live thresholds, and compare categories rather than single numbers.
- [Risk] Offline metrics are mistaken for quality measurements. -> Label harness-check metrics in the report and docs.
- [Risk] Gemini may parse a fixture so that an expected passage is never evidence. -> Coverage-miss category (Decision 6); author fixture text as explicit, factual project statements that parse reliably.
- [Risk] Generated DOCX may not be accepted by mammoth or the extraction preflight. -> Verify the generated file round-trips through `documentExtraction` in a unit test before any live seeding.
- [Risk] Approval requires the draft's validated version and content hash. -> Seed reads the parsed draft's version and hash from the parse result before approving; the active-vs-latest plan makes only a grounded field edit so R2 validation passes.

## Migration Plan

1. Commit the currently staged JD-fit implementation so the eval change builds on a clean tree.
2. Add fixture schema, synthetic fixtures, passage-anchor resolution, and validation tests.
3. Add the deterministic runner, adapters, metrics, report schema, npm script, and mutation-spy tests.
4. Add the corpus module (`seed`, `teardown`, `reset`) with guards and DOCX generation, unit-tested against mocked service functions.
5. Add live mode and run it end to end against the allowed project: `reset`, `seed`, live eval, then a second live eval against the resident corpus to confirm the no-reseed path; leave the corpus in place and record results and limitations in implementation notes.
6. Add documentation; run eval tests, `test:jd-fit`, `test:experience`, lint, typecheck, build, and strict OpenSpec validation.

Rollback is code-only plus `teardown` (or `reset`) to remove the resident corpus. No migrations are involved.

## Open Questions

- Initial threshold values per mode. Start permissive in live mode (for example recall 0.6, distractor precision 0.7) and tighten after the first few recorded runs; offline thresholds are exact.
