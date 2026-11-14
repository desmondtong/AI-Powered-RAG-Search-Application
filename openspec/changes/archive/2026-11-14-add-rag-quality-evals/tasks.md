# Tasks

## 1. Preconditions and Eval Scaffolding

- [x] 1.1 Confirm the staged JD-fit implementation is committed and `npm run test:jd-fit` and `npm run test:experience` pass on a clean tree; verify `jd-fit-evaluation` and `structured-project-ingestion` are in `openspec list --specs` and that `JdFitCitation`, `JdFitDiagnostics`, `StructuredExperienceExportSchema`, and `evaluateJobDescription` dependency seams match the design's Context section.
- [x] 1.2 Create the eval module scaffold (for example `app/lib/ragQualityEvals/` with `fixtures/`, `runner`, `corpus`, and `report` areas), a `tsconfig.rag-eval-tests.json`, an `npm run test:rag-eval` script, and gitignore entries for the test build output and `.rag-eval/`; verify the script compiles and runs a placeholder test with no `GEMINI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, or `SUPABASE_SERVICE_ROLE_KEY` set, and that no production route, ingestion route, migration, or Storage configuration changed.

## 2. Fixture Contracts and Synthetic Fixtures

- [x] 2.1 Implement runtime schemas for fixtures (fixture ID, schema version, experience paragraphs, JD text, expected requirements with importance, expected evidence passages per requirement, expected gaps, distractor passages, revision plan, per-mode thresholds); verify valid fixtures parse and malformed schema versions, duplicate IDs, missing thresholds, unknown revision plans, and passages that are not exact substrings of the experience text fail with named errors.
- [x] 2.2 Implement passage-to-anchor resolution over a revision export (locate substring in retained `source_blocks`, attach `source_id`, `revision_id`, `approved_content_hash`, overlapping `evidence_logical_ids`) and citation matching by revision identity plus span overlap; verify sibling revisions with identical logical IDs and blocks are distinguished, and that anchors built from vector row IDs, generated summaries, parent headers, or embedding text are rejected.
- [x] 2.3 Implement the offline export synthesizer (one retained block per paragraph, deterministic IDs and hashes) so the same resolution code runs offline; verify offline anchors for a fixture equal the anchors produced from an equivalent real export shape.
- [x] 2.4 Author initial synthetic fixtures: strong match, partial match, missing evidence, prompt-injection JD text, distractor-heavy, and active-R1/latest-R2-unindexed; verify each passes schema validation, states expected gaps and distractors explicitly, contains no real personal or internal text, and resolves every passage.
- [x] 2.5 Document fixture authoring, passage-anchor rules, revision plans, redaction policy, and threshold conventions in the eval README; verify the documented example fixture passes the validator in a test.

## 3. Deterministic Runner and Adapters

- [x] 3.1 Implement the recording retrieval adapter and offline adapters (scripted model client, scripted search keyed by retrieval query, fixed clock, fixed versions) built on `app/lib/jdFit/testFixtures.ts`; verify every search call is recorded with its options and that the deterministic mode throws a configuration error if asked to construct a real model client, Supabase client, or Storage client.
- [x] 3.2 Implement the eval runner over `evaluateJobDescription` with injected dependencies, per-fixture execution, and stable ordering; verify identical fixtures and versions produce byte-identical report objects across repeated runs.
- [x] 3.3 Add mutation-spy tests around ingestion service functions, JD-fit, generic document, database, and Storage seams; verify the runner in both modes never calls upload, extract, parse, approve, index, retry, publish, delete, draft-save, or Storage mutation paths.
- [x] 3.4 Document the deterministic command and its guarantees in the eval README; verify the documented command runs without API keys or Supabase environment variables.

## 4. Metrics and Quality Reports

- [x] 4.1 Implement requirement-extraction findings (`requirement-miss`, `unsupported-requirement`) with importance-aware matching; verify fixture cases produce passing and failing findings with actionable messages naming fixture and requirement.
- [x] 4.2 Implement retrieval findings (`retrieval-miss`, `distractor-hit`, `coverage-miss`) and the active-vs-latest check (`wrong-revision`); verify a missed expected anchor, a retrieved distractor, an uncovered passage, and an R2 citation each produce the correct category and that coverage misses are excluded from recall.
- [x] 4.3 Implement report findings (`citation-invalid`, `unsupported-positive-claim`, `gap-hidden`) and contract findings (`sourceIds` accepted by JD-fit, `sourceIds` passed to search, numeric score field present); verify positive claims without matching anchors, expected gaps reported as strong or partial, and each contract case fail the run regardless of thresholds.
- [x] 4.4 Implement aggregation, per-mode thresholds, the machine-readable report schema, and compact Markdown rendering, with offline extraction and retrieval metrics labeled as harness checks; verify reports include mode, fixture schema and runner versions, JD-fit diagnostics, per-cited-revision export configuration versions, findings, aggregates, thresholds, and pass/fail.
- [x] 4.5 Document report interpretation, finding categories, and threshold policy in the eval README; verify documented failing examples map to the correct categories in a test.

## 5. Seeded Corpus Lifecycle

- [x] 5.1 Implement minimal DOCX generation from fixture paragraphs using Node built-ins; verify the generated file round-trips through the existing `documentExtraction` path into retained blocks whose text equals the fixture paragraphs.
- [x] 5.2 Implement guards shared by all corpus commands (`RAG_EVAL_LIVE=1`, `RAG_EVAL_ALLOWED_PROJECT_REF` equals the ref parsed from `NEXT_PUBLIC_SUPABASE_URL`, `RAG_EVAL_ALLOW_RESET=1` for reset); verify each command refuses before any write when a guard fails and that the deterministic script never imports the corpus module.
- [x] 5.3 Implement `seed` over the ingestion service functions (upload, extract, parse, approve with the parsed draft's version and hash, index) with fixture-prefixed file names and manifest writing to `.rag-eval/manifest.json` including fixture schema version and per-fixture content hashes; verify against mocked service functions that the call order, approval inputs, and manifest contents (source, revision, hash, active flag, fixture hash per fixture) are correct, that seed refuses when a manifest exists, and that an explicit replace option tears down manifest sources first.
- [x] 5.4 Implement the active-R1/latest-R2-unindexed plan in `seed` (create draft from approved, apply the fixture's grounded edit, save, approve without indexing); verify with mocks that R2 is approved but never indexed and both identities land in the manifest.
- [x] 5.5 Implement `teardown` (delete manifest sources, report `cleanup-pending`, keep the manifest until all deletes succeed) and `reset` (delete all listed experience sources, never generic documents); verify with mocks that teardown is idempotent, reset requires its extra flag, and generic document functions are never called.
- [x] 5.6 Document the corpus commands, guards, cost expectations, and the resident-corpus model (seed once, eval repeatedly, teardown or reset only by choice) in the eval README; verify the docs state that corpus commands are the only writers and are never part of CI.

## 6. Live Evaluation

- [x] 6.1 Implement live mode: real model client and `approvedEvidenceSearch` behind the recording adapter, anchors resolved from the manifest plus `getExperienceRevisionExport` per revision, and a preflight that fails with a configuration error naming `seed` when the manifest is missing, a manifest source is not active and indexed, or manifest fixture hashes differ from the current fixtures; verify with mocked exports and search that preflight, anchor resolution, stale detection, and the live report marker behave as specified.
- [x] 6.2 Run the live cycle against the allowed remote project: `reset`, `seed`, live eval, then a second live eval without reseeding; verify the second run performs no writes and the corpus remains active and indexed, leave the corpus resident, record both reports, per-category findings, Gemini usage observed, and any limitations in implementation notes, and adjust initial live thresholds if the recorded runs show they are unreasonable.
- [x] 6.3 Document live-mode prerequisites, the seed-once/eval-repeatedly model, when to teardown or reset, non-deterministic interpretation, and exclusion from CI pass/fail in the eval README; verify the docs state that live is optional and not a substitute for the deterministic suite.

## 7. Integration Verification

- [x] 7.1 Add an end-to-end deterministic suite over all synthetic fixtures; verify it covers requirement extraction, retrieval recall, distractor precision, citation validity, unsupported positive claims, gap visibility, active-vs-latest, contract checks, and that generic search contract tests still pass unchanged.
- [x] 7.2 Run `npm run test:rag-eval`, `npm run test:jd-fit`, `npm run test:experience`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`; verify all pass and record any environment limitations in implementation notes.
- [x] 7.3 Run `openspec validate add-rag-quality-evals --strict`; verify the change passes strict validation after implementation.
- [x] 7.4 Browser acceptance: this change adds no user-facing UI; verify no file under `app/components`, `app/page.tsx`, or `app/api` changed, and record in implementation notes that browser verification was not applicable and why. If any UI did change, start `npm run dev`, walk through the affected workflow in a real browser, and record URL, steps, results, and limitations instead.

