# Design

## Context

See `proposal.md` for motivation and `specs/structured-project-ingestion/spec.md` for the behavioral contract.

Observed implementation:

- Next.js App Router uses server routes with the Supabase service role. There is no application authentication or multi-user ownership model.
- `app/api/upload/route.ts` currently combines storage, text extraction, generic chunking, embeddings, and individual inserts into `documents`. It accepts PDF/DOCX/TXT, not DOC.
- PDF extraction prefers Poppler `pdftotext`, then `pdf2json`; normalization and narrow garbling heuristics already exist. The fallback can still return questionable text, so experience ingestion needs a final quality check.
- Mammoth extracts DOCX raw text. Neither Poppler nor LibreOffice was discoverable on this machine during planning; installation must be verified during implementation, not assumed.
- `app/lib/gemini.ts` already separates retrieval-document and retrieval-query embedding tasks and fixes embeddings at 1536 dimensions. Its generic answer helper defaults to 512 output tokens and is unsuitable for structured extraction.
- `insertProjectEvidence` prepares embeddings and atomically inserts one parent with children. Separate calls for several parents do not provide document-wide atomicity.
- `searchProjectEvidence` searches all child rows and expands parents; it does not know approval state or source selection.
- `app/documents/page.tsx` and `UploadModal.tsx` handle generic documents only. The Search page already has a textarea but remains generic until the JD-fit change.
- The completed `add-evidence-index-data-model` change has not been archived into main specs. Its planning artifacts, vector dimension, generic APIs, and existing RPC signatures remain unchanged.

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
4. For legacy binary DOC, use configured `LIBREOFFICE_PATH` or a discovered `soffice` executable for headless conversion into DOCX, then use the same Mammoth path. Execute with an argument array, isolated temporary input/output/profile directories, finite timeout/output limits, and cleanup in `finally`. Do not invoke a shell, execute macros, permit external resource fetching, or trust arbitrary supplied filenames. A deployment must isolate converter execution and verify its security settings.
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
| Converter / extraction / parsing request | 30 / 45 / 120 seconds |
| Embedding preparation batch | At most 3 chunks and 75 seconds per request |

Validate model input token count and supported output configuration before generation. Bounds are safety limits, not permission to silently cut text, drop projects, or accept an incomplete model response. Over-limit documents receive split/reduce guidance. Large-document map/reduce parsing is deferred rather than added implicitly.

Alternatives: cloud document parsing/OCR, or pretending DOC and DOCX use the same parser. Rejected to keep the approved personal/text-based scope explicit. Requiring DOCX conversion by the user would not meet the requested DOC support.

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
| `experience_revision_parents` | Revision FK and unique physical parent FK, plus logical experience/parent IDs; proves publication membership |
| `experience_index_staging` | Approved revision/plan hash, logical chunk key, expected citation/embedding input, prepared embedding and preparation configuration |

Statuses are stored on the relevant source/revision; list responses derive a combined workflow status rather than maintaining a second competing status field. Stage failures include a safe error code, failed stage, retry action, and expired execution ownership information.

Use source/revision foreign keys, uniqueness for byte-identical live sources, unique logical chunk staging keys, and validated revision pointers. A deferred constraint trigger or transactional invariant check must enforce that an active pointer references a published revision belonging to that source and the candidate pointer references its approved revision. Source IDs passed to `parent_documents.source_document_id` are the registry UUID rendered as text; do not make that foundation column a mandatory FK, because standalone evidence helpers already accept arbitrary source identifiers.

Database UUIDs identify physical vector rows. Application logical IDs identify accepted experiences, evidence items, parent partitions, and child spans. Assign these once and persist them; retain them when editing an existing item. Retries/reindexing of the same approved revision retain logical IDs; independent LLM reparses are separate revisions without an ID-stability guarantee.

Approval freezes canonical JSON with deterministic serialization/hash and a compare-and-swap draft version, and selects the latest approved candidate under the source lock. Only that candidate may newly publish; an older in-flight revision cannot replace a newer approval. Preserve the approved JSON and snapshot for accepted revisions even after their live vector rows are superseded. Editing an approved/indexed revision creates a separate draft; it never modifies an active revision in place.

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

Do not call `insertProjectEvidence` independently per project and label the resulting document complete. Instead:

1. Freeze the approved revision and deterministic parent/child plan; record its hash and expected counts.
2. Each index request prepares at most three missing embeddings before its deadline, persists validated vectors in server-only staging, and returns progress. On failure, keep completed compatible work and expose retry.
3. Once all expected staging entries are complete, invoke a new publication RPC with revision/hash/version expectations.
4. Lock the source and target revision in a consistent source-then-revision order. Refuse deleted sources, stale execution tokens, altered hashes, incomplete staging, wrong dimensions, or a latest-approved-candidate mismatch. Return the previous success if this revision already published, without reactivating a superseded revision.
5. Within the same transaction, call the existing `insert_project_evidence` function for each prepared parent, create revision-to-parent mappings, verify counts, remove prior active revision parents (cascade removes children), mark the target indexed, and update the source's active pointer.
6. Clear staging in the transaction after success. A raised error rolls back every new parent/child/mapping and leaves the previous index intact.

The new publication RPC uses staged data, not arbitrary browser-submitted parent/vector payloads. Server-only validation and database count/hash/ownership checks protect the publication boundary. Keep the original insertion helper/RPC signatures intact for standalone evidence callers.

Alternative: insert visible parents progressively and use a boolean in child metadata. Rejected because it permits partial document results and makes cleanup/concurrency difficult to prove.

### Decision 8: Own approved-search eligibility in ingestion; leave JD reasoning for later

