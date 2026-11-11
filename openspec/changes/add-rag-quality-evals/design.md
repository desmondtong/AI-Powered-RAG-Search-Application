# Design

## Context

See `proposal.md` for motivation and `specs/rag-quality-evals/spec.md` for the behavior contract.

Observed implementation and planning state:

- The durable spec inventory currently contains `project-evidence-index`.
- `add-structured-project-ingestion` is active and mostly implemented. It documents retained revision exports, approved-search eligibility, logical IDs, source-span lineage, and no JD-fit/eval behavior.
- `app/lib/experience/README.md` states that JD-fit and evaluation consumers should resolve citations through logical IDs and retained source spans, not physical vector row IDs.
- `add-jd-fit-evaluation` is planned but not implemented. There is no `app/lib/jdFit` or `/api/jd-fit` yet. Its accepted output is expected to include categorical fit labels, citations, and diagnostics.
- The existing scoped test setup compiles `app/lib/experience/**/*.ts` through `tsconfig.experience-tests.json`; no eval-specific test command exists.
- This change should be applied after structured ingestion and JD-fit are accepted and archived/synced, or after equivalent contracts are accepted.

## Goals / Non-Goals

**Goals:**

- Add a deterministic quality harness for JD-fit and approved-evidence retrieval.
- Make fixture ground truth stable across vector row replacement by anchoring it to retained exports, logical IDs, and source spans.
- Produce reports that distinguish retrieval misses, citation failures, unsupported positive claims, hidden gaps, and contract regressions.
- Keep deterministic evaluation suitable for local/CI execution without network or production-state mutation.
- Allow optional live-model smoke runs with explicit provenance and non-deterministic labeling.

**Non-Goals:**

- No changes to ingestion, approved-search RPCs, JD-fit prompts, JD-fit endpoints, or product UI.
- No database migrations, remote Supabase writes, real Storage mutations, or migration-history work.
- No applicant ranking, numeric candidate score, production analytics dashboard, or prompt optimization loop.
- No attempt to make live model output perfectly reproducible.

## Decisions

### Decision 1: Gate implementation on accepted upstream contracts

Start apply by confirming accepted contracts for:

- retained structured experience exports,
- approved-search selected-source and active-revision semantics,
- JD-fit request/response shape,
- JD-fit fit labels, citation format, and diagnostics.

If the active changes have not been archived/synced, use only an explicitly accepted equivalent contract. The eval harness can then depend on stable behavior rather than in-flight artifact text.

Alternative: implement evals directly against current active change files. Rejected because eval fixtures would become stale if JD-fit response fields or accepted ingestion exports change before archive.

### Decision 2: Store fixtures as validated repo-local data

Use repo-local fixtures under a dedicated eval area, for example `app/lib/ragQualityEvals/fixtures` or an adjacent `evals/rag-quality` folder. Each fixture includes:

| Field | Purpose |
| --- | --- |
| `fixture_id`, `schema_version` | Stable fixture identity and migration boundary |
| `jd_text` | JD input used for requirement extraction |
| `experience_exports` | Retained structured experience export payloads or stable fixture references |
| `selected_source_mode` | omitted, empty, explicit eligible, or explicit ineligible |
| `expected_requirements` | Requirement IDs, labels, and must-have/optional markers |
| `expected_evidence` | Requirement-to-source-span/logical evidence anchors |
| `expected_gaps` | Requirements that must remain weak or missing |
| `thresholds` | Per-fixture quality gates |

Keep fixture data synthetic by default. Any real resume, personal document, JD, or internal source must be redacted or kept out of the repo.

Alternative: seed fixtures only in Supabase. Rejected because deterministic evals must run without remote database mutation or network access.

### Decision 3: Separate deterministic adapters from live adapters

Build the runner around injected adapters:

| Adapter | Deterministic mode | Optional live-smoke mode |
| --- | --- | --- |
| Requirement extraction | fixture/mock output or deterministic JD-fit helper seam | real JD-fit model path if explicitly enabled |
| Retrieval | fixture-backed approved-search result set | accepted read-only approved-search/JD-fit path |
| Report generation | fixture/mock output or deterministic report helper seam | real JD-fit report generation |
| Clock/version source | fixed fixture values | actual run values |

