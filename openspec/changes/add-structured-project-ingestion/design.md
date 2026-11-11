# Design

## Context

See `proposal.md` for motivation and `specs/structured-project-ingestion/spec.md` for the behavioral contract.

Observed implementation:

- Next.js App Router uses server routes with the Supabase service role. There is no application authentication or multi-user ownership model.
- `app/api/upload/route.ts` currently combines storage, text extraction, generic chunking, embeddings, and individual inserts into `documents`. It accepts PDF/DOCX/TXT, not DOC.
- PDF extraction prefers Poppler `pdftotext`, then `pdf2json`; normalization and narrow garbling heuristics already exist. The fallback can still return questionable text, so experience ingestion needs a final quality check.
- Mammoth extracts DOCX raw text. Poppler was not discoverable on this machine during planning; installation must be verified during implementation when preferred PDF extraction is required, not assumed.
- `app/lib/gemini.ts` already separates retrieval-document and retrieval-query embedding tasks and fixes embeddings at 1536 dimensions. Its generic answer helper defaults to 512 output tokens and is unsuitable for structured extraction.
- `insertProjectEvidence` prepares embeddings and atomically inserts one parent with children. Separate calls for several parents do not provide document-wide atomicity.
- `searchProjectEvidence` searches all child rows and expands parents; it does not know approval state or source selection.
- `app/documents/page.tsx` and `UploadModal.tsx` handle generic documents only. The Search page already has a textarea but remains generic until the JD-fit change.
- The completed `add-evidence-index-data-model` change has not been archived into main specs. Its planning artifacts, vector dimension, generic APIs, and existing RPC signatures remain unchanged.

Publication retry policy follow-up (2026-11-11):

- `supabase-remote-verification-2026-11-11.md` records a remote reproduction on `lwljmmfcvmbnrfstltzj`: R1 publishes, R2 replaces it, and a valid R1 retry fails with SQLSTATE `40001` because the latest-approved check precedes the current-active-only retry branch.
- The revised decision retains that rejection for every outdated candidate, including previously published revisions. The report remains unchanged as evidence against the earlier contract; changing the contract is not a newly implemented fix or a new remote verification result. No historical publication receipts or superseded-revision success acknowledgements will be added.
- Static inspection found that the API rejects older candidates before reaching the RPC, but synthesizes current-active retry success before acquiring an indexing lease. The review client's indexing-error branch reports an error and returns before refreshing detail; the inspected handler sends one request per click rather than automatically retrying. Lease compliance, conflict messaging, refreshed state, and absence of repeated automatic outdated requests remain verification work.
- Follow-up verification and any required application fixes remain open. The report's migration-history discrepancy is a separate issue.

## Goals / Non-Goals

**Goals:**

- Establish a durable source-to-approved-revision-to-vector-publication chain without making generated summaries into quotation text.
- Reuse the parent/child model and source identity fields rather than create a competing vector index.
- Keep execution bounded and recoverable in a personal, Node-capable deployment.
- Provide a downstream eligibility and provenance contract that JD-fit and quality evaluations can consume without inferring approval from arbitrary metadata.

**Non-Goals:**

- No queue infrastructure, autonomous background worker, arbitrary-size ingestion, or browser-side database access.
- No OCR, JD input processing, requirement scoring, Search-page repurposing, or evaluation benchmark implementation.
- No source editing or unsupported user-added achievements in v1. Factual corrections must point to the uploaded source; extra facts require a revised file.
- No multi-user tenancy. A trusted local/private deployment boundary is required instead of treating an unauthenticated public deployment as safe.

## Decisions

### Decision 1: Separate experience endpoints and Documents controls

Add experience-specific server modules and `/api/experiences` routes. Keep `/api/upload`, `/api/documents`, `/api/search`, and existing generic responses compatible. Within Documents, expose clearly separated Generic Documents and Experience sections and an experience upload action. Review belongs on a dedicated `/experiences/[sourceId]` detail page reachable from Documents.

Suggested route contract:

