# Tasks

## 1. Structured contracts and validation

- [x] 1.1 Add the new workflow's runtime validator and a scoped test command without changing generic behavior; verify dependency installation, test discovery, and TypeScript compilation.
- [x] 1.2 Define extraction snapshots, canonical source spans, source-backed factual fields, experience/evidence enums, revision statuses, and downstream export types; verify valid project/general-experience fixtures and invalid enum/missing-field fixtures.
- [x] 1.3 Implement exact unique quote-to-span resolution with UTF-16 offsets and snapshot ownership checks; verify repeated quotes, invalid block IDs, out-of-range spans, Unicode, and nonmatching text are handled without fuzzy citation substitution.
- [x] 1.4 Implement deterministic canonical hashing, persisted logical ID assignment, coverage reporting, and approved-revision immutability checks; verify same-revision retries retain IDs/hashes while independent parses create new revision identity.
- [x] 1.5 Document schema, span semantics, field support, unknown values, attribution/status, and revision-export contracts; verify the documented canonical fixture passes the runtime validator.

## 2. Durable registry and private source storage

- [x] 2.1 Add source, extraction, revision, publication-mapping, and embedding-staging migrations without changing foundation RPC signatures; verify tables, FKs, uniqueness, RLS, service-role grants, and denied anon/authenticated access in a development database.
- [x] 2.2 Enforce source-owned latest-approved/active revision pointers and immutable extraction/approved content; verify cross-source pointers, unpublished active pointers, and mutation of frozen content fail database checks.
- [x] 2.3 Create private experience storage and byte-hash source reservation/reconciliation helpers; verify duplicate/concurrent uploads and response-loss retries resolve one durable source without exposing public URLs.
- [x] 2.4 Add execution-token acquisition, deadline/lease expiry, optimistic draft versions, and conditional completion writes; verify competing requests conflict and an expired request cannot overwrite work completed under a newer token.
- [x] 2.5 Document migration order, private storage/access boundary, execution states, configuration, and non-destructive rollback; verify documented migration/preflight checks on the development target and leave generic data untouched.

## 3. Supported document extraction

- [x] 3.1 Extract reusable PDF/DOCX/TXT utilities from the generic upload route without changing its accepted formats or response contract; verify existing generic PDF/DOCX/TXT extraction and upload regression checks.
- [x] 3.2 Add experience-specific extension/MIME/container, compressed/expanded size, final text-quality, and deadline validation; verify empty, mislabeled, oversized, encrypted/unusable, scanned-only, and garbled-fallback cases fail before LLM parsing.
- [x] 3.3 Add isolated bounded LibreOffice DOC-to-DOCX conversion, safe argument/path handling, converter configuration, and temporary cleanup; verify a real legacy DOC fixture, absent converter, conversion failure/timeout, and cleanup paths.
- [x] 3.4 Persist ordered normalized extraction blocks and snapshot hashes/warnings/available locators; verify extraction round trips, mechanical normalization, bounded block splitting, unchanged citations after reload, and no invented file coordinates.
- [x] 3.5 Document Poppler/LibreOffice installation, converter isolation, supported text-only formats, and extraction limits; run a runtime preflight and real DOCX/DOC/selectable-PDF extraction smoke with synthetic files.

## 4. Source-grounded LLM parsing

- [x] 4.1 Add a dedicated Gemini structured-extraction helper with supported JSON schema, configured token limits, completion-reason handling, separate timeout, and model/prompt provenance; verify mocked SDK requests do not reuse or alter generic answer defaults.
- [x] 4.2 Implement project/general-experience organization with source quotes, null/empty unknowns, evidence kinds, attribution, activity status, and prompt-injection-resistant source delimiting; verify structured fixtures preserve team outcomes, planned work, and qualified metrics.
- [x] 4.3 Validate and resolve completed responses into canonical draft JSON, with at most one repair attempt inside the overall deadline; verify malformed JSON, wrong-source references, ambiguous quotes, blocked/truncated responses, token limits, and repair exhaustion never publish evidence.
- [x] 4.4 Persist draft content, parsing checkpoints, model/prompt versions, warnings, and omitted-block coverage; verify reparse creates a distinct draft and a failed parse leaves prior active evidence unchanged.
- [x] 4.5 Document generation configuration, semantic-validation limits, repair/error behavior, and a live synthetic parsing smoke procedure; verify a real response produces a source-linked reviewable draft without embedding or publication.

## 5. Experience APIs and approval lifecycle

- [x] 5.1 Add upload/list/detail/extract/parse endpoints using the durable registry, private access boundary, safe error codes, and same-origin mutation checks; verify request validation, resume actions, source ownership, duplicate upload reconciliation, and cross-origin rejection.
- [x] 5.2 Add source-grounded draft save with optimistic concurrency and field-level errors; verify stale saves, unsupported claims, invalid source selections, omitted-source acknowledgements, and drafts with no usable evidence.
- [x] 5.3 Add approval that freezes the reviewed hash/version and selects the latest approved candidate under the source lock; verify stale approval rejection, immutable approved JSON, and no evidence publication at approval alone.
- [x] 5.4 Add create-draft-from-approved behavior and trusted retained-revision/source-resolution export; verify editing does not alter active evidence and superseded accepted revisions still resolve their logical citation IDs.
- [x] 5.5 Add private original-file serving without a permanent public URL; verify source identity, response MIME/disposition, trusted boundary enforcement, and missing/deleted file behavior.
- [x] 5.6 Document endpoint payloads, state transitions, version conflicts, and recoverable errors; verify API contract tests match the documented examples and preserve generic endpoints.

## 6. Parent and child planning

