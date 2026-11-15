# Structured Experience Contracts

This module defines the runtime contract for source-grounded experience ingestion. Experience upload is the application's only document intake.

## Schema

Canonical revisions use `schema_version: "1"` and contain:

- `source`: durable source identity, original file metadata, and byte hash.
- `extraction`: immutable extraction snapshot identity, text hash, parser version, and normalization version.
- `revision`: revision identity, status, draft version, approved content hash, and model/prompt provenance.
- `experiences`: project or general-experience entries with source-backed fields and evidence.
- `review_acknowledgements`: explicit reviewer acknowledgement for warnings and unassigned source blocks.

The documented canonical fixture lives in [fixtures.ts](./fixtures.ts) as `documentedCanonicalProjectFixture`. The scoped contract tests parse it through `CanonicalExperienceRevisionSchema` and validate its spans against `documentedExtractionSnapshotFixture`.

## Source Spans

Source spans are `{ block_id, start, end }` references into the retained normalized source block text. Offsets are zero-based UTF-16 code units, and `end` is exclusive. A span is valid only when the block belongs to the same extraction snapshot, the bounds are nonempty, and the referenced text can be reconstructed exactly from the retained block.

LLM quote proposals are resolved by exact unique quote matching within the declared block. Repeated, missing, cross-source, cross-snapshot, or out-of-range references fail validation. The resolver does not perform fuzzy substitution or invent file coordinates.

## Source-Backed Fields

Factual fields use `{ value, source_refs }`. Populated scalar values and nonempty collections require at least one source reference. Unknown scalar facts are represented as `null`; unknown collections are empty arrays. Unsupported user-added claims remain invalid until they point to retained source spans or come from a revised source upload.

## Evidence Values

Experiences are typed as `project` or `general-experience`. Evidence item kinds are `background`, `responsibility`, `contribution`, `challenge`, `decision`, and `outcome`.

Attribution is `individual`, `team`, or `unspecified`. Activity status is `completed`, `ongoing`, `planned`, or `unspecified`. These values must be supported by the item's source references; validation enforces structure and span ownership, while human review remains responsible for semantic accuracy.

## Structured Generation

Structured parsing uses [structuredGeneration.ts](./structuredGeneration.ts), a dedicated helper rather than the shared embedding module. It uses `@google/genai` with JSON response MIME, the structured response schema, low temperature, disabled automatic continuation, and separate provenance/configuration defaults:

| Setting | Default |
| --- | --- |
| Model | `EXPERIENCE_STRUCTURED_MODEL`, else `GEMINI_GENERATION_MODEL`, else `gemini-flash-lite-latest` |
| Prompt version | `experience-structured-extraction-v2` |
| Request timeout | `EXPERIENCE_STRUCTURED_TIMEOUT_MS`, default 120 seconds |
| Max output tokens | `EXPERIENCE_STRUCTURED_MAX_OUTPUT_TOKENS`, default 16,384 |
| Response MIME | `application/json` |

Source blocks are passed to the model as JSON-delimited data. Source text can contain markdown, XML-looking tags, JSON, or prompt-like instructions; the prompt treats `source_blocks[].text` as inert data and asks for exact quotes copied from retained blocks. Named projects should become separate `project` experiences; role responsibilities without a named project should become `general-experience`. Unknown scalar facts stay `null`, unknown collections stay empty arrays, team outcomes remain team-attributed, planned work remains planned, and qualified metrics such as "about 30%" remain qualified.

The prompt requests at most 16 experiences and 80 evidence items in total, and the local proposal validator enforces both limits before building a draft. The provider response schema intentionally omits the nested `maxItems` constraints: live verification on 2026-11-11 reproduced HTTP 400 `INVALID_ARGUMENT` with those constraints and succeeded after removing only those two fields. JSON structure, required fields, enums, and source-quote requirements remain enforced; oversized output is rejected, never silently truncated.

The compatibility fix was verified with five new schema/boundary cases (128 tests passing overall), lint, TypeScript, and a live synthetic two-project parse using `gemini-flash-lite-latest`. The live parse completed with `STOP`, produced separate Atlas and Beacon projects, and passed local source-quote validation without repair. No user document was read or submitted by that check, and no database or Storage records were changed. This is provider integration evidence, not full browser-to-database workflow acceptance; the earlier retry-policy report remains unchanged.

The model proposes `{ block_id, quote }` references. Application validation resolves those quotes into canonical `{ block_id, start, end }` spans only when the quote is an exact unique occurrence in the declared retained block. It rejects cross-source references, cross-snapshot references, unknown blocks, repeated quotes, nonmatching quotes, unsupported enum values, malformed JSON, blocked responses, truncated output, empty output, and exhausted repair. Validation proves only structure, ownership, span bounds, and allowed values; it does not prove semantic truth. Human review must still compare the draft against source passages before approval.