| Route | Responsibility |
| --- | --- |
| `POST /api/experiences` | Validate file, reserve/deduplicate source identity, retain private original, return durable source ID |
| `GET /api/experiences` | List source status, current draft, active indexed revision, counts, and failure/cleanup state |
| `GET /api/experiences/[id]` | Return normalized source blocks, revision JSON, coverage, versions, and available actions |
| `POST /api/experiences/[id]/extract` | Acquire bounded execution ownership and persist an extraction snapshot |
| `POST /api/experiences/[id]/parse` | Generate/validate a new draft from a retained snapshot; explicit reparse creates a new revision |
| `PATCH /api/experiences/[id]/draft` | Save a validated draft with optimistic version checking |
| `POST /api/experiences/[id]/approve` | Validate and freeze the exact draft version/hash |
| `POST /api/experiences/[id]/index` | Prepare a bounded embedding batch, or atomically publish when preparation is complete |
| `GET /api/experiences/[id]/file` | Serve the private original through the trusted server boundary |
| `DELETE /api/experiences/[id]` | Tombstone, remove database evidence/history, and complete or schedule explicit storage-cleanup retry |

Mutation requests carry the relevant revision ID and expected version; user input cannot redirect storage paths or choose another source's revision. Execution endpoints return status and the next explicit action, not a misleading upload-success/index-success flag. The UI drives successive requests while open; reopening resumes from persisted state. No fire-and-forget work runs after a response.

Alternative: overload the generic upload route and existing document metadata. Rejected because it conflates upload, review, and publication and risks breaking generic compatibility.

### Decision 2: Preserve extraction behavior but freeze a canonical citation source

Move reusable extraction/normalization into server utilities while preserving generic behavior. Experience ingestion adds:

1. Verify extension, plausible MIME/container signature, byte limits, and actual nonempty file data before parsing or invoking converters. Check DOCX archive expansion bounds as well as compressed upload size.
2. For PDF, retain the existing Poppler-first/fallback strategy and run the final normalized output through usability checks regardless of extractor. These checks are heuristics, not a guarantee; show retained extraction to the reviewer. Do not use the LLM to repair unreadable characters or perform OCR.
3. For DOCX, use Mammoth raw text, retaining warnings. Do not render untrusted converted HTML.
4. Reject legacy binary DOC as unsupported in v1. Users who need DOC ingestion should convert it to DOCX outside the workflow before upload.
5. Normalize only mechanical extraction artifacts such as NULs and line endings. Store the exact result; never normalize again after citation offsets have been assigned.
6. Create ordered blocks at paragraph/page boundaries where available, with a deterministic bounded split for long blocks. Store whole-text offsets and recoverable location information. Do not invent page numbers for flattened fallback output.

Each extraction snapshot has its own hash and parser/normalization version. Re-extraction can produce different blocks, so it creates a new immutable snapshot rather than mutating referenced text.

Initial configurable bounds, recorded as implementation defaults:

| Bound | Default |
| --- | --- |
| Uploaded file | 10 MiB |
| DOCX expanded content | 50 MiB |
| Canonical extracted text | 60,000 UTF-16 code units |
| Source block | 2,000 UTF-16 code units, split at text boundaries |
| Structured prompt input | 24,000 model tokens including instructions/schema |
| Structured generation output | 16,384 tokens, within selected model capability |
| Experiences / evidence items per revision | 16 / 80 |
| Published child chunks per revision | 300 |
| Extraction / parsing request | 45 / 120 seconds |
| Embedding preparation batch | At most 3 chunks and 75 seconds per request |

Validate model input token count and supported output configuration before generation. Bounds are safety limits, not permission to silently cut text, drop projects, or accept an incomplete model response. Over-limit documents receive split/reduce guidance. Large-document map/reduce parsing is deferred rather than added implicitly.

Alternatives: cloud document parsing/OCR, or pretending DOC and DOCX use the same parser. Rejected to keep the approved personal/text-based scope explicit. Legacy DOC support is deferred; users can convert DOC to DOCX before upload for v1.

### Decision 3: Separate model proposal from the validated canonical JSON

Use the existing `@google/genai` SDK with a dedicated extraction prompt, JSON MIME response, supported structured-output schema, low temperature, explicit input/output limits, and a separate timeout. Do not reuse `generateAnswer` or change its generic defaults. Add a runtime validator such as Zod and keep the API schema and validator definitions aligned.

The source is untrusted data, including any instructions embedded inside it. The extraction prompt prohibits following those instructions, guessing missing facts, strengthening qualifications, or treating technology mentions as proficiency. Check the completion reason and reject blocked, truncated, missing, or invalid output. Allow at most one bounded schema/reference repair attempt for a completed invalid response; do not repair a truncated source or silently retry without a limit.