## Workflow follow-up

- Archive/sync `add-rag-quality-evals` after deterministic implementation and one recorded live cycle are accepted.
- Keep benchmark expansion, redacted real-world fixture curation, and prompt optimization as separate changes unless explicitly added later.

## Implementation Notes

Recorded 2026-11-14.

### Verification (7.2, 7.3)

| Command | Result |
| --- | --- |
| `npm run test:rag-eval` | 84 tests pass |
| `npm run test:jd-fit` | 62 tests pass, unchanged |
| `npm run test:experience` | 128 tests pass, unchanged; includes the generic search page contract tests |
| `npm run lint` | clean |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds |
| `openspec validate add-rag-quality-evals --strict` | valid |
| `npm run eval:rag` with no Gemini or Supabase variables | PASS, all six fixtures |

Environment limitation: none for the deterministic suite. The live cycle ran separately; see 6.2 below.

### Deterministic report summary

All six fixtures pass with offline thresholds. Aggregates: requirement recall 1.00, retrieval recall 1.00, distractor precision 0.79 (distractor-heavy is exactly 0.50 by design, missing-evidence 0.00 with a 0 threshold), ingestion coverage 1.00, citation validity 1.00, unsupported positive claims 0, gap visibility 1.00. Findings: three `distractor-hit`, all expected by the fixtures.