Repair is bounded to one attempt and shares the overall parsing deadline. A completed malformed/invalid response can be repaired once with the previous response and validation error supplied as diagnostic data. Blocked, safety-stopped, token-limited, incomplete, or deadline-expired responses are not silently retried into a draft. A failed parse records a parsing failure and must not alter the prior active indexed revision.

Draft persistence stores:

- the canonical draft revision,
- structured-generation and validation checkpoints,
- model and prompt versions,
- extraction warnings,
- omitted-block coverage from retained source spans.

Explicit reparse creates a new draft revision identity. Approval and indexing are separate later actions; parsing alone must not prepare embeddings, publish parent/child evidence, or claim indexed success.

## Revision And Export Contracts

Revision statuses are `draft`, `approved`, `indexing`, `indexed`, and `failed`; source workflow statuses also include upload, extraction, parsing, deletion, and cleanup states. Approval freezes the canonical revision content hash. Later edits create a new draft instead of mutating an approved revision.

`StructuredExperienceExportSchema` bundles the canonical revision, retained source blocks, content hash, export timestamp, and parser/model/prompt/chunking/embedding configuration versions. Downstream JD-fit and evaluation consumers should resolve citations through logical IDs and retained source spans, not through physical vector row IDs.

## Approved Search, Export, And Deletion Contracts

Downstream JD-fit and evaluation code must use the ingestion-owned approved-search helper/RPC, not unfiltered evidence helpers. Approved search admits only nondeleted sources whose `active_revision_id` points to an indexed revision with frozen approved JSON and publication mappings. Optional source selection is applied before ranking; an omitted selection searches all eligible experience sources, an explicit empty selection returns no matches, and unknown, deleted, draft-only, failed, or superseded selections return an eligibility error instead of widening the search.

Search results carry parent expansion plus source, revision, logical experience, logical evidence, logical chunk, and retained source-span lineage. JD-fit can use that lineage to cite retrieved evidence, but it must not treat generated summaries, parent headers, or physical vector UUIDs as citation anchors.

Retained revision export is the stable contract for JD-fit fixtures and later quality evaluations. `GET /api/experiences/[id]/revisions/[revisionId]/export` is available only for retained approved, indexing, or indexed revisions on nondeleted sources. It returns accepted JSON, retained source blocks, canonical content hash, resolved source passages, and configuration versions. Superseded accepted revisions remain exportable before source deletion, so evaluation fixtures can keep logical IDs and exact source passages even after live vector rows are replaced.

Coordinated deletion is intentionally terminal for normal APIs. `DELETE /api/experiences/[id]` tombstones the source, removes mapped parents and cascading children, deletes retained revisions, extractions, and staging rows, then removes the private storage object. If storage cleanup fails, the source remains `cleanup-pending`; approved search, detail, file serving, retained export, parsing, approval, and indexing still treat it as ineligible, and only DELETE retry should use the retained cleanup path.

## Parent And Child Planning

Approved indexing plans are built by [parentPlanning.ts](./parentPlanning.ts) from the retained extraction snapshot and approved canonical revision. Parent text, child citation text, and source-span metadata all come from retained normalized source blocks. The planner must not use generated summaries as quotation text.

Planning defaults are intentionally bounded:

| Bound | Default | Version / env |
| --- | --- | --- |
| Parent context | 12,000 UTF-16 code units | `EXPERIENCE_PARENT_MAX_UTF16_UNITS`, `experience-parent-planning-v1` |
| Child split target | 1,200 UTF-16 code units | `EXPERIENCE_CHILD_TARGET_UTF16_UNITS`, `experience-child-planning-v1` |
| Child hard maximum | 1,600 UTF-16 code units | `EXPERIENCE_CHILD_MAX_UTF16_UNITS`, `experience-child-planning-v1` |
| Children per revision | 300 chunks | `EXPERIENCE_MAX_CHILD_CHUNKS_PER_REVISION`, `experience-index-plan-v1` |
| Embedding context | Source-backed headers plus exact child text | `experience-embedding-context-v1` |

Parent contexts are assembled from ordered retained source spans referenced by experience context and evidence items. Overlapping ranges within the same source block are deduplicated, each planned parent keeps `source_spans[]` with source offsets and parent-text offsets, and different logical experiences never share a parent. If a parent would exceed its bound, partitioning occurs at source-range boundaries; evidence coverage is validated after partitioning.

Children are built from exact evidence `source_refs`. Noncontiguous references produce separate child chunks. Long retained spans split at paragraph, sentence, punctuation, or whitespace boundaries when possible, with exact adjusted `{ block_id, start, end }` offsets for every part. Repeated evidence pointing to the same parent/block/start/end range is deduplicated into one child whose `evidence_logical_ids[]` lists every supporting evidence item.