The model proposes field values, experience boundaries, evidence kinds, and references expressed as `{ block_id, quote }`. The application resolves each quote to an exact, unique occurrence in the specified block. Ambiguous or nonmatching quotes require correction rather than fuzzy matching or guessed offsets. Canonical references become `{ block_id, start, end }`, using zero-based UTF-16 offsets and an exclusive end within normalized block text.

Canonical accepted JSON:

| Entity | Fields and rules |
| --- | --- |
| Envelope | `schema_version: "1"`, source/extraction/revision identities, `experiences`, review acknowledgements |
| Source descriptor | Stable `document_id`, original file name/type, file hash, extraction snapshot ID and text hash |
| Source block | Stable block ID within the snapshot, order, exact text, text offsets, optional reliable locator |
| Experience | Application-assigned logical ID, `type: project \| general-experience`, source-linked title/organization/role/period/technologies, context references, evidence items |
| Factual field | `{ value, source_refs }`; unknown scalar values are null, collections are empty; each populated value requires support |
| Period | Optional source-backed start/end labels and date precision; no fabricated day, duration, or sum of overlapping experience |
| Evidence item | Application-assigned logical ID, `kind`, source-backed summary, source references, attribution and activity status |
| Evidence kind | `background`, `responsibility`, `contribution`, `challenge`, `decision`, or `outcome` |
| Attribution / activity | `individual \| team \| unspecified`; `completed \| ongoing \| planned \| unspecified`, supported by item references |
| Source reference | Snapshot-local block ID plus valid nonempty `[start, end)` span |
| Review acknowledgements | Explicit acknowledgement of warnings and unassigned source blocks before approval |

Preserve numeric claims and their qualifiers in original evidence. Do not introduce normalized achievement scores or fit labels. Titles absent from the source remain null; the UI may show "Experience 1" as a display label, not a claimed source fact.

JSON in storage references a retained snapshot; the trusted detail/export response can include the immutable blocks as a bundle. Avoid duplicating full source text inside every child metadata object.

Runtime validation checks schema, limits, ownership, field references, span bounds, duplicate IDs, nonempty evidence, and consistent attribution/status. It cannot prove semantic entailment: that is why source-linked human review is mandatory.

Show uncovered source blocks to the user so omitted material is visible. They can add supported evidence or explicitly acknowledge that material such as contact details is not being indexed. Unsupported edits remain unapprovable; they are not legitimized merely by clicking Approve.

Alternatives: free-form JSON plus automatic indexing, or using LLM summaries as citations. Rejected because syntactically valid JSON can still misstate the source.

### Decision 4: Add a durable registry without redesigning foundation tables

Suggested additive records:

| Record | Purpose |
| --- | --- |
| `experience_sources` | UUID source ID, original byte SHA-256/size, private storage path, upload status, latest approved candidate pointer, active indexed revision pointer, deletion/cleanup state |
| `experience_extractions` | Immutable normalized blocks/text hash, source FK, extractor/normalization version, warnings |
| `experience_revisions` | Source/snapshot FK, draft JSON, draft version, frozen approved JSON/hash, approval/index timestamps, structured-generation provenance |
| `experience_revision_parents` | Revision FK and unique physical parent FK, plus logical experience/parent IDs; proves live publication membership |
| `experience_index_staging` | Approved revision/plan hash, logical chunk key, expected citation/embedding input, prepared embedding and preparation configuration |

Statuses are stored on the relevant source/revision; list responses derive a combined workflow status rather than maintaining a second competing status field. Stage failures include a safe error code, failed stage, retry action, and expired execution ownership information.

Use source/revision foreign keys, uniqueness for byte-identical live sources, unique logical chunk staging keys, and validated revision pointers. A deferred constraint trigger or transactional invariant check must enforce that an active pointer references a published revision belonging to that source and the candidate pointer references its approved revision. Source IDs passed to `parent_documents.source_document_id` are the registry UUID rendered as text; do not make that foundation column a mandatory FK, because standalone evidence helpers already accept arbitrary source identifiers.

Database UUIDs identify physical vector rows. Application logical IDs identify accepted experiences, evidence items, parent partitions, and child spans. Assign these once and persist them; retain them when editing an existing item. Retries/reindexing of the same approved revision retain logical IDs; independent LLM reparses are separate revisions without an ID-stability guarantee.