- [x] 6.1 Build source-derived parent contexts with span mappings, deduplication, and bounded project-section partitioning; verify separate projects never share a parent and all indexed evidence remains represented after partitioning.
- [x] 6.2 Build exact child source spans with bounded paragraph/sentence splitting and deduplication; verify noncontiguous references remain separate citations, long-span offsets reconstruct exact text, and repeated evidence does not duplicate identical chunks within a parent.
- [x] 6.3 Build supported contextual embedding headers and complete lineage/configuration metadata; verify child citation text excludes headers/summaries, unsupported attributes are excluded, and task type/dimensions remain RETRIEVAL_DOCUMENT/1536.
- [x] 6.4 Freeze/validate the complete approved parent-child plan, expected counts, hashes, and preparation configuration before embedding; verify over-limit plans and any missing approved evidence fail explicitly and retries produce the same logical plan.
- [x] 6.5 Document chunk/parent bounds, context-only headers, span provenance, and configuration versioning; verify documented examples round-trip from canonical JSON into source-faithful parents and children.

## 7. Resumable embeddings and atomic publication

- [x] 7.1 Add bounded embedding preparation and conditional staging writes keyed by approved revision/plan/configuration hashes; verify batch limits, valid 1536-dimensional vectors, progress restoration, and reuse of compatible checkpoints only.
- [x] 7.2 Implement transactional whole-revision publication using staged data and existing per-parent insertion RPC, with source-then-revision locking and count/hash checks; verify a forced invalid child rolls back all new parents/children/mappings.
- [x] 7.3 Add active replacement and idempotent publication responses; verify previous live rows remain during preparation, successful replacement removes old parents/children atomically, and retry after response loss creates no duplicates.
- [x] 7.4 Reject stale tokens, altered approved content, mixed embedding configurations, deleted sources, and older approved candidates; verify an older indexing request cannot replace a newer approval or reactivate a superseded revision.
- [x] 7.5 Add the index endpoint's next-batch/publish behavior and safe progress/error response; verify interrupted/failed embedding preparation resumes from compatible work without reporting indexed status early.
- [x] 7.6 Document indexing checkpoints, restart conditions, publication guarantees, and failure recovery; verify a development-database multi-project insertion/replacement smoke and atomic rollback checks using synthetic data.

## 8. Approved retrieval and deletion boundary

- [x] 8.1 Add an ingestion-owned vector RPC/helper joining active approved publications before cosine ranking/top-K, with validated optional source selection; verify all/selected/empty selection and invalid/ineligible IDs without widening search.
- [x] 8.2 Return parent expansion and logical citation lineage, with active membership rechecked or queried consistently; verify standalone/draft/failed/superseded/deleted evidence is excluded and filtered retrieval finds relevant selected-source chunks.
- [x] 8.3 Add transactional tombstone/database removal plus explicit storage cleanup and retry; verify mapped parents and cascading children disappear, accepted history/staging is removed, cleanup-pending remains ineligible, and late indexing cannot resurrect a deleted source.
- [x] 8.4 Document the approved-search/export contracts for JD-fit/evals and coordinated deletion; verify retained accepted revisions resolve citations before deletion and deleted sources do not resolve through normal retrieval/detail APIs.

## 9. Documents and review UI

- [x] 9.1 Add separate Generic Documents/Experience sections and DOCX/DOC/PDF experience upload controls while retaining generic controls; verify each upload action calls only its intended API and existing previews/deletion still work.
- [x] 9.2 Add source-linked experience review with editable supported fields, evidence kinds/attribution/status, source-span selection, removals, warnings, and unassigned-block acknowledgement; verify invalid edits block approval and saved drafts survive reload.
- [x] 9.3 Add explicit Approve/Index actions, preparation progress, stage-specific retry, approved-edit/new-draft behavior, and source cleanup status; verify approval alone does not display indexed success and a failed replacement keeps the old active revision visible.
- [x] 9.4 Add accepted JSON/source-reference inspection and private original download, with keyboard-accessible controls and readable narrow-screen layout; verify generic content remains unaffected and the Search page still uses its existing generic API.
- [x] 9.5 Document the upload/review/approve/index user flow and source-grounded correction policy; verify the browser workflow follows the documented steps using a synthetic two-project experience file.

## 10. Cross-workflow acceptance

- [ ] 10.1 Run the complete DOCX, real DOC, and selectable-PDF upload-to-approved-index flow using synthetic experience documents; verify source passages, logical IDs, private file access, multi-project parents, exact children, and approved search results agree.
- [x] 10.2 Exercise cross-stage failures/concurrency: invalid parse, stale review/approval, expired execution token, interrupted embeddings, failed publication, overlapping approvals, response loss, replacement, and delete-versus-index; verify no partial active index, stale resurrection, or duplicate publication.
- [ ] 10.3 Run generic upload/search/list/detail/file/deletion regressions and the new automated checks, `npm run lint`, `npx tsc --noEmit`, and production build; verify unchanged generic contracts and no source/credential leakage in browser responses or logs.
- [ ] 10.4 Validate OpenSpec strictly, record acceptance evidence and configured limits in implementation documentation, and clean synthetic database/storage artifacts; verify all tracked tasks reflect actual completion without implementing JD-fit or formal RAG evaluations.

## Workflow follow-up

- Review and archive/sync this change only after implementation acceptance is complete.
- Keep the archived/synced `project-evidence-index` foundation unchanged unless a future change explicitly revises it.
- Propose `add-jd-fit-evaluation` against the approved-search and retained-revision contracts, using the existing Search page for pasted JD input and cited categorical reports.
- Propose `add-rag-quality-evals` with curated ground truth and versioned fixtures; ingestion correctness checks are not a substitute for that later quality benchmark.