`child_text` and `metadata.source_span.text` are citation text only. They must equal `snapshot.blocks[n].text.slice(start, end)`. `embedding_text` is separate: it may prepend supported contextual headers derived from source-backed title, role, technologies, and evidence kind, followed by the exact child text. Generated summaries, unsupported fields, organization, period labels, and other non-header attributes stay out of `embedding_text`. Embeddings use `RETRIEVAL_DOCUMENT`, `GEMINI_EMBEDDING_MODEL`, and 1536 dimensions.

Before embedding preparation, `freezeApprovedExperienceIndexPlan()` validates the approved content hash, parent/child ownership, source-faithful citation text, child count limit, and complete evidence coverage. It returns `expected_parent_count`, `expected_child_count`, `expected_evidence_count`, `preparation_config`, and a deterministic `plan_hash`. The `chunking_version` is `experience-parent-planning-v1+experience-child-planning-v1+experience-embedding-context-v1`; changing any planning or embedding configuration creates a different preparation boundary and must not reuse incompatible staging rows.

## Database And Storage Setup

The original deployment order is listed below for traceability. These migrations already exist on remote project `lwljmmfcvmbnrfstltzj`; do not replay them. The retry-policy follow-up leaves the local database untouched and does not authorize `supabase db push`, schema deployment, or migration-history repair. Any future database work requires separate authorization and explicit remote-target confirmation.

1. `20261028000100_evidence_tables.sql`
2. `20261028000200_evidence_search.sql`
3. `20261028000300_evidence_insert.sql`
4. `20261028000400_experience_registry.sql`
5. `20261029034026_experience_invariants.sql`
6. `20261029034319_experience_source_storage.sql`
7. `20261029035315_experience_execution_locks.sql`
8. `20261029063939_approve_experience_revision.sql`
9. `20261029064416_create_draft_from_approved.sql`
10. `20261029070512_publish_experience_revision.sql`
11. `20261029071906_approved_experience_search.sql`
12. `20261029082531_delete_experience_source.sql`
13. `20261029100522_experience_index_execution_fencing.sql`

The experience migrations add registry, snapshot, revision, publication-mapping, staging, private storage, and execution-lease state. They do not change the existing foundation RPC signatures. Pre-existing objects outside these migrations are listed in the root README's note on orphaned objects.

The private original-file bucket is `experience-sources` with `public = false`. Server helpers reserve sources by original byte SHA-256, upload with `upsert: false`, then reconcile `storage_uploaded_at` only after storage confirms the object was written or already exists. The helper returns the private bucket/path and never returns a permanent public URL.

All new registry tables have RLS enabled and no browser-role grants. The storage and execution RPCs revoke `PUBLIC`, `anon`, and `authenticated`, and grant only `service_role`. API routes that call them must run inside the trusted private/personal-tool boundary and must not expose service-role credentials to the browser.

## Execution Leases

Long-running stages acquire a source execution token with `acquire_experience_source_execution(source_id, stage, lease_seconds)`. Supported stages are `extracting`, `parsing`, and `indexing`; leases are finite and currently bounded to 1-3600 seconds. A competing request conflicts while an unexpired token exists. A later request can acquire a new token only after expiry.

Extraction/parsing completion uses `complete_experience_source_execution(...)` and succeeds only when the supplied token, stage, and unexpired lease still match the source row. Indexing checkpoint/failure completion additionally compares candidate, active, and draft pointers, indexing status, expiry, and the nondeleted state in one conditional update. Its `gt.now` timestamp filter uses PostgreSQL transaction time, not the application clock. If approval, deletion, or another execution changes these values, cleanup leaves the newer state untouched and the original failure remains visible. Publication consumes its lease inside its own RPC and needs no later completion write. Draft edits use `update_experience_revision_draft(revision_id, expected_draft_version, draft_json)`, which increments `draft_version` and rejects stale saves.

## Indexing Checkpoints And Publication

Indexing is restartable but publication is all-or-nothing. Each eligible `POST /api/experiences/[id]/index` call freezes the approved parent/child plan and acquires an `indexing` execution lease. New publication prepares at most three embeddings within a default 75-second preparation deadline and writes compatible rows through `stage_experience_embeddings(source_id, revision_id, execution_token, rows)`. Configure these bounds with `EXPERIENCE_EMBEDDING_PREPARATION_BATCH_SIZE` (capped at three) and `EXPERIENCE_EMBEDDING_PREPARATION_TIMEOUT_MS`. This RPC locks the source and revision and rejects expired/replaced tokens, deleted sources, stale candidates, and incompatible configurations before writing. Staging rows are reusable only when the revision ID, plan hash, approved content hash, chunking version, embedding model, task type, and 1536-dimensional embedding configuration all match the frozen plan.