Approval freezes canonical JSON with deterministic serialization/hash and a compare-and-swap draft version, and selects the latest approved candidate under the source lock. Only that candidate may publish or receive an idempotent publication-success response; an older in-flight revision cannot replace a newer approval. Preserve the approved JSON and snapshot for accepted revisions even after their live vector rows are superseded. Editing an approved/indexed revision creates a separate draft; it never modifies an active revision in place.

Retained approval history supports inspection and citation resolution, not permission to retry an outdated publication. Logical ID stability applies to permitted retries and retained exports; it does not authorize republication of a superseded revision. No historical publication receipt table, backfill, or alternate success ledger is part of this design.

Alternative: put canonical JSON and status only in arbitrary parent metadata. Rejected because drafts have no parent yet, approval must be document-wide, and provenance must survive replacement of physical vector rows.

### Decision 5: Make state transitions and recovery explicit

Nominal lifecycle:

```text
uploaded -> extracting -> extracted -> parsing -> draft
draft -> approved -> indexing -> indexed
                     |
                     +-- staged embedding checkpoints until publication
```

`extracted` is an implementation checkpoint; the required user-facing stages remain distinct. A failure retains the last complete checkpoint and failed stage. Explicit extract/parse/index retries acquire an execution token with finite expiry using database compare-and-swap; simultaneous requests receive a conflict or current progress. Use database time for expiry and a lease longer than the stage deadline plus a bounded completion grace period. A repair attempt shares the parsing request's overall deadline.

An expired lease does not let an old request write late results: every completion/staging write checks the current token. Reuse completed staging entries only when their revision hash, embedding text hash, chunking version, embedding model, task type, and dimension match. Pin preparation configuration for the whole attempt; a configuration change requires restarting preparation rather than publishing mixed vectors.

Publication retries, including current-active retries, require a valid source-owned indexing lease. Retain normal execution-token acquisition, finite expiry, database-time checks, and conflict/takeover semantics; a prior publication never permits stealing an unexpired lease. No historical-acknowledgement acquisition path is added.

Under the publication lock, reject missing, expired, replaced, or wrong-stage tokens and any latest-approved-candidate mismatch before returning success. Successful publication or a permitted current-active retry atomically clears its matching `execution_token`, `execution_stage`, `execution_token_expires_at`, and `execution_started_at`. A retry inserts no evidence, does not change candidate/active pointers, and does not remove another revision's staging. The same source lock serializes publication with approval, replacement, and deletion.

An error from the publication RPC rolls back that call's changes, including lease clearing. If the API separately releases a lease after failure, that cleanup must validate current execution ownership, never clear a replacement lease, and not overwrite newer lifecycle state using a pre-request snapshot. Successful publication or a permitted current-active retry consumes its lease atomically; the API must not issue another completion write afterward. A response-loss retry acquires another valid lease rather than reusing the consumed token, and still fails if a newer candidate has since been approved.

Upload reserves a source row by file hash before storage. Use a deterministic private path so a response-loss retry can reconcile upload completion; do not blindly treat an existing object as a fully completed upload. Explicit reparse creates a new revision from an extraction snapshot. No automatic reparse occurs for a duplicate upload.

Alternative: one long upload-to-index request or an in-memory background promise. Rejected because review breaks the pipeline and requests can end midway.

### Decision 6: Construct citation-preserving parent/child evidence deterministically

This retains the foundation's small-to-big retrieval model: children are focused search units and parents are broader project/project-section context.

- Build parent text from ordered exact source spans identified as experience context and evidence. Do not use a generated project summary as the sole parent text. Deduplicate overlapping context spans and keep source-span mappings for the assembled parent.
- Start with a 12,000-code-unit parent bound. If exceeded, partition at source block/evidence boundaries into project-section parents, all linked to the same logical experience. Never place another project's text into a parent just to reach a target size.
- Generate children from exact source slices. Noncontiguous references produce separate children. Long slices split at paragraph/sentence boundaries with an initial 1,200-code-unit target and hard maximum; retain adjusted offsets for every part. Overlap, if used, must be bounded, source-derived, and recorded; do not cross project boundaries.
- Every evidence item's referenced spans must be represented by at least one child unless the reviewer explicitly removes the evidence before approval. Validate coverage and bounds for the full plan before embedding.
- A child can refer to several logical evidence IDs if they point to the same source span; deduplicate identical spans within a parent rather than embedding them repeatedly.
- Build `embedding_text` from validated source-supported title, role, relevant technologies, evidence kind, and the exact `child_text`. A project-level technology list is context, not a claim that every contribution used every listed technology.
- Embed with `RETRIEVAL_DOCUMENT` and 1536 dimensions, using the same configured embedding model as evidence queries.
- Parent/child metadata carries schema version, source ID, revision ID/hash, extraction snapshot ID, logical experience/parent/evidence/chunk IDs, source spans, kind, attribution/status, and chunking/embedding configuration. LLM-generated summaries stay in canonical JSON and are labelled as summaries.

