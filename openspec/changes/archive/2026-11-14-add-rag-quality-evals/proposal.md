# Proposal

## Why

Structured ingestion and JD-fit are accepted and archived. Their test suites prove the code behaves (schemas hold, `sourceIds` is rejected, retrieval never mutates), but nothing measures whether a JD-fit report cites the right evidence, finds the requirements a human would, or quietly presents an unsupported match. This change adds a repeatable quality-evaluation harness for JD-fit and approved-evidence retrieval without changing ingestion or JD-fit product behavior.

## What Changes

- Add a versioned RAG quality evaluation capability with synthetic fixtures: authored experience text, job descriptions, expected requirements, expected evidence passages, expected gaps, distractor passages, and thresholds.
- Add a deterministic offline mode that drives the accepted JD-fit pipeline with scripted model output and scripted search, suitable for CI without network, Gemini, or Supabase access.
- Add a live mode that evaluates real JD-fit (real Gemini, real approved search) against a seeded synthetic corpus in the remote test project, so retrieval recall and distractor precision are measured against known ground truth rather than against mocks or unknown data.
- Add explicit, separately flagged corpus commands (`seed`, `teardown`, `reset`) that create and remove synthetic experience sources through the accepted ingestion workflow (upload, extract, parse, approve, index, delete). These commands are guarded by an allowed-project check and are never run by the deterministic command or by the evaluation runner itself.
- Anchor ground truth on revision identity (`source_id`, `revision_id`, `approved_content_hash`) plus logical IDs and retained source spans, because sibling revisions of one source share logical IDs and source blocks. Physical vector row IDs remain invalid anchors.
- Replace the earlier selected-source evaluation with a contract check: the accepted JD-fit request rejects any source selection, and retrieval must be called without one. Source filtering itself is already covered by ingestion tests.
- Add quality reports with per-metric pass/fail thresholds for requirement recall, unsupported requirements, retrieval recall, distractor precision, ingestion coverage, citation validity, unsupported positive claims, gap visibility, active-vs-latest revision behavior, and upstream contract checks.
- Record provenance from two sources: JD-fit diagnostics (model, prompt, validation versions) and the retained revision export (parser, prompt, model, chunking, embedding versions) for each cited revision.

Out of scope:

- Implementing or changing structured ingestion, approved search, JD-fit generation, prompt behavior, or UI behavior.
- Numeric candidate fit scoring, ranking applicants, resume rewriting, cover-letter generation, interview coaching, or production analytics.
- Database migrations, migration-history repair, or any schema change.
- Mutating experience data outside the explicitly flagged corpus commands, or running those commands against a project that is not the allowed test project.
- Treating ingestion correctness checks alone as RAG quality evaluation.

## Capabilities

### New Capabilities

- `rag-quality-evals`: Defines repeatable quality evaluations for approved-evidence retrieval and JD-fit reports using versioned synthetic fixtures, revision-anchored source-span ground truth, a deterministic offline mode, a live mode over a seeded synthetic corpus, and thresholded quality reports.

### Modified Capabilities

- None. `project-evidence-index`, `structured-project-ingestion`, and `jd-fit-evaluation` are dependencies whose accepted contracts are consumed but not modified by this change.

## Impact

- Test/eval harness: new fixture schema, synthetic fixtures, runner, adapters, metrics, report schema, corpus lifecycle commands, and an npm script for deterministic execution.
- JD-fit integration: consumes `evaluateJobDescription` and its injectable `client`, `search`, and `now` seams, the accepted response and citation shapes, and diagnostics, without changing them.
- Structured-ingestion integration: the corpus commands call the accepted ingestion service functions (upload, extract, parse, approve, index, create-draft-from-approved, delete) and the revision export; the runner reads approved search and the export only.
- Remote test project: `seed` writes synthetic experience sources to the allowed Supabase project and they stay resident between live runs; `teardown` or `reset` removes them only when the operator chooses. Existing experience data in that project is test data and may be cleared by `reset`.
- Documentation: fixture authoring, ground-truth anchoring, mode semantics, corpus lifecycle, thresholds, and report interpretation.
- Developer workflow: deterministic eval runs in CI with no secrets; live mode is opt-in and spends Gemini calls.