The deterministic command must fail if it would require live Gemini, remote writes, Storage operations, or mutable external state. Live smoke is a separate explicit mode and marks its reports as non-deterministic.

Alternative: evaluate only the public `/api/jd-fit` route. Rejected for CI because route-level live model calls make deterministic pass/fail noisy and require environment secrets.

### Decision 4: Evaluate dimensions separately before aggregate pass/fail

Compute per-fixture findings first, then aggregate. Initial metrics:

| Metric | Meaning |
| --- | --- |
| requirement recall | expected JD requirements present |
| unsupported requirement count | material requirements invented from the JD |
| retrieval recall | expected retained source spans retrieved |
| citation validity | report citations resolve to expected retained source spans |
| unsupported positive claims | positive/partial fit claims without evidence |
| gap visibility | expected gaps are reported as weak or missing |
| selected-source correctness | omitted, empty, eligible, and ineligible source semantics hold |
| active-revision correctness | active indexed evidence wins over latest unindexed approval |
| generic regression guard | generic search remains separate from eval/JD-fit flows |

Contract failures such as numeric fit scores, vector-row citation anchors, or production mutation attempts fail the run regardless of aggregate percentages.

Alternative: produce a single overall score. Rejected because the actionable failure type matters more than a blended number.

### Decision 5: Produce report objects and optional files

The runner returns a machine-readable report object and can print JSON to stdout. A helper can also render a compact Markdown summary. If file output is added, write to an ignored local results directory by default so repeated eval runs do not churn committed artifacts.

Report contents:

- run ID and timestamps,
- fixture and schema versions,
- upstream contract versions and JD-fit diagnostics,
- per-fixture findings,
- aggregate metrics,
- thresholds,
- pass/fail status,
- live-smoke marker when applicable.

Alternative: only use node test assertions. Rejected because trend comparison and human review need a durable report shape even when tests fail.

### Decision 6: Keep evals read-only and local-first

No eval path should approve, index, retry, publish, delete, upload, or repair data. Deterministic evals use fixture payloads. Optional live smoke may call accepted read-only surfaces, but it must not mutate production state or require real Storage operations.

Alternative: create live synthetic remote fixtures during eval runs. Rejected for this change because structured-ingestion verification already has rollback-bound remote checks, and RAG quality should stay stable and low-friction.

## Risks / Trade-offs

- [Risk] JD-fit has not been implemented yet. -> [Mitigation] Gate apply on accepted JD-fit contracts and keep tasks explicit about verifying response shape before fixture work.
- [Risk] Synthetic fixtures may not represent real-world JDs. -> [Mitigation] Start with synthetic fixtures for safety, document authoring rules, and allow later redacted fixture additions.
- [Risk] Metrics can become vanity numbers. -> [Mitigation] Keep separate failure categories and treat contract failures as hard failures.
- [Risk] Live smoke results can fluctuate. -> [Mitigation] Keep live smoke opt-in, label reports as non-deterministic, and exclude it from required CI pass/fail.
- [Risk] Fixture anchors may drift when upstream schemas evolve. -> [Mitigation] Version fixture schemas and validate upstream contract versions before running.
- [Risk] Eval code may accidentally call mutation paths. -> [Mitigation] Use adapter boundaries, mutation spies in tests, and explicit deterministic-mode guards.

## Migration Plan

1. Confirm structured-ingestion and JD-fit accepted contracts are present.
2. Add fixture schemas, sample synthetic fixtures, and validation tests.
3. Add deterministic adapters, metrics, report schema, and runner command.
4. Add optional live-smoke mode behind explicit environment/flag gating.
5. Add documentation for fixture authoring, report interpretation, thresholds, and command usage.
6. Run deterministic eval tests, existing experience/JD-fit tests, lint, typecheck, build, and strict OpenSpec validation.

Rollback is code-only: remove the eval fixtures, runner modules, scripts, and docs. No database or storage rollback is expected.