A downstream citation resolves to normalized extracted text, not guaranteed byte-for-byte PDF rendering. Preserve the original file for human verification and reliable file locators when available.

Alternatives: reuse generic fixed-size chunking without semantic grouping, or embed the full JSON. Rejected because these weaken focused retrieval and conflate structure with quoted evidence.

### Decision 7: Prepare embeddings incrementally, publish the entire revision transactionally

Do not call `insertProjectEvidence` independently per project and label the resulting document complete. Apply the latest-approved-candidate guard to both first publication and retries:

1. Resolve the requested source-owned approved revision and validate its retained canonical content/hash. Reject an outdated candidate before scheduling preparation. The API precheck does not replace the locked database check.
2. Freeze the deterministic approved parent/child plan, hash, expected counts, and configuration. Each preparation request acquires an indexing lease, prepares at most three missing embeddings before its deadline, persists compatible vectors in server-only staging, and returns progress until complete.
3. For an already-indexed current-active revision that is still the latest approved candidate, acquire a valid indexing lease and invoke `publish_experience_revision` for idempotency verification without regenerating embeddings or requiring cleared staging. Do not synthesize success from API snapshot state alone.
4. At the RPC boundary, validate required parameters and lock the source then the source-owned target revision. Refuse unavailable/deleted sources, wrong ownership, missing/expired/replaced/wrong-stage tokens, altered approved hashes, invalid counts/configuration, and any latest-approved-candidate mismatch before returning success.
5. Only when the target is both current active and latest approved, with indexed status, validate its live mappings, plan hash, approved hash, expected parent/child counts, chunking version, embedding model, task type, and dimensions. Matching requests return idempotent success and consume the lease as in Decision 5. Missing or mismatched live evidence is a failure, not permission to recreate it through a retry.
6. Otherwise require a publishable approved/indexing revision, no conflicting publication mappings, and complete compatible staging. For eligible publication, call `insert_project_evidence` for each prepared parent inside the transaction, create mappings, verify counts, remove prior active parents and their cascading children/mappings, mark the target indexed, update the active pointer, clear target staging, and consume the matching lease atomically.

Any publication error rolls back new parents, children, mappings, pointer/status changes, staging cleanup, and lease consumption, leaving the previous index intact. Publication uses staged data rather than arbitrary browser-submitted parent/vector payloads. Keep the original standalone insertion helper/RPC signatures and token fencing intact; do not restore a tokenless publication overload.

The latest-approved check deliberately precedes any idempotent-success branch. A previously published revision that is no longer the candidate fails with SQLSTATE `40001`, just like a never-published outdated revision. Approval history does not bypass this rule. Database checks remain authoritative if approval, publication, or deletion happens between API reads and the RPC.

#### Retries after approval and replacement

| State when retrying successfully published R1 | Required outcome |
| --- | --- |
| R1 is active and latest approved | Return idempotent success only with a valid indexing lease and matching live evidence/parameters; insert nothing |
| R2 is approved but not published; R1 remains active | Reject R1 publication retry; keep R1 searchable and R2 the approved candidate, preserving R2's workflow and staging |
| R2 has published and replaced R1 | Reject R1 retry; keep R2 active and leave R1 mappings/parents/chunks absent |
| R1 never published and R2 is approved or published | Reject stale first-time publication; neither pointers nor evidence may change |
| The source was tombstoned or removed | Reject regardless of prior publication; never return cached success or recreate evidence |

#### Success and conflict responses

Preserve the existing publication-success fields and their meaning in the index API's `publication` response:

| Field | Meaning |
| --- | --- |
| `status` | `indexed` only for a permitted successful publication or verified current-active/current-candidate retry |
| `already_published` | `true` for the permitted idempotent retry; `false` for newly committed publication |
| `revision_id`, `active_revision_id` | The successfully published requested revision and actual active revision under the source lock; both identify the current candidate at success |
| `parent_count`, `child_count` | Validated live counts for a retry, or the actual newly published counts |
| `plan_hash` | The successfully validated publication plan hash |
| `previous_active_revision_id` | Retained for newly committed replacement responses, not invented for retries |