When staging is incomplete, the endpoint completes the lease with source status `indexing` and returns progress plus `next_action: "index"`; it does not update `active_revision_id` or remove prior live parents. A retry after interruption recomputes the frozen plan, restores compatible checkpoints, and prepares only missing chunks. Failed preparation records a recoverable `indexing` failure and leaves prior active evidence unchanged.

When all expected staging rows are prepared, `publish_experience_revision(...)` locks the source first and then the target revision. The RPC rejects deleted sources, stale approved candidates, altered approved content hashes, mismatched staging counts/configuration, missing/invalid child payloads, and attempts by older approved revisions to replace a newer candidate. It calls the existing `insert_project_evidence` RPC once per prepared parent inside the same transaction, writes `experience_revision_parents`, verifies the expected parent/child counts, deletes the previous active revision's mapped parents and cascading children, updates `active_revision_id`, and clears staging. Any raised error rolls back new parents, children, mappings, source updates, and staging cleanup, so the previous active revision remains visible.

Publication retries are idempotent only for the current latest-approved active revision and only when the stored mappings still match the requested plan, hash, configuration, and expected counts. The API acquires a fresh lease and calls the publication RPC even for this retry; it skips embedding preparation and does not require cleared staging. A valid retry returns `already_published: true` without inserting duplicate parents or reactivating superseded revisions. The validated `publication` response includes `status`, `already_published`, `revision_id`, `active_revision_id`, `parent_count`, `child_count`, and `plan_hash`; completed progress has zero remaining/new chunks and `next_action: null`. Missing or invalid RPC data is never fabricated into success.

An older revision is rejected after either newer approval or newer publication, even if it previously published. Retained approval history remains exportable but does not authorize republication. No historical publication receipts are introduced. The previous active index remains searchable until atomic replacement succeeds.

Publication requires `p_execution_token` as its final RPC argument. Missing, expired, or replaced tokens are rejected under the source-then-revision lock before publication. A successful publication or direct idempotent RPC retry consumes the lease atomically; the application must not issue a separate completion write afterward. The old tokenless publication overload was removed by the already-deployed fencing migration.

## Experience API Contract

`POST`, `PATCH`, and other mutation routes reject cross-origin browser requests before service-role work. Private source-file reads also enforce the trusted read boundary and return `Cache-Control: private, no-store`; they do not create permanent public storage URLs.

| Route | Payload | Success | Notes |
| --- | --- | --- | --- |
| `POST /api/experiences` | `multipart/form-data` with `file` | `201`, `{ source, upload_state, next_action }` | Creates or reconciles a private source. Does not create evidence chunks until indexing. |
| `GET /api/experiences` | none | `{ sources }` | Lists durable workflow state, available actions and approved version numbers. |
| `GET /api/experiences/[id]` | none | `{ source, latest_extraction, latest_revision, revisions, approved_versions }` | Returns retained status for review/resume. `revisions` holds the five most recent rows; `approved_versions` lists every approved revision. |
| `POST /api/experiences/[id]/extract` | none | `{ status: "extracted", extraction, next_action: "parse" }` | Requires an execution lease and retained private source. |
| `POST /api/experiences/[id]/parse` | none | `{ status: "draft", revision_id, draft_version, omitted_block_coverage, next_action: "review" }` | Creates a distinct draft revision; does not approve or index. |
| `PATCH /api/experiences/[id]/draft` | `{ "revision_id": "...", "expected_draft_version": 1, "draft": { ...canonicalRevision } }` | `{ revision_id, draft_version, omitted_block_coverage, next_action: "review" }` | Validates source-backed fields and increments the persisted draft version. |
| `POST /api/experiences/[id]/approve` | `{ "revision_id": "...", "expected_draft_version": 2 }` | `{ status: "approved", approved_content_hash, next_action: "index" }` | Freezes approved JSON/hash. Approval alone does not publish evidence. |
| `POST /api/experiences/[id]/index` | `{ "revision_id": "..." }` | `{ status, progress, publication, next_action }` | Targets latest approval only; verified current-active retry also requires a fresh lease. |
| `POST /api/experiences/[id]/draft-from-approved` | `{ "approved_revision_id": "..." }` or `{}` | `{ revision_id, cloned_from_revision_id, next_action: "review" }` | Creates a separate draft; accepted/indexed revisions remain unchanged. |
| `GET /api/experiences/[id]/revisions/[revisionId]/export` | none | `StructuredExperienceExportSchema` | Trusted export of approved/indexing/indexed retained JSON, source blocks, content hash, and resolved source refs. |
| `GET /api/experiences/[id]/file` | none | original bytes with MIME and `Content-Disposition` | Serves the private original through the server boundary only. |
| `DELETE /api/experiences/[id]` | none | `{ status: "deleted" }` or `{ status: "cleanup-pending", next_action: "retry-delete" }` | Tombstones the source, removes mapped database evidence/history transactionally, then removes the private storage object; storage cleanup failures remain retryable. |