### Decisions made during implementation

- `seed` saves the parsed draft once with `review_acknowledgements` set when parsing leaves blocks unassigned or extraction reported warnings, then approves the saved version. Without it, approval refuses drafts that a human reviewer would acknowledge. Seed output logs each acknowledgement.
- A `run-error` category (fatal) records a JD-fit exception, so a failed fixture names its cause instead of only failing metrics.
- Distractor precision counts any retrieved distractor, as the spec says. With JD-fit's eight matches per requirement and no similarity floor, a small corpus returns most same-fixture distractors, so the initial live threshold is 0.3. The recorded live runs below kept it.
- The fixture hash in the manifest covers only corpus content (experience text and revision plan), so ground-truth, threshold, or script edits do not force a reseed.
- Contract violations that the accepted JD-fit cannot produce (accepting `sourceIds`, passing `sourceIds` to search, a score field) are tested by altering the recorded observation.

### Live cycle (6.2)

Run on 2026-11-14 against `lwljmmfcvmbnrfstltzj` with the owner's approval, using the four commands in the README order: `reset`, `seed`, live eval, live eval.

- **reset** deleted the two pre-existing sources, `Sample Professional Experience.docx` and `Sample Professional Experience 2.docx`. They remain as `deleted` tombstone rows, which is the existing delete behavior.
- **seed** created six `rag-eval__*` sources. Five are `indexed`. `active-vs-latest` is `approved`, with R1 active and indexed and R2 approved and not indexed, as its revision plan requires. The corpus is left resident.
- **Both live evals passed** on every fixture. Run IDs were `live-20261114T032229196Z` and `live-20261114T032304324Z`.
- **No writes during either live run.** A read-only check after run 2 showed the newest `updated_at` or `created_at` in every experience and evidence table was 03:22:11Z, from seeding. Run 1 started at 03:22:29Z. Run 2's preflight also confirmed the corpus was still active and indexed.

Both runs produced identical metrics:

| Fixture | Requirement recall | Retrieval recall | Distractor precision | Citation validity | Unsupported positive claims | Gap visibility |
| --- | --- | --- | --- | --- | --- | --- |
| active-vs-latest | 1.00 | 1.00 | 1.00 | 1.00 | 0 | n/a |
| distractor-heavy | 1.00 | 1.00 | 1.00 | 1.00 | 0 | n/a |
| missing-evidence | 1.00 | n/a | 0.00 (threshold 0) | n/a | 0 | 1.00 |
| partial-match | 1.00 | 1.00 | 1.00 | 1.00 | 0 | 1.00 |
| prompt-injection | 1.00 | 1.00 | 1.00 | 1.00 | 0 | 1.00 |
| strong-match | 1.00 | 1.00 | 1.00 | 1.00 | 0 | n/a |

Unsupported requirements were 0 and ingestion coverage was 1.00 wherever applicable. Aggregate distractor precision was 0.92.

Per-category findings, both runs: one `distractor-hit` and zero in every other category, including `wrong-revision` and `contract`. The hit is in missing-evidence: "Added Core Data storage and background sync" was retrieved for "Firmware in C on an RTOS", at rank 3 in run 1 and rank 6 in run 2. That fixture has no supporting evidence, so any retrieval is a distractor, and its threshold is 0 by design.

JD-fit outcomes matched between runs. The prompt-injection fixture extracted no injected requirement and reported the Rust gap. Partial-match reported dbt as missing. Active-vs-latest cited only R1.

Gemini usage observed (model `gemini-flash-lite-latest`):

| Step | Generation calls | Embedding queries |
| --- | --- | --- |
| seed | 6 structured extractions (R2 is cloned, not re-extracted) | 15 chunks indexed |
| live run 1 | 12 (requirements plus report per fixture, no repairs) | 15 requirement searches |
| live run 2 | 13 (one report repair in partial-match) | 15 requirement searches |

Each live run took about 21 seconds.

Thresholds: kept unchanged. Live distractor precision stayed at 0.3 even though observed values were 1.00 on every fixture with distractors. Two runs are too few to tighten it safely, and the retrieval rank of the same distractor moved between runs. A tighter value, around 0.75, is a candidate once more runs are recorded.

Limitations:
- Live mode is not deterministic. The second run needed a report repair the first did not, and distractor ranks shifted.
- Search spans the whole project, so any non-fixture source added later will be retrievable by live runs and can lower citation validity or distractor precision.
- Gemini usage counts are derived from report diagnostics. Token counts are not recorded.

### Browser acceptance (7.4)

Not applicable. This change adds no user-facing UI: `git status` and `git diff` show no changes under `app/components`, `app/page.tsx`, or `app/api`. The harness runs only from npm scripts. Live corpus seeding would add six `rag-eval__*` sources visible on the Documents page, but that is ingestion's existing UI, unchanged here.
