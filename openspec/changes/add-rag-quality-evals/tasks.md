# Tasks

## 1. Preconditions and Eval Scaffolding

- [ ] 1.1 Confirm `add-structured-project-ingestion` and `add-jd-fit-evaluation` are accepted and archived/synced, or confirm equivalent accepted retained-export, approved-search, and JD-fit contracts; verify accepted contracts include retained source spans, selected-source semantics, JD-fit fit labels, citations, and diagnostics before editing application code.
- [ ] 1.2 Choose the eval module and fixture locations and create the scaffold; verify expected files are present and no production route, ingestion route, database migration, or Storage configuration is changed.
- [ ] 1.3 Add a deterministic eval test command or extend the existing scoped TypeScript test setup to include eval modules and JD-fit contracts; verify the command compiles and runs a placeholder eval test without Gemini or Supabase network access.

## 2. Fixture Contracts and Synthetic Fixtures

- [ ] 2.1 Implement runtime schemas for fixture files, expected requirements, expected evidence anchors, expected gaps, thresholds, selected-source modes, and retained-export references; verify valid fixture examples parse and malformed schema versions, duplicate IDs, missing thresholds, and invalid selected-source modes fail.
- [ ] 2.2 Implement source-span ground-truth validation against retained export payloads; verify logical IDs and source spans resolve while physical vector row IDs, generated summaries, parent headers, and embedding text anchors are rejected.
- [ ] 2.3 Add initial synthetic fixtures covering strong match, partial match, missing evidence, prompt-injection JD text, selected-source omitted/empty/ineligible, and active-R1/latest-R2-not-indexed behavior; verify each fixture passes schema validation and states expected failures explicitly.
- [ ] 2.4 Document fixture authoring, redaction rules, schema versions, source-span anchors, and threshold conventions; verify documented examples pass the fixture validator.

## 3. Deterministic Runner and Adapters

- [ ] 3.1 Implement deterministic adapters for requirement extraction, approved-search retrieval, report generation, clock/version inputs, and mutation guards; verify deterministic runs use fixture data and fail if a live model, remote write, Storage operation, or mutable external dependency is requested.
- [ ] 3.2 Implement the eval runner over injected adapters with per-fixture execution and stable ordering; verify identical fixtures and versions produce identical report objects across repeated runs.
- [ ] 3.3 Add mutation-spy tests around ingestion, JD-fit, generic document, database, and Storage mutation seams; verify eval execution fails if it attempts approve, index, retry, publish, delete, upload, or draft mutation paths.
- [ ] 3.4 Add deterministic runner documentation and command examples; verify the documented deterministic command runs without API keys or Supabase environment variables.

## 4. Metrics and Quality Reports

- [ ] 4.1 Implement requirement extraction metrics for expected requirement recall and unsupported invented requirements; verify fixture cases produce passing and failing findings with actionable messages.
- [ ] 4.2 Implement retrieval metrics for expected source-span recall, selected-source correctness, active-vs-latest behavior, and no-evidence gaps; verify synthetic fixtures identify missed evidence, widened ineligible selection, and wrong latest-approved evidence usage.
- [ ] 4.3 Implement report-quality metrics for citation validity, unsupported positive claims, hidden gaps, fit-label correctness, and numeric-score contract failures; verify reports fail when positive claims lack retained-source citations or expose numeric fit scores.
- [ ] 4.4 Implement machine-readable report schema and compact Markdown rendering; verify reports include fixture versions, runner versions, upstream contract versions, JD-fit diagnostics, aggregate metrics, thresholds, live-smoke marker, and pass/fail status.
- [ ] 4.5 Document report interpretation and threshold policy; verify documented failing examples map to the correct metric categories.

## 5. Optional Live-Model Smoke

- [ ] 5.1 Implement explicit opt-in live-smoke gating through a flag or environment variable; verify normal deterministic runs do not call live model providers and live-smoke runs are marked non-deterministic.
- [ ] 5.2 Wire live-smoke adapters only to accepted read-only JD-fit and retrieval surfaces; verify live-smoke tests mock provider calls and still fail if mutation or Storage operations are attempted.
- [ ] 5.3 Document live-smoke prerequisites, non-deterministic interpretation, provenance fields, and exclusion from CI pass/fail; verify the docs state that live smoke is optional and not a substitute for deterministic evals.

## 6. Integration Verification

- [ ] 6.1 Add an end-to-end deterministic eval suite using the synthetic fixtures; verify it covers requirement extraction, retrieval recall, citation validity, unsupported positive claims, gap visibility, selected-source behavior, active-vs-latest behavior, and generic-search separation.
- [ ] 6.2 Run the eval test command, JD-fit tests, `npm run test:experience`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`; verify all pass and record any environment limitations in implementation notes.
- [ ] 6.3 Run `openspec validate add-rag-quality-evals --strict`; verify the change passes strict validation after implementation.
- [ ] 6.4 Run browser acceptance verification if this implementation changes any user-facing UI: start the app with `npm run dev`, open the local URL in a real browser or browser automation session, walk through the affected workflow end to end using actual clicks, typing, and uploads where applicable, and verify loading, empty, error, and success states render correctly. Record the URL, steps performed, observed results, screenshots if useful, and any limitations in the implementation notes; if the change remains eval-only with no browser surface, record that browser verification was not applicable and why.

## Workflow follow-up

- Apply this change only after structured ingestion and JD-fit accepted contracts are available.
- Archive/sync `add-rag-quality-evals` after deterministic eval implementation acceptance is complete.
- Keep future benchmark expansion, real-world redacted fixture curation, and prompt optimization as separate changes unless explicitly added later.