### Approved Version Numbers

Every approved revision of a source has a display-only version number. Approved revisions are those with a non-null `approved_at`. They are ordered by `approved_at`, then `id`, and numbered from 1 (`numberApprovedVersions()` in `versionNumbers.ts`). Approval timestamps are immutable, so a revision keeps its number across reads. Drafts, re-parsed drafts and revisions that were never approved have no number, and they leave no gap in the numbering. Numbers are computed on each read; there is no column or migration.

- Each source summary, in both the list and detail, has `active_version_number` and `latest_approved_version_number`. Each is the number of `active_revision_id` or `latest_approved_revision_id`, or `null` when there is no such revision. The list fills them with one revision read across all listed sources.
- The detail has `approved_versions: [{ revision_id, version_number, approved_at }]`, which covers every approved revision even when it is older than the five rows in `revisions`.
- Mutation responses do not include these fields; re-read the detail after a mutation.
- Every action still takes revision IDs. A version number is never accepted as an identifier.

State transitions are explicit:

```text
uploaded --extract--> extracted --parse--> draft --approve--> approved
approved --draft-from-approved--> draft
approved/indexing/indexed --export/file--> unchanged
```

Later indexing tasks extend `approved -> indexing -> indexed`; approval must not report indexed success. Draft save keeps the source reviewable and does not mutate active indexed evidence. Creating a draft from an approved or indexed revision updates only the latest draft pointer and source review state; it keeps `latest_approved_revision_id` and `active_revision_id` intact. Deletion moves the source to `deleted` or `cleanup-pending`; both states are ineligible for approved search and normal detail/file APIs.

Recoverable API errors use stable codes. Validation failures use `draft-validation-failed` with `details.field_errors`. Version or stale-candidate conflicts use HTTP `409` codes such as `draft-version-conflict`, `approval-version-conflict`, `approval-candidate-stale`, or `draft-create-conflict`. Missing retained resources use `source-not-found`, `revision-not-found`, `revision-export-unavailable`, or `source-file-unavailable`. Storage cleanup retry state uses `cleanup-pending` plus `source-storage-delete-failed`. Browser trust-boundary failures use `cross-origin-rejected`.

Both early and publication-time outdated indexing requests return HTTP `409`, `index-candidate-stale`, and `details.recoverable_action: "refresh-source"`. Other execution/publication conflicts keep their own classification; SQLSTATE `40001` alone does not mean the candidate is stale. An unconfirmed publication response returns `index-publication-response-invalid` rather than claiming success.

Experience upload, review, approval, retained export, and file serving must call only `/api/experiences...` routes.

## Browser Workflow And Correction Policy

Use a small synthetic two-project file for browser workflow checks, for example one DOCX/PDF source with paragraphs for `Project Atlas` and `Project Beacon`, plus one unassigned note such as contact details. The expected browser path is:

1. Open `/experience` and use the inline "Upload experience file" drop zone (or its browse button). It uploads through `POST /api/experiences`. A new upload opens `/experience/[id]` and runs Extract then Parse once, using `POST /api/experiences/[id]/extract` and, only after the refreshed state is `extracted`, `POST /api/experiences/[id]/parse`. A byte-identical re-upload opens the existing file as it is. Reopening a file left in `uploaded` or `extracted` shows "Continue processing" and sends nothing until it is clicked.
2. The file page reads `GET /api/experiences/[id]` and shows one six-stage header (Upload, Extract, Parse, Review, Approve, Index) with a single primary action. Every other action sits in the "···" overflow menu: "Download original" (`GET /api/experiences/[id]/file`), "Inspect accepted JSON" (the retained export route), "Re-parse into a new draft", "Edit · starts draft for version N+1" and "Delete". Approved revisions are named "Version N" from `approved_versions`; revision IDs are never shown.
3. Choose "Start review". Review each project in the side rail beside the source document. Edit only supported fields, evidence kind, attribution and activity status. Attach a source span by selecting text inside one block of the document and choosing "Add span" for an evidence item (or "Attach selection" from the keyboard). There is no manual block-ID or offset entry. Remove incorrect evidence rather than saving unsupported claims.
4. The "Before you can approve" checklist combines the extraction-warning and unassigned-block acknowledgements, evidence items without a span, the no-evidence condition and validation errors. "Save draft" uses `PATCH /api/experiences/[id]/draft` with the current draft version; validation errors stay visible and do not approve or index the draft.
5. "Save & approve" (or "Approve" when nothing is unsaved) saves first, stops on any save error, then approves with the draft version the save returned through `POST /api/experiences/[id]/approve`. The page shows "Approved version N · ready for indexing" and sends no index request.
6. "Index now" is the only way to start indexing. One click repeats `POST /api/experiences/[id]/index` for the same revision while the response asks for another batch, showing "Indexing · P of T chunks prepared", and stops on `indexed`, an error, a 409 or two responses with no progress. Leaving the page stops further requests; returning offers "Continue indexing". On HTTP 409 the sequence stops and the page refreshes state once without resending or retargeting. For an outdated candidate it shows "Searchable now", "Latest approved" and "Not indexed" by version number and offers "Index version N" or "Look at version N first". If the refresh fails, index actions stay disabled until "Refresh state" succeeds.
7. An indexed file offers "Try a job description" and "Edit · starts draft for version N+1", which calls `POST /api/experiences/[id]/draft-from-approved`; the searchable version is unchanged until the new draft is approved and indexed. Deleting asks for confirmation inside the page and uses `DELETE /api/experiences/[id]`.

