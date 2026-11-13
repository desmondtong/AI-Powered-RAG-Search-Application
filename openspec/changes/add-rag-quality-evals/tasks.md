# Tasks

## 1. Preconditions and Eval Scaffolding

- [ ] 1.1 Confirm the staged JD-fit implementation is committed and `npm run test:jd-fit` and `npm run test:experience` pass on a clean tree; verify `jd-fit-evaluation` and `structured-project-ingestion` are in `openspec list --specs` and that `JdFitCitation`, `JdFitDiagnostics`, `StructuredExperienceExportSchema`, and `evaluateJobDescription` dependency seams match the design's Context section.
- [ ] 1.2 Create the eval module scaffold (for example `app/lib/ragQualityEvals/` with `fixtures/`, `runner`, `corpus`, and `report` areas), a `tsconfig.rag-eval-tests.json`, an `npm run test:rag-eval` script, and gitignore entries for the test build output and `.rag-eval/`; verify the script compiles and runs a placeholder test with no `GEMINI_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, or `SUPABASE_SERVICE_ROLE_KEY` set, and that no production route, ingestion route, migration, or Storage configuration changed.

## 2. Fixture Contracts and Synthetic Fixtures

- [ ] 2.1 Implement runtime schemas for fixtures (fixture ID, schema version, experience paragraphs, JD text, expected requirements with importance, expected evidence passages per requirement, expected gaps, distractor passages, revision plan, per-mode thresholds); verify valid fixtures parse and malformed schema versions, duplicate IDs, missing thresholds, unknown revision plans, and passages that are not exact substrings of the experience text fail with named errors.
- [ ] 2.2 Implement passage-to-anchor resolution over a revision export (locate substring in retained `source_blocks`, attach `source_id`, `revision_id`, `approved_content_hash`, overlapping `evidence_logical_ids`) and citation matching by revision identity plus span overlap; verify sibling revisions with identical logical IDs and blocks are distinguished, and that anchors built from vector row IDs, generated summaries, parent headers, or embedding text are rejected.
- [ ] 2.3 Implement the offline export synthesizer (one retained block per paragraph, deterministic IDs and hashes) so the same resolution code runs offline; verify offline anchors for a fixture equal the anchors produced from an equivalent real export shape.
- [ ] 2.4 Author initial synthetic fixtures: strong match, partial match, missing evidence, prompt-injection JD text, distractor-heavy, and active-R1/latest-R2-unindexed; verify each passes schema validation, states expected gaps and distractors explicitly, contains no real personal or internal text, and resolves every passage.
- [ ] 2.5 Document fixture authoring, passage-anchor rules, revision plans, redaction policy, and threshold conventions in the eval README; verify the documented example fixture passes the validator in a test.

## 3. Deterministic Runner and Adapters

- [ ] 3.1 Implement the recording retrieval adapter and offline adapters (scripted model client, scripted search keyed by retrieval query, fixed clock, fixed versions) built on `app/lib/jdFit/testFixtures.ts`; verify every search call is recorded with its options and that the deterministic mode throws a configuration error if asked to construct a real model client, Supabase client, or Storage client.
- [ ] 3.2 Implement the eval runner over `evaluateJobDescription` with injected dependencies, per-fixture execution, and stable ordering; verify identical fixtures and versions produce byte-identical report objects across repeated runs.
- [ ] 3.3 Add mutation-spy tests around ingestion service functions, JD-fit, generic document, database, and Storage seams; verify the runner in both modes never calls upload, extract, parse, approve, index, retry, publish, delete, draft-save, or Storage mutation paths.
- [ ] 3.4 Document the deterministic command and its guarantees in the eval README; verify the documented command runs without API keys or Supabase environment variables.

## 4. Metrics and Quality Reports

- [ ] 4.1 Implement requirement-extraction findings (`requirement-miss`, `unsupported-requirement`) with importance-aware matching; verify fixture cases produce passing and failing findings with actionable messages naming fixture and requirement.
- [ ] 4.2 Implement retrieval findings (`retrieval-miss`, `distractor-hit`, `coverage-miss`) and the active-vs-latest check (`wrong-revision`); verify a missed expected anchor, a retrieved distractor, an uncovered passage, and an R2 citation each produce the correct category and that coverage misses are excluded from recall.
- [ ] 4.3 Implement report findings (`citation-invalid`, `unsupported-positive-claim`, `gap-hidden`) and contract findings (`sourceIds` accepted by JD-fit, `sourceIds` passed to search, numeric score field present); verify positive claims without matching anchors, expected gaps reported as strong or partial, and each contract case fail the run regardless of thresholds.
- [ ] 4.4 Implement aggregation, per-mode thresholds, the machine-readable report schema, and compact Markdown rendering, with offline extraction and retrieval metrics labeled as harness checks; verify reports include mode, fixture schema and runner versions, JD-fit diagnostics, per-cited-revision export configuration versions, findings, aggregates, thresholds, and pass/fail.
- [ ] 4.5 Document report interpretation, finding categories, and threshold policy in the eval README; verify documented failing examples map to the correct categories in a test.

## 5. Seeded Corpus Lifecycle

- [ ] 5.1 Implement minimal DOCX generation from fixture paragraphs using Node built-ins; verify the generated file round-trips through the existing `documentExtraction` path into retained blocks whose text equals the fixture paragraphs.
- [ ] 5.2 Implement guards shared by all corpus commands (`RAG_EVAL_LIVE=1`, `RAG_EVAL_ALLOWED_PROJECT_REF` equals the ref parsed from `NEXT_PUBLIC_SUPABASE_URL`, `RAG_EVAL_ALLOW_RESET=1` for reset); verify each command refuses before any write when a guard fails and that the deterministic script never imports the corpus module.
- [ ] 5.3 Implement `seed` over the ingestion service functions (upload, extract, parse, approve with the parsed draft's version and hash, index) with fixture-prefixed file names and manifest writing to `.rag-eval/manifest.json` including fixture schema version and per-fixture content hashes; verify against mocked service functions that the call order, approval inputs, and manifest contents (source, revision, hash, active flag, fixture hash per fixture) are correct, that seed refuses when a manifest exists, and that an explicit replace option tears down manifest sources first.
- [ ] 5.4 Implement the active-R1/latest-R2-unindexed plan in `seed` (create draft from approved, apply the fixture's grounded edit, save, approve without indexing); verify with mocks that R2 is approved but never indexed and both identities land in the manifest.
- [ ] 5.5 Implement `teardown` (delete manifest sources, report `cleanup-pending`, keep the manifest until all deletes succeed) and `reset` (delete all listed experience sources, never generic documents); verify with mocks that teardown is idempotent, reset requires its extra flag, and generic document functions are never called.
- [ ] 5.6 Document the corpus commands, guards, cost expectations, and the resident-corpus model (seed once, eval repeatedly, teardown or reset only by choice) in the eval README; verify the docs state that corpus commands are the only writers and are never part of CI.

## 6. Live Evaluation

- [ ] 6.1 Implement live mode: real model client and `approvedEvidenceSearch` behind the recording adapter, anchors resolved from the manifest plus `getExperienceRevisionExport` per revision, and a preflight that fails with a configuration error naming `seed` when the manifest is missing, a manifest source is not active and indexed, or manifest fixture hashes differ from the current fixtures; verify with mocked exports and search that preflight, anchor resolution, stale detection, and the live report marker behave as specified.
- [ ] 6.2 Run the live cycle against the allowed remote project: `reset`, `seed`, live eval, then a second live eval without reseeding; verify the second run performs no writes and the corpus remains active and indexed, leave the corpus resident, record both reports, per-category findings, Gemini usage observed, and any limitations in implementation notes, and adjust initial live thresholds if the recorded runs show they are unreasonable.
- [ ] 6.3 Document live-mode prerequisites, the seed-once/eval-repeatedly model, when to teardown or reset, non-deterministic interpretation, and exclusion from CI pass/fail in the eval README; verify the docs state that live is optional and not a substitute for the deterministic suite.

## 7. Integration Verification

- [ ] 7.1 Add an end-to-end deterministic suite over all synthetic fixtures; verify it covers requirement extraction, retrieval recall, distractor precision, citation validity, unsupported positive claims, gap visibility, active-vs-latest, contract checks, and that generic search contract tests still pass unchanged.
- [ ] 7.2 Run `npm run test:rag-eval`, `npm run test:jd-fit`, `npm run test:experience`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`; verify all pass and record any environment limitations in implementation notes.
- [ ] 7.3 Run `openspec validate add-rag-quality-evals --strict`; verify the change passes strict validation after implementation.
- [ ] 7.4 Browser acceptance: this change adds no user-facing UI; verify no file under `app/components`, `app/page.tsx`, or `app/api` changed, and record in implementation notes that browser verification was not applicable and why. If any UI did change, start `npm run dev`, walk through the affected workflow in a real browser, and record URL, steps, results, and limitations instead.

## Workflow follow-up

- Archive/sync `add-rag-quality-evals` after deterministic implementation and one recorded live cycle are accepted.
- Keep benchmark expansion, redacted real-world fixture curation, and prompt optimization as separate changes unless explicitly added later.