A permitted retry reports completed progress with zero remaining/newly prepared chunks and `next_action: null`. The API must not translate an outdated request into `indexed` or `already_published: true`, even if retained history shows an earlier successful publication. There are no new historical-success fields or receipt-backed responses.

An outdated indexing request receives HTTP 409 with a stable stale-candidate classification and a clear explanation that a newer approved revision must be reviewed before another indexing action. Preserve the early `index-candidate-stale` rejection and ensure candidate changes detected at publication receive equivalent actionable handling. SQLSTATE `40001` also covers other conflicts, so do not classify every such error as an outdated candidate or blindly retry it.

On a stale-candidate conflict, stop the request sequence, refresh source detail including latest-approved and active revision identities, and require an explicit user action against the refreshed candidate. Do not automatically resend the old revision, silently retarget its request to the new revision, or present `retry-index` as permission to repeat an outdated request. A failed refresh reports that failure and leaves indexing stopped. Preserve the previous active index and show its state separately from pending candidate work.

Alternatives: historical-success acknowledgements and their receipt storage are excluded by the chosen latest-candidate-only policy. Progressively visible inserts, trusting an `indexed` status alone, and bypassing token checks for retries remain rejected because they weaken atomicity or lifecycle protections.

### Decision 8: Own approved-search eligibility in ingestion; leave JD reasoning for later

Add a new ingestion-owned search RPC/helper rather than changing `match_document_chunks` or claiming the existing unfiltered helper is approval-aware.

The new query joins children to publication mappings, revisions, and nondeleted source active pointers. It admits only indexed revisions with a frozen approved hash. An optional source selection is validated; absent means all eligible personal sources, an explicit empty selection means none, and unknown/ineligible IDs produce an eligibility error. Apply the source/active predicates before similarity ordering and LIMIT.

Search eligibility does not require the active revision to equal the latest approved candidate. After R2 approval, R1 remains the active searchable revision throughout R2 preparation and any failed publication. Only successful atomic replacement switches eligibility to R2 and removes R1's live evidence. Rejecting an outdated R1 indexing request must not hide or delete that still-active index.

Keep retrieval-query embeddings and result fields compatible with the foundation helper, adding source/revision/logical citation lineage and parent expansion. Recheck active membership during expansion or use a transactionally consistent query; a concurrent delete/replacement must not add stale parent context.

For the small personal corpus, start with correctness-oriented cosine ranking over the filtered eligible set. The existing HNSW index remains available, but filtered approximate retrieval must not silently underfill results; exact ranking is acceptable at this scale. Benchmark/optimize only if corpus growth justifies it.

JD-fit will later extract JD requirements, invoke this approved-search contract per requirement, deduplicate/budget context, generate cited categories, and validate citations. This change provides no JD endpoint or fit prompt. The old generic Search page and endpoint remain unchanged.

Quality evaluations will later use frozen revision exports and logical source-span IDs as fixture anchors rather than physical vector UUIDs or LLM summaries as ground truth. Record model identifiers and any resolved model version returned by the provider; aliases alone do not guarantee reproducibility.

Alternatives: add filtering only in JD-fit, or filter after top-K. Rejected because approval is an ingestion invariant and post-filtering can discard all relevant selected-source candidates.

### Decision 9: Private storage and coordinated deletion are part of ingestion

Create a dedicated private `experience-sources` bucket, not permanent public URLs in the existing generic bucket. New registry, revision, mapping, and staging tables have RLS enabled, no browser policies, and explicit service-role-only access with only required privileges. New RPC execution is revoked from PUBLIC/anon/authenticated. Publication, execution-lease handling, and deletion RPCs remain `SECURITY INVOKER` with fixed search paths.

The approved deployment is loopback-only locally or externally access-controlled. No user account system is introduced, but all experience APIs/file endpoints must share that trusted boundary. Reject cross-origin browser mutations using configured same-origin checks; loopback binding alone does not prevent a malicious website from submitting a browser request. RLS does not protect an unauthenticated server route using the service role; documentation must prohibit an unprotected public deployment.

Delete acquires the source lock, tombstones the source, clears its active pointer, explicitly deletes all mapped parents and their cascading children, removes revision/extraction/staging content, and retains only cleanup status/path until storage removal succeeds. Mapping-row deletion alone does not delete parent records, so a transactional deletion RPC must perform both.