Corrections in v1 are source-grounded only. A field or evidence summary may be edited when its retained source spans still support the claim. To add a fact that is absent from the uploaded source, upload a revised source file and parse a new draft. Do not use review edits, acknowledgements, or approval to turn unsupported notes into accepted evidence.

## Preflight Checks

Before enabling the experience UI or API routes against a development target, run:

```bash
npm run test:experience
npx tsc --noEmit
```

The scoped test suite includes synthetic DOCX extraction, selectable-PDF extraction, validation failures for unsupported or unusable inputs, and snapshot round-trip checks. `runExperienceExtractionPreflight()` in [extractionPreflight.ts](./extractionPreflight.ts) performs a runtime check for:

- Poppler `pdftotext`, preferred for selectable PDFs when installed.
- `pdf2json`, retained as the selectable-PDF fallback when Poppler is absent.
- Mammoth, required for DOCX text extraction.

Supported experience source formats are DOCX and selectable-text PDF. Legacy binary DOC, TXT, OCR, scanned-only PDFs, encrypted documents, user-authored JSON, and HTML rendering of converted documents are out of scope. Users who need legacy DOC ingestion should convert the file to DOCX before upload.

Runtime defaults are intentionally bounded:

| Limit | Default |
| --- | --- |
| Uploaded source file | 10 MiB |
| DOCX expanded ZIP content | 50 MiB |
| Retained normalized extracted text | 60,000 UTF-16 code units |
| Retained source block | 2,000 UTF-16 code units |
Set `PDFTOTEXT_PATH` when Poppler is installed outside the default lookup path. A missing Poppler binary is not fatal because selectable PDFs can use the `pdf2json` fallback.

The existing database smoke assets are listed below; these are SQL files, not shell commands. Any future execution requires separate authorization, confirmation of remote project `lwljmmfcvmbnrfstltzj` through Supabase MCP, and rollback-only synthetic fixtures. Do not run them against the local database.

```bash
supabase/checks/experience_registry.sql
supabase/checks/evidence_index.sql
supabase/checks/experience_index_fencing.sql
```

`experience_registry.sql` rolls back all seeded data and verifies registry tables, RLS/grants, private bucket configuration, source reservation/retry behavior, execution-token conflicts, stale-token rejection, optimistic draft saves, pointer invariants, immutable frozen content, multi-parent publication, active replacement, idempotent retries, stale publication rejection, approved-search lineage, and forced rollback of invalid publication payloads. `evidence_index.sql` verifies the evidence-index foundation remains searchable/deletable and server-only. Run Supabase advisors after schema changes; existing foundation warnings should be reviewed separately from experience-ingestion warnings.

The current `@supabase/supabase-js` version expects Node 22+ for native WebSocket support in direct Node scripts. Use the project runtime's supported Node version, or provide the documented Supabase realtime transport option before running live storage smoke scripts under older Node.

`experience_index_fencing.sql` runs as `service_role` and rolls back its synthetic rows. It verifies rejection of expired/replaced tokens, current-token staging and publication, tokenless-publication rejection, and atomic lease consumption on publication/retry. Remote deployment and verification on 2026-10-29 are recorded in [supabase-remote-alignment.md](../../../supabase-remote-alignment.md), including the pre-existing migration-history mismatch that must be reconciled before CLI push/pull.

## Acceptance Evidence

Original verification for `add-structured-project-ingestion` was recorded on 2026-10-29 against this workspace. The following checks passed:

```bash
npm run test:experience
npx tsc --noEmit
npm run lint
npm run build
openspec validate add-structured-project-ingestion --type change --strict --json
```

`npm run test:experience` passes without LibreOffice because legacy DOC conversion is out of scope for v1. Poppler `pdftotext` is optional; selectable PDFs use the `pdf2json` fallback when Poppler is unavailable.

