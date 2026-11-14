# Proposal

## Why

The generic document RAG search (upload any PDF/DOCX/TXT, chunk it, ask free-form questions) was the app's first incarnation. The product has since become a single workflow: ingest personal experience files, review source-grounded drafts, approve and index them, and evaluate pasted job descriptions against that approved evidence. Generic search now competes with that workflow for the home page, the navigation, and the upload modal, and every accepted spec still carries a requirement that protects it. Removing it before the planned UI redesign gives that redesign a single-product codebase and single-product specs to build on.

## What Changes

- **BREAKING** Remove the generic search workflow from the application: the `Search documents` mode on the home page, the `Generic Documents` section of the Documents page, the generic variant of the upload modal, and the PDF/text preview modal that only generic documents used.
- **BREAKING** Remove the generic API routes `POST /api/upload`, `POST /api/search`, and `GET|DELETE /api/documents`. The experience and JD-fit routes under `/api/experiences` and `/api/jd-fit` are unchanged.
- Remove generic-only helpers that no remaining caller uses: the generic answer generation helper and the generic chunking, document-context, and generic-file extraction helpers. Shared helpers that experience ingestion depends on (embedding creation, model constants, text normalization, garbled-PDF detection, the pdftotext and pdf2json extractors) stay in place.
- Remove or rewrite tests whose purpose is to protect generic behavior: the generic search page contract, the Documents page contract, the generic upload UI contract, the generic extraction and upload-route regressions, the experience README contract's generic-route assertions, the "generic search stays on `/api/search`" assertions inside the JD-fit UI tests, the structured-generation test's dependence on the generic token-limit constant, and the two eval tests that import a generic extractor or read the generic search route. Isolation tests that assert JD-fit and the eval runner never call generic code are rewritten to assert the generic code no longer exists.
- Rewrite the README and the experience module README so they describe one product and stop documenting the coexistence of two document models.
- Leave the generic database objects (`documents` table, `match_documents` RPC, `documents` storage bucket) in place on the remote project. They were created outside this repository's migrations and hold existing rows; this change documents them as orphaned and defers their removal to a separately authorized step. Nothing in the application references them after this change.

Out of scope:

- Any change to experience ingestion, approved search, JD-fit evaluation, or their API contracts.
- Dropping remote database tables, functions, or storage buckets, or adding migrations.
- The UI redesign of the remaining workflow; that is a separate follow-up change.
- Changes to the archived `add-rag-quality-evals` change; its synced main spec is modified through this change's own delta.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `project-evidence-index`: remove the requirement "Existing generic RAG compatibility"; the evidence index no longer has a generic flow to coexist with.
- `structured-project-ingestion`: remove the requirement "Generic workflow compatibility" and rewrite "Separate experience upload workflow" so it describes the experience upload on its own terms rather than as separate from a generic upload that no longer exists.
- `jd-fit-evaluation`: remove the requirement "Generic search compatibility"; rewrite "Explicit JD-fit workflow" as the application's primary workflow and drop the scenario where the user stays in generic search; rewrite the "No active approved evidence exists" scenario so it no longer refers to generic document chunks.
- `rag-quality-evals`: remove the requirement "Generic workflow compatibility"; reword the "Reset runs" scenario of "Seeded corpus lifecycle" and the "Read-only evaluation runner" requirement so they describe the evidence index rather than generic documents. The runner's mutate-nothing guarantee is unchanged.

## Impact

- **Removed code**: `app/api/upload/route.ts`, `app/api/search/route.ts`, `app/api/documents/route.ts`, `app/components/PDFViewerModal.tsx`, the `generic` upload kind in `app/lib/experience/uploadUi.ts` and `app/components/UploadModal.tsx`, the generic tab and panel in `app/page.tsx`, and the Generic Documents section in `app/documents/page.tsx`.
- **Pruned shared modules**: `app/lib/gemini.ts` loses `generateAnswer`, `GEMINI_MAX_OUTPUT_TOKENS`, and the exported `GEMINI_GENERATION_MODEL` constant (experience and JD-fit code read that environment variable directly and import only `createEmbedding`, `EMBEDDING_DIMENSIONS`, and `GEMINI_EMBEDDING_MODEL`); `app/lib/documentExtraction.ts` loses `splitTextIntoChunks`, `buildDocumentContext`, and `extractTextFromGenericDocument`.
- **Tests and test config**: `tsconfig.experience-tests.json` stops including `app/api/upload/route.ts`; `searchPageContracts.test.ts`, `documentsPageContracts.test.ts`, `uploadUi.test.ts`, `documentExtraction.test.ts`, `apiContractDocs.test.ts`, `structuredGeneration.test.ts`, `jdFit/ui.test.ts`, `jdFit/readOnly.test.ts`, `ragQualityEvals/readOnly.test.ts`, `ragQualityEvals/endToEnd.test.ts`, `ragQualityEvals/corpus/docx.test.ts`, and `ragQualityEvals/corpus/commands.test.ts` are removed, trimmed, relabeled, or rewritten as described in the design.
- **Docs**: `README.md` and `app/lib/experience/README.md` drop the two-model framing and the generic route table entries.
- **`rag-quality-evals` spec**: `add-rag-quality-evals` archived on 2026-11-14 with its "Generic workflow compatibility" requirement intact, so that requirement and two generic-document phrasings now live in the main `rag-quality-evals` spec. This change removes them through its own delta; no follow-up change is needed.
- **Interim UI state**: until the redesign change lands, the home page shows only the JD-fit panel and the Documents page shows only the Experience section. Navigation labels are left as they are; renaming belongs to the redesign.
- **Database**: no migrations. The orphaned generic objects are listed in the design for a later, separately authorized decommission.
