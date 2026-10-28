# Proposal

## Why

The evidence index can store and retrieve project parents and focused child chunks, but users cannot yet turn experience files into that model. This change adds source-grounded LLM organization and human approval so later JD-fit RAG can use trustworthy, traceable experience rather than unreviewed generated claims.

## What Changes

- Add a separate experience upload workflow for DOCX, legacy DOC, and selectable-text PDF; preserve the existing generic PDF/DOCX/TXT flow.
- Reuse existing PDF normalization and extraction fallbacks, reject unusable extraction before parsing, and support DOC through an explicitly documented local conversion dependency. Scanned PDFs and OCR are out of scope.
- Persist private source files, normalized source blocks, versioned structured JSON, extraction provenance, and review/indexing states.
- Use schema-constrained Gemini extraction to organize projects and general responsibilities, retaining source references for populated fields and focused evidence items. Unknown facts remain unknown.
- Require a source-linked review and correction step before approval. Approval freezes an exact revision; it does not by itself mean indexing succeeded.
- Build parent context and exact child citation spans from approved source references, while generating embeddings from truthful contextual headers plus those spans.
- Publish a complete document revision atomically, with bounded resumable embedding preparation, idempotent retries, and safe replacement/deletion behavior.
- Provide an ingestion-owned search eligibility boundary for active, approved, indexed revisions, with optional selected-source filtering before top-K retrieval. Keep the existing evidence RPC and generic search API compatible.
- Establish logical evidence IDs, immutable revision hashes, and model/prompt/parser/chunking versions for downstream citation resolution and reproducible quality evaluations.

Out of scope:

- JD parsing, requirement-level RAG, categorical fit reports, or changes to the Search page. Those belong to `add-jd-fit-evaluation`.
- Numeric fit scores, resume advice, multi-user accounts, OCR, unbounded background processing, or a formal RAG evaluation suite.
- Automatic migration of existing generic uploads or changes to the completed evidence-index planning artifacts.

## Capabilities

### New Capabilities

- `structured-project-ingestion`: Converts experience files into persisted, source-linked structured revisions, requires human review, and manages publication of approved revisions into the parent/child evidence index.

### Modified Capabilities

- None. Main specs are currently empty. The completed but unarchived `project-evidence-index` change is a dependency and remains unchanged; this capability adds ingestion-specific lifecycle and eligibility contracts without redefining generic evidence storage.

## Impact

- Frontend: an Experience section within the Documents page, separate upload/review/status components, and source-linked revision details. Existing generic document controls remain available.
- Server: dedicated experience upload, extraction, parsing, review, approval, indexing, list/detail/file, and deletion handlers; shared extraction utilities; dedicated structured-generation configuration rather than the generic answer helper.
- Database: additive source/revision/publication/staging records and transactional publication/deletion/search functions around the existing `parent_documents` and `document_chunks` tables.
- Dependencies: a runtime JSON validator and a bounded LibreOffice headless DOC-to-DOCX conversion adapter. PDF continues to prefer Poppler with `pdf2json` fallback; DOCX continues to use Mammoth.
- Operations: private Supabase Storage for experience files, server-only service-role access, local/private deployment, explicit input and execution limits, and documented converter installation.
- Dependency: the implemented `add-evidence-index-data-model` migrations and helpers must be present. No foundation redesign, generic API break, or live database modification occurs during proposal creation.