Add a new ingestion-owned search RPC/helper rather than changing `match_document_chunks` or claiming the existing unfiltered helper is approval-aware.

The new query joins children to publication mappings, revisions, and nondeleted source active pointers. It admits only indexed revisions with a frozen approved hash. An optional source selection is validated; absent means all eligible personal sources, an explicit empty selection means none, and unknown/ineligible IDs produce an eligibility error. Apply the source/active predicates before similarity ordering and LIMIT.

Keep retrieval-query embeddings and result fields compatible with the foundation helper, adding source/revision/logical citation lineage and parent expansion. Recheck active membership during expansion or use a transactionally consistent query; a concurrent delete/replacement must not add stale parent context.

For the small personal corpus, start with correctness-oriented cosine ranking over the filtered eligible set. The existing HNSW index remains available, but filtered approximate retrieval must not silently underfill results; exact ranking is acceptable at this scale. Benchmark/optimize only if corpus growth justifies it.

JD-fit will later extract JD requirements, invoke this approved-search contract per requirement, deduplicate/budget context, generate cited categories, and validate citations. This change provides no JD endpoint or fit prompt. The old generic Search page and endpoint remain unchanged.

Quality evaluations will later use frozen revision exports and logical source-span IDs as fixture anchors rather than physical vector UUIDs or LLM summaries as ground truth. Record model identifiers and any resolved model version returned by the provider; aliases alone do not guarantee reproducibility.

Alternatives: add filtering only in JD-fit, or filter after top-K. Rejected because approval is an ingestion invariant and post-filtering can discard all relevant selected-source candidates.

### Decision 9: Private storage and coordinated deletion are part of ingestion

Create a dedicated private `experience-sources` bucket, not permanent public URLs in the existing generic bucket. New registry, revision, mapping, and staging tables have RLS enabled, no browser policies, and explicit service-role-only access. New RPC execution is revoked from PUBLIC/anon/authenticated.

The approved deployment is loopback-only locally or externally access-controlled. No user account system is introduced, but all experience APIs/file endpoints must share that trusted boundary. Reject cross-origin browser mutations using configured same-origin checks; loopback binding alone does not prevent a malicious website from submitting a browser request. RLS does not protect an unauthenticated server route using the service role; documentation must prohibit an unprotected public deployment.

Delete acquires the source lock, tombstones the source, clears its active pointer, explicitly deletes all mapped parents and their cascading children, removes revision/extraction/staging content, and retains only cleanup status/path until storage removal succeeds. Mapping-row deletion alone does not delete parent records, so a transactional deletion RPC must perform both.

Late index/extract/parse writes check the tombstone and execution token and cannot resurrect the source. A storage failure returns cleanup-pending status and supports idempotent DELETE retry; tombstoned IDs cannot be used for reparse/reindex. Only a fresh explicit upload after cleanup can recreate a source. Avoid source contents in logs; return stable error codes and safe diagnostics.

Alternative: rely on table RLS while exposing public API/file URLs, or silently ignore storage deletion errors. Rejected because neither meets private personal-source retention and observable cleanup.

## Risks / Trade-offs

- DOC conversion adds native runtime and security requirements -> Document/install LibreOffice, isolate execution, disable macros/external fetching, enforce deadlines, and require a real DOC acceptance fixture.
- PDF usability heuristics miss some corrupt extraction -> Retain both fallback behavior and final checks, expose exact source text and warnings during review, and block clearly unusable input.
- Constrained JSON still misinterprets source claims -> Mandatory human review, attribution/status fields, source references, and explicit unknown values; no claim that schema validation proves truth.
- Personal experience documents can exceed request/model limits -> Bound stages and prompt sizes, checkpoint embeddings, reject oversize text clearly, and defer arbitrary-size parsing.
- Extra registry/staging records add complexity -> Keep one canonical revision authority, one active pointer per source, transactional publication, and explicit ownership checks.
- Exact filtered vector ranking can become expensive -> Appropriate for a small personal corpus; measure before adding filtered-ANN complexity.
- Reviewer acknowledgement cannot prove extraction completeness -> Show unassigned blocks and original file access; record approval of an interpretation, not a guarantee of factual completeness.
- Source-grounded corrections cannot add missing facts directly -> Require a revised source upload in v1 rather than invent a second attestation provenance system.
- Mutable provider model aliases reduce repeatability -> Record configured/resolved model versions and use pinned versions for future benchmark baselines where available.

## Migration Plan

1. Confirm the completed foundation migrations are deployed on the intended development database. Do not replay them or change their design/spec files.
2. Add shared extraction/schema/planning modules and a narrowly scoped test runner for the new workflow; preserve generic extraction/API behavior through regression checks.
3. Apply additive registry/staging/publication/search/deletion migrations and create the private bucket. Verify grants, foreign keys, active-pointer invariants, and atomic rollback.
4. Install/verify converter binaries and document the Node-capable private deployment and configured execution limits.
5. Add staged experience APIs and Documents/detail review UI. Enable the feature only after migrations and runtime dependencies pass preflight.
6. Verify real DOCX/DOC/selectable-PDF extraction, source-linked review, approval, resumable embeddings, multi-parent publication, approved filtering, replacement, deletion, and generic compatibility.
7. Retain the accepted revision export/search contract as the dependency for the subsequent JD-fit proposal.

Rollback:

- Disable experience controls and APIs first; leave generic flows available.
- Prefer retaining registry/source/canonical revision data while removing new live publications through the coordinated lifecycle if needed.
- Do not drop the existing foundation tables/functions or delete standalone/generic evidence.
- Drop additive functions/tables/private storage only after explicitly confirming that source files and accepted revision history are no longer needed. Never describe a destructive rollback as routine preservation.
