# Proposal

## Why

Once structured ingestion and JD-fit exist, passing implementation tests will not tell us whether the RAG workflow retrieves the right evidence, cites it correctly, and avoids unsupported fit claims. This change adds a repeatable quality-evaluation harness for JD-fit and approved-evidence retrieval without changing ingestion or JD-fit product behavior.

## What Changes

- Add a versioned RAG quality evaluation capability with curated fixtures for retained experience exports, job descriptions, expected requirements, expected evidence, expected gaps, and expected citations.
- Add deterministic evaluation runners that exercise JD-fit requirement extraction, approved-evidence retrieval, citation validation, and final report claims with mocked or fixture-backed model outputs suitable for CI.
- Add optional live-model smoke evaluation that records model, prompt, retrieval, validation, fixture, and run versions without becoming the required CI gate.
- Evaluate retrieval and reporting against retained source-span/logical IDs from structured ingestion exports and JD-fit diagnostics, not physical vector row IDs or generated summaries.
- Add quality reports with pass/fail thresholds for retrieval recall, citation validity, unsupported positive claims, gap visibility, selected-source behavior, active-vs-latest revision behavior, and generic-search non-regression.
- Gate apply work on `add-structured-project-ingestion` and `add-jd-fit-evaluation` being accepted and archived/synced, or on equivalent accepted retained-export, approved-search, and JD-fit contracts being present.

Out of scope:

- Implementing or changing structured ingestion, approved search, JD-fit generation, prompt behavior, or UI behavior as part of the eval change.
- Numeric candidate fit scoring, ranking applicants, resume rewriting, cover-letter generation, interview coaching, or production analytics.
- Mutating remote Supabase data, uploading/deleting real Storage objects, deploying migrations, or repairing migration history.
- Treating ingestion correctness checks alone as RAG quality evaluation.

## Capabilities

### New Capabilities

- `rag-quality-evals`: Defines repeatable quality evaluations for approved-evidence retrieval and JD-fit reports using versioned fixtures, source-span ground truth, and deterministic quality reports.

### Modified Capabilities

- None. `project-evidence-index`, `structured-project-ingestion`, and `jd-fit-evaluation` are dependencies whose accepted contracts are consumed but not modified by this change.

## Impact

- Test/eval harness: new eval fixtures, runner modules, report schema, and scripts for deterministic local/CI execution.
- JD-fit integration: consumes the accepted JD-fit request/response, diagnostics, fit labels, and citation format without changing them.
- Structured-ingestion integration: consumes retained revision exports, approved-search behavior, logical IDs, and source-span lineage without changing ingestion state.
- Documentation: adds instructions for fixture authoring, expected outputs, thresholds, deterministic CI runs, and optional live-model smoke runs.
- CI/developer workflow: adds an eval command that can run without network or real Supabase mutation; optional live smoke remains explicitly opt-in.