The scoped suite includes `crossWorkflowAcceptance.test.ts`, which runs a synthetic DOCX and selectable-PDF source through upload, private source retention, extraction, deterministic model-style parsing via `generateValidatedStructuredExperienceDraft()`, review save, approval, repeated indexing until publication, retained export, private original download, and approved-search retrieval. The DOCX fixture verifies two separate project parents, persisted logical experience/evidence/chunk IDs, exact child source spans, and selected-source approved search returning the expected retained child and parent lineage. The PDF fixture verifies the same upload-to-approved-index lifecycle for selectable PDF text.

Synthetic database rows and private storage objects in this acceptance run are in-memory test artifacts and are discarded when the test process exits; no remote Supabase project or local persistent database is mutated. No JD-fit generation or formal RAG quality evaluation is part of this change.

### Retry-policy follow-up (2026-11-11)

The [follow-up verification report](../../../supabase-retry-policy-verification-2026-11-11.md) records separately authorized API/UI fixes, 123 passing database-free tests, four passing browser conflict scenarios, lint/type/build results, and remote rollback assertions. The [original remote report](../../../supabase-remote-verification-2026-11-11.md) remains historical evidence: rejection of superseded retries is intentional under the revised policy, not a newly implemented database fix.

Repository SQL checks are `supabase/checks/experience_retry_policy.sql`, `experience_retry_guards.sql`, and `experience_retry_lifecycle.sql`. Their target-confirmed remote runs ended with `ROLLBACK`; all nine persistent database/Storage metadata fingerprints matched the baseline. No migrations or migration-history entries changed.

Browser regressions live in [retryConflicts.browser.mjs](./retryConflicts.browser.mjs). Run against a loopback Next preview with dummy Supabase/Gemini credentials, using `EXPERIENCE_PREVIEW_URL` (default `http://127.0.0.1:3033`) and `PLAYWRIGHT_MODULE_PATH` when Playwright is not installed locally. The script intercepts all APIs and blocks external requests; it verifies one outdated POST and one conflict refresh, explicit retargeting only after user action, and disabled indexing after refresh failure. These fixtures do not exercise the real server or database. Application cleanup is covered by in-memory lifecycle/expiry tests and an isolated PostgREST serialization check, not a new remote API execution.

### Generic search retirement browser walkthrough (2026-11-14)

Recorded for `retire-generic-rag-search` against the already-running `npm run dev` server at `http://localhost:3000`, which hot-reloaded the change, using Chrome browser automation. The experience list held six synthetic `rag-eval__*` sources from the seeded eval corpus.

- **Home page.** Opened `/`. The heading, the Search and Documents navigation, and the JD-fit job description input rendered directly, with no "Search documents" / "JD fit" mode switch.
- **Documents page.** Opened `/documents`. Only the Experience section rendered, listing six sources, with its Upload Experience button. There is no Generic Documents section.
- **Upload modal.** Opened Upload Experience. It showed the experience variant: "Select an experience file (PDF or DOCX)", "Supported: PDF, DOCX", and the private source-grounded review note. Closed it without uploading.
- **Existing source.** Opened the indexed source `rag-eval__strong-match__lumen-freight-dispatch.docx`. Review acknowledgements, draft fields, and source blocks rendered. Inspect Accepted JSON showed the accepted revision and resolved source references. The Download Original link points to `/api/experiences/[id]/file`, which returned 200 with the DOCX content type.
- **Network.** With request capture on, reloading `/` and `/documents` produced only `GET /api/experiences` (200, twice from the development-mode double effect). No request targeted a removed route, and the console showed no errors.
- **Removed routes.** `GET /api/documents` returned the Next.js 404 page in the browser. `POST /api/search`, `POST /api/upload`, and `DELETE /api/documents?id=x` each returned 404.
- **Limitations.** Download Original was verified by its link target and response status, not by saving the file. No upload, parse, approval, or indexing was performed, because those paths are unchanged and would write to the remote project.

### JD Fit Check redesign browser walkthrough (2026-11-15)

Recorded for `redesign-jd-fit-workspace` against the already-running `npm run dev` server at `http://localhost:3000`, which hot-reloaded the change, using Chrome browser automation against the remote project. The list started with the six seeded `rag-eval__*` sources; none of them was changed. Three throwaway DOCX files were generated with `buildMinimalDocx` and deleted afterwards.

