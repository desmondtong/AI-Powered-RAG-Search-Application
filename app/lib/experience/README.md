# Structured Experience Contracts

This module defines the runtime contract for source-grounded experience ingestion. It is intentionally separate from the generic document upload flow so generic PDF, DOCX, TXT upload and search behavior can remain unchanged.

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

Structured parsing uses [structuredGeneration.ts](./structuredGeneration.ts), not the generic `generateAnswer` helper. The dedicated helper uses `@google/genai` with JSON response MIME, the structured response schema, low temperature, disabled automatic continuation, and separate provenance/configuration defaults:

| Setting | Default |
| --- | --- |
| Model | `EXPERIENCE_STRUCTURED_MODEL`, else `GEMINI_GENERATION_MODEL`, else `gemini-flash-lite-latest` |
| Prompt version | `experience-structured-extraction-v1` |
| Request timeout | `EXPERIENCE_STRUCTURED_TIMEOUT_MS`, default 120 seconds |
| Max output tokens | `EXPERIENCE_STRUCTURED_MAX_OUTPUT_TOKENS`, default 16,384 |
| Response MIME | `application/json` |

Source blocks are passed to the model as JSON-delimited data. Source text can contain markdown, XML-looking tags, JSON, or prompt-like instructions; the prompt treats `source_blocks[].text` as inert data and asks for exact quotes copied from retained blocks. Named projects should become separate `project` experiences; role responsibilities without a named project should become `general-experience`. Unknown scalar facts stay `null`, unknown collections stay empty arrays, team outcomes remain team-attributed, planned work remains planned, and qualified metrics such as "about 30%" remain qualified.

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

Apply the additive Supabase migrations in order after the foundation evidence-index migrations:

1. `20261028000100_evidence_tables.sql`
2. `20261028000200_evidence_search.sql`
3. `20261028000300_evidence_insert.sql`
4. `20261028000400_experience_registry.sql`
5. `20261029034026_experience_invariants.sql`
6. `20261029034319_experience_source_storage.sql`
7. `20261029035315_experience_execution_locks.sql`
8. `20261029063939_approve_experience_revision.sql`
9. `20261029064416_create_draft_from_approved.sql`

The experience migrations add registry, snapshot, revision, publication-mapping, staging, private storage, and execution-lease state. They do not change the generic `documents` table, the generic `documents` storage bucket, the generic upload/search routes, or the existing foundation RPC signatures.

The private original-file bucket is `experience-sources` with `public = false`. Server helpers reserve sources by original byte SHA-256, upload with `upsert: false`, then reconcile `storage_uploaded_at` only after storage confirms the object was written or already exists. The helper returns the private bucket/path and never returns a permanent public URL.

All new registry tables have RLS enabled and no browser-role grants. The storage and execution RPCs revoke `PUBLIC`, `anon`, and `authenticated`, and grant only `service_role`. API routes that call them must run inside the trusted private/personal-tool boundary and must not expose service-role credentials to the browser.

## Execution Leases

Long-running stages acquire a source execution token with `acquire_experience_source_execution(source_id, stage, lease_seconds)`. Supported stages are `extracting`, `parsing`, and `indexing`; leases are finite and currently bounded to 1-3600 seconds. A competing request conflicts while an unexpired token exists. A later request can acquire a new token only after expiry.

Stage completion uses `complete_experience_source_execution(...)` and succeeds only when the supplied token, stage, and unexpired lease still match the source row. This prevents an expired request from overwriting work completed under a newer token. Draft edits use `update_experience_revision_draft(revision_id, expected_draft_version, draft_json)`, which increments `draft_version` and rejects stale saves.

## Experience API Contract

All experience routes are separate from generic document routes. `POST`, `PATCH`, and other mutation routes reject cross-origin browser requests before service-role work. Private source-file reads also enforce the trusted read boundary and return `Cache-Control: private, no-store`; they do not create permanent public storage URLs.

| Route | Payload | Success | Notes |
| --- | --- | --- | --- |
| `POST /api/experiences` | `multipart/form-data` with `file` | `201`, `{ source, upload_state, next_action }` | Creates or reconciles a private source. Does not create generic chunks. |
| `GET /api/experiences` | none | `{ sources }` | Lists durable workflow state and available actions. |
| `GET /api/experiences/[id]` | none | `{ source, latest_extraction, latest_revision, revisions }` | Returns retained status for review/resume. |
| `POST /api/experiences/[id]/extract` | none | `{ status: "extracted", extraction, next_action: "parse" }` | Requires an execution lease and retained private source. |
| `POST /api/experiences/[id]/parse` | none | `{ status: "draft", revision_id, draft_version, omitted_block_coverage, next_action: "review" }` | Creates a distinct draft revision; does not approve or index. |
| `PATCH /api/experiences/[id]/draft` | `{ "revision_id": "...", "expected_draft_version": 1, "draft": { ...canonicalRevision } }` | `{ revision_id, draft_version, omitted_block_coverage, next_action: "review" }` | Validates source-backed fields and increments the persisted draft version. |
| `POST /api/experiences/[id]/approve` | `{ "revision_id": "...", "expected_draft_version": 2 }` | `{ status: "approved", approved_content_hash, next_action: "index" }` | Freezes approved JSON/hash. Approval alone does not publish evidence. |
| `POST /api/experiences/[id]/draft-from-approved` | `{ "approved_revision_id": "..." }` or `{}` | `{ revision_id, cloned_from_revision_id, next_action: "review" }` | Creates a separate draft; accepted/indexed revisions remain unchanged. |
| `GET /api/experiences/[id]/revisions/[revisionId]/export` | none | `StructuredExperienceExportSchema` | Trusted export of approved/indexing/indexed retained JSON, source blocks, content hash, and resolved source refs. |
| `GET /api/experiences/[id]/file` | none | original bytes with MIME and `Content-Disposition` | Serves the private original through the server boundary only. |