Late index/extract/parse writes check the tombstone and execution token and cannot resurrect the source. A storage failure returns cleanup-pending status and supports idempotent DELETE retry; tombstoned IDs cannot be used for reparse/reindex. Only a fresh explicit upload after cleanup can recreate a source. Avoid source contents in logs; return stable error codes and safe diagnostics.

Alternative: rely on table RLS while exposing public API/file URLs, or silently ignore storage deletion errors. Rejected because neither meets private personal-source retention and observable cleanup.

## Risks / Trade-offs

- Legacy DOC support would add native runtime and security requirements -> Defer DOC conversion for v1 and reject `.doc` uploads explicitly.
- PDF usability heuristics miss some corrupt extraction -> Retain both fallback behavior and final checks, expose exact source text and warnings during review, and block clearly unusable input.
- Constrained JSON still misinterprets source claims -> Mandatory human review, attribution/status fields, source references, and explicit unknown values; no claim that schema validation proves truth.
- Personal experience documents can exceed request/model limits -> Bound stages and prompt sizes, checkpoint embeddings, reject oversize text clearly, and defer arbitrary-size parsing.
- Extra registry/staging records add complexity -> Keep one canonical revision authority, one active pointer per source, transactional publication, and explicit ownership checks.
- Exact filtered vector ranking can become expensive -> Appropriate for a small personal corpus; measure before adding filtered-ANN complexity.
- Reviewer acknowledgement cannot prove extraction completeness -> Show unassigned blocks and original file access; record approval of an interpretation, not a guarantee of factual completeness.
- Source-grounded corrections cannot add missing facts directly -> Require a revised source upload in v1 rather than invent a second attestation provenance system.
- Mutable provider model aliases reduce repeatability -> Record configured/resolved model versions and use pinned versions for future benchmark baselines where available.
- Response loss across a newer approval cannot return the old publication's success -> Deliberately reject the outdated request, retain approval history, refresh source state, and require an explicit action against the current candidate.
- Conflict cleanup or retry handling can overwrite newer workflow state or repeatedly submit outdated work -> Keep execution ownership checks, inspect cleanup and UI refresh behavior, and test both newer-approved and newer-published cases.
- Remote object state and migration-history completeness differ -> Keep history reconciliation separate from retry-policy verification and prohibit replaying existing migrations.

## Migration Plan

### Target and execution boundary

All follow-up implementation must target remote Supabase project `lwljmmfcvmbnrfstltzj` (`https://lwljmmfcvmbnrfstltzj.supabase.co`), and every database preflight, deployment, or verification must explicitly confirm that target. Leave the local development database untouched, including schema changes, test fixtures, resets, local migration replay, or local-database-based diff generation. Repository editing and database-free application tests are distinct from database execution.

This revision authorizes planning only: do not implement code, create or execute SQL changes, or modify any database during artifact updates. The future sequence below requires a separate implementation authorization. Use Supabase MCP for target confirmation and scoped remote operations when that work is authorized.

### Original rollout context

The original rollout sequence is retained for context, not as instructions to replay deployed migrations:

1. Confirm the completed foundation objects on the named remote target. Do not replay their migrations or change their design/spec files.
2. Add shared extraction/schema/planning modules and a narrowly scoped test runner for the new workflow; preserve generic extraction/API behavior through regression checks.
3. Establish additive registry/staging/publication/search/deletion objects and the private bucket only when absent during the initial rollout. The 2026-11-11 report already confirms these target objects; their existence does not prove migration-history alignment.
4. Install/verify converter binaries and document the Node-capable private deployment and configured execution limits.
5. Add staged experience APIs and Documents/detail review UI. Enable the feature only after migrations and runtime dependencies pass preflight.
6. Verify real DOCX/selectable-PDF extraction, source-linked review, approval, resumable embeddings, multi-parent publication, approved filtering, replacement, deletion, and generic compatibility.
7. Retain the accepted revision export/search contract as the dependency for the subsequent JD-fit proposal.

### Retry-policy verification follow-up