- **Upload and auto-chain.** Uploading `walkthrough-throwaway.docx` from the `/experience` drop zone opened `/experience/[id]`, which sent `/extract`, then `/parse` after the refresh read `extracted`, and showed "Draft for version 1 · ready for review" with "Start review".
- **Review.** Each block's rendered `textContent` equalled `block.text`. Removing b3's span put the item into the "No source span" state. Selecting b3's sentence with the pointer opened the popover with that item first, and "Add span" stored `block-0003:0:97`, which reproduces the whole sentence. One attribution was changed from the keyboard.
- **Save & approve.** After the unassigned-blocks acknowledgement the gate read "Save & approve". One click sent `PATCH /draft` then `POST /approve` and no `/index`; the page showed "Approved version 1 · ready for indexing". The attribution edit persisted in the export.
- **Indexing.** One "Index now" click on a second file with two projects and eight evidence items sent three successive `/index` requests and ended at "Indexed · version 1" with "Try a job description". The top-bar pill went from 6 to 8 files.
- **Fit Check.** Two evaluations each sent exactly one `POST /api/jd-fit`. Captions read, for example, "walkthrough-throwaway.docx · Walkthrough Throwaway Project · contribution". "Open in source" landed on the highlighted b3 sentence. A hand-built link to a missing block showed the different-version notice instead.
- **Edit an indexed file.** "Edit · starts draft for version 2" opened Review for the new draft while the list row read "Indexed · draft for version 2 in review" and the source kept `active_version_number: 1`.
- **Reload, polling, delete, redirects.** An `uploaded` source reopened with "Continue processing" and only GET requests. A page opened during a server-side `parsing` run polled until the draft appeared, then stopped. In-page "Delete" removed a throwaway and returned to the list. `/documents` and `/experiences/abc` returned 308 to `/experience` and `/experience/abc`.
- **Narrow viewport.** In a 390 px frame, the document pane came first and the rail followed it, with `scrollWidth` equal to the viewport width.
- **Contrast.** Dark-theme screens were first checked by applying the dark `:root` tokens inline, then again with macOS Appearance set to Dark (`prefers-color-scheme: dark` matched, no inline overrides) on a production preview: the list, the review workspace with highlights, unassigned blocks, an amber missing-span card, the locked approve button and the red delete confirmation, and a Fit Check report with Strong, Partial and Missing labels, gaps and diagnostics were all legible. WCAG ratios were computed for every token pair. These values were raised in `globals.css`: dark `--ink-muted` `#657285` → `#7d8a9c` (3.57 → 4.97:1 on card), light `--sand-label` `#8d6b30` → `#86662d` (4.48 → 4.85:1), and light `--red` `#dc2626` → `#c81e1e` (red text on red wash 3.95 → 4.7:1). The JD placeholder now uses `ink-muted`.
- **Limitations.** `retryConflicts.browser.mjs` was updated for the new page but not run, because Playwright is not installed in this environment. The 409 conflict panel was therefore verified by contract tests only. The Fit Check empty state was verified by tests only, because indexed sources existed throughout. `npm run build` uses `--webpack`, which does not run the Turbopack-only Tailwind rule in `next.config.ts`, so that build ships CSS without utilities; the OS dark-mode check used `npx next build` (Turbopack) instead. This predates the redesign.

## Synthetic Parsing Smoke

For a non-network verification, run:

```bash
npm run test:experience
npx tsc --noEmit
```

The structured-generation tests feed completed model-style JSON responses through `generateValidatedStructuredExperienceDraft()`, verify exact source-linked draft spans, verify one-attempt repair/error behavior, and verify draft persistence does not touch active indexed evidence.

For an opt-in live Gemini smoke, set `GEMINI_API_KEY` or `GOOGLE_API_KEY` and keep the source text tiny:

1. Build a synthetic extraction snapshot with `buildExperienceExtractionSnapshot()` containing one named project, one general responsibility, and one intentionally unassigned block.
2. Call `generateValidatedStructuredExperienceDraft()` with the snapshot, a fresh draft revision UUID, and a short timeout.
3. Confirm the returned revision has `status: "draft"`, populated fields/evidence have source spans, and `buildExperienceDraftJson()` includes warnings plus omitted-block coverage.
4. Stop there unless intentionally testing later tasks. Do not call embedding helpers, index endpoints, publication RPCs, or approval during this parsing smoke.

This smoke produces a reviewable source-linked draft only. It is not an approval, embedding preparation, publication, JD-fit evaluation, or formal retrieval-quality benchmark.

## Rollback Guidance

Rollback is non-destructive by default:

1. Disable experience UI/API entry points first.
2. Stop new extraction/parsing/indexing requests and allow active leases to expire.
3. Preserve `experience_sources`, retained source files, extraction snapshots, and approved revisions unless the user explicitly decides they are no longer needed.
4. Remove live indexed experience publications through the coordinated deletion lifecycle once that lifecycle exists; do not delete foundation evidence rows outside that lifecycle.
5. Drop experience-only functions, tables, or the private bucket only after confirming accepted revision history and source files are intentionally discarded.

The existing `supabase/rollback/evidence_index.sql` is destructive for foundation evidence and is not a routine rollback for this workflow.