State transitions are explicit:

```text
uploaded --extract--> extracted --parse--> draft --approve--> approved
approved --draft-from-approved--> draft
approved/indexing/indexed --export/file--> unchanged
```

Later indexing tasks extend `approved -> indexing -> indexed`; approval must not report indexed success. Draft save keeps the source reviewable and does not mutate active indexed evidence. Creating a draft from an approved or indexed revision updates only the latest draft pointer and source review state; it keeps `latest_approved_revision_id` and `active_revision_id` intact.

Recoverable API errors use stable codes. Validation failures use `draft-validation-failed` with `details.field_errors`. Version or stale-candidate conflicts use HTTP `409` codes such as `draft-version-conflict`, `approval-version-conflict`, `approval-candidate-stale`, or `draft-create-conflict`. Missing retained resources use `source-not-found`, `revision-not-found`, `revision-export-unavailable`, or `source-file-unavailable`. Browser trust-boundary failures use `cross-origin-rejected`.

The generic routes `/api/upload`, `/api/documents`, and `/api/search` remain generic. Experience upload, review, approval, retained export, and file serving must call only `/api/experiences...` routes.

## Preflight Checks

Before enabling the experience UI or API routes against a development target, run:

```bash
npm run test:experience
npx tsc --noEmit
```

The scoped test suite includes synthetic DOCX extraction, real legacy DOC conversion through LibreOffice into DOCX, selectable-PDF extraction, validation failures for unusable inputs, and snapshot round-trip checks. `runExperienceExtractionPreflight()` in [extractionPreflight.ts](./extractionPreflight.ts) performs a runtime check for:

- LibreOffice/`soffice`, required for legacy `.doc` conversion.
- Poppler `pdftotext`, preferred for selectable PDFs when installed.
- `pdf2json`, retained as the selectable-PDF fallback when Poppler is absent.
- Mammoth, required for DOCX text extraction after direct DOCX upload or DOC conversion.

Supported experience source formats are DOCX, legacy binary DOC, and selectable-text PDF. Generic TXT upload remains available only through the generic document workflow. OCR, scanned-only PDFs, encrypted documents, user-authored JSON, and HTML rendering of converted documents are out of scope.

Runtime defaults are intentionally bounded:

| Limit | Default |
| --- | --- |
| Uploaded source file | 10 MiB |
| DOCX expanded ZIP content | 50 MiB |
| Retained normalized extracted text | 60,000 UTF-16 code units |
| Retained source block | 2,000 UTF-16 code units |
| Legacy DOC conversion timeout | 30 seconds |
| Converted DOCX output | 10 MiB |

Legacy DOC conversion runs through `execFile` with fixed temporary filenames, an isolated LibreOffice profile directory, no shell interpolation, finite stdout/stderr buffers, and recursive cleanup in `finally`. Set `LIBREOFFICE_PATH` when `soffice` is not on `PATH`. Set `PDFTOTEXT_PATH` when Poppler is installed outside the default lookup path. A missing Poppler binary is not fatal, but a missing LibreOffice binary prevents DOC support and must be resolved before enabling DOC uploads.

Then run the database smoke checks against the intended Supabase database:

```bash
supabase/checks/experience_registry.sql
supabase/checks/evidence_index.sql
```

`experience_registry.sql` rolls back all seeded data and verifies registry tables, RLS/grants, private bucket configuration, source reservation/retry behavior, execution-token conflicts, stale-token rejection, optimistic draft saves, pointer invariants, and immutable frozen content. `evidence_index.sql` verifies the generic foundation remains searchable/deletable and server-only. Run Supabase advisors after schema changes; existing foundation warnings should be reviewed separately from experience-ingestion warnings.

The current `@supabase/supabase-js` version expects Node 22+ for native WebSocket support in direct Node scripts. Use the project runtime's supported Node version, or provide the documented Supabase realtime transport option before running live storage smoke scripts under older Node.

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

1. Disable experience UI/API entry points first; leave generic upload/search/list/detail/file/delete flows enabled.
2. Stop new extraction/parsing/indexing requests and allow active leases to expire.
3. Preserve `experience_sources`, retained source files, extraction snapshots, and approved revisions unless the user explicitly decides they are no longer needed.
4. Remove live indexed experience publications through the coordinated deletion lifecycle once that lifecycle exists; do not delete generic foundation rows or generic `documents` data.
5. Drop experience-only functions, tables, or the private bucket only after confirming accepted revision history and source files are intentionally discarded.

The existing `supabase/rollback/evidence_index.sql` is destructive for foundation evidence and is not a routine rollback for this workflow.