1. Confirm the named remote target and inspect the then-current publication functions, grants, execution fencing, deletion behavior, and retained approval history. Do not assume that the report's empty experience corpus remains empty.
2. Verify the existing database behavior against the revised latest-candidate-only contract using the rollback-only matrix below. No database change, historical receipt, or backfill is presumed necessary to retain outdated-request rejection.
3. Inspect application current-active retry lease compliance and both early/API and late/RPC conflict handling. Verify clear messaging, state refresh, explicit candidate selection after refresh, and no repeated automatic outdated requests. Record any required fixes as open work rather than implementing them during planning.
4. If later verification establishes a necessary implementation change, obtain separate authorization. Keep any future SQL changes and regression scripts in the repository for traceability, preserve existing migration files, and record exact reviewed SQL, application revision, remote target, and execution evidence. Schema deployment remains distinct from rollback-only data verification; those checks do not authorize it.
5. Keep remote regression verification, application-conflict inspection, and revised acceptance open until evidence is recorded. Retain the original report as historical evidence; the changed policy is not proof that all database and application requirements now pass.

Migration-history reconciliation requires its own review and authorization. Do not run `supabase db push`, replay existing migrations, rename their historical versions, or repair migration-history rows as part of this follow-up.

### Rollback-only remote verification

When remote verification is separately authorized, run repository-recorded synthetic SQL fixtures only against `lwljmmfcvmbnrfstltzj`, using transactions that end with `ROLLBACK`. Use `SET LOCAL ROLE service_role` for application-behavior assertions, isolate expected failures with transactional exception handling/savepoints, and roll back aborted checks as well as passing checks. Do not call Gemini or upload/delete real Storage objects. Database deletion checks exercise tombstone/cleanup checkpoints, not external Storage cleanup.

| Check | Required assertions before rollback |
| --- | --- |
| First publication and current-version retry | Target remains both active and latest approved; valid indexing lease and matching live hash/configuration/counts yield `already_published: true`; unchanged live row identities and all four matching lease fields cleared |
| Retry published R1 after R2 approval | Expect `40001` despite valid token and R1's prior success; keep R1 active/searchable, R2 latest approved, and pre-RPC source state, staging, evidence, and lease unchanged |
| Retry published R1 after R2 publication | Expect `40001` despite valid token and retained approval history; keep R2 active, R1 live mappings/chunks absent, and pre-RPC state unchanged |
| Stale never-published R1 | Test after both R2 approval and R2 publication with otherwise valid token and complete staging; expect `40001`, no new evidence, and unchanged pointers/lease |
| Invalid execution tokens | Test omitted/null, expired, replaced, and wrong-stage tokens for publication/current-candidate retries; outdated requests also never succeed; reject without consuming another lease or mutating state |
| Mismatched publication parameters | Independently vary approved hash, plan hash, each expected count, chunking version, model, task type, and dimensions on an otherwise eligible candidate; include null/invalid values and wrong-source revision identity; reject without side effects |
| Atomic replacement and failure | R1 remains searchable after R2 approval, during preparation, and after forced multi-parent failure; successful R2 atomically switches eligibility and removes only old live evidence, preserving approved JSON/snapshots and logical citation history |
| Live integrity and access | Current-version retry cannot mask missing/mismatched live evidence; browser roles cannot access server-only lifecycle data/RPCs; no historical receipt schema or backfill is introduced |
| Deletion and ordering | Deletion removes mapped evidence, revisions/extractions, and staging; retries after tombstone/cleanup-pending fail, old tokens cannot resurrect data, and repeated deletion is safe |

Snapshot relevant row identities/counts and source/revision/staging state before and after each operation, including the state immediately before a rejected RPC separately from prior lease acquisition. Then verify fixture cleanup and unchanged persistent data after `ROLLBACK`, including generic/standalone evidence and Storage object metadata counts. Record exact assertions and expected errors; sequential lock-order simulations do not claim two-session concurrency coverage.

Application verification must cover current-version success only through valid execution ownership, no unnecessary embedding on a permitted retry, no post-success completion call, and both early stale-candidate rejection and a candidate change during publication. For conflicts, verify a clear HTTP 409 message, refreshed source/candidate/active state, safe failure when refresh fails, preservation of newer execution ownership during cleanup, and no automatic resubmission or silent retargeting. Database-free tests and later browser checks must record actual request counts rather than infer the absence of retry loops from a single error response.

### Rollback strategy

- Disable experience controls and APIs first; leave generic flows available.
- Prefer retaining registry/source/canonical revision data while removing new live publications through the coordinated lifecycle if needed.
- Do not drop the existing foundation tables/functions or delete standalone/generic evidence.
- Drop additive functions/tables/private storage only after explicitly confirming that source files and accepted revision history are no longer needed. Never describe a destructive rollback as routine preservation.
