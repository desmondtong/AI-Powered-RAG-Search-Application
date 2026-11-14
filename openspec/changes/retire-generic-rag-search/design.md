# Design

## Context

See proposal.md for motivation. The facts that shape the approach:

- Generic and experience code share two helper modules. `app/lib/gemini.ts` exports `createEmbedding`, `EMBEDDING_DIMENSIONS`, `GEMINI_EMBEDDING_MODEL`, `GEMINI_REQUEST_TIMEOUT_MS` (used by experience code) and `generateAnswer`, `GEMINI_MAX_OUTPUT_TOKENS`, `GEMINI_GENERATION_MODEL` (used only by the generic search route and its guard test). `app/lib/documentExtraction.ts` exports `normalizeExtractedText`, `isLikelyGarbledPdfText`, `extractTextWithPdftotext`, `extractTextWithPdf2Json` (used by experience extraction) and `splitTextIntoChunks`, `buildDocumentContext`, `extractTextFromGenericDocument` (used only by the generic upload route).
- No experience, JD-fit, or eval module imports a generic route or generic-only helper. The only cross-reference is the `generic` entry in `uploadUi.ts`, which the shared `UploadModal` selects by `kind`.
- Several tests exist specifically to prove isolation from generic code: `jdFit/readOnly.test.ts` scans JD-fit sources for forbidden tokens such as `generateAnswer`, `/api/search`, and `match_documents`, and imports `GEMINI_MAX_OUTPUT_TOKENS` to assert the generic helper's defaults; `ragQualityEvals/readOnly.test.ts` spies on `generateAnswer` as a "generic answer" seam. `searchPageContracts.test.ts` reads `app/api/search/route.ts` from disk and asserts it still uses `match_documents`.
- `tsconfig.experience-tests.json` compiles `app/api/upload/route.ts` into the experience test build, and `documentExtraction.test.ts` contains a "generic upload route regression" suite.
- The generic database objects (`documents` table, `match_documents` RPC, `documents` storage bucket) do not appear in any file under `supabase/migrations/`; they were created outside the repository and hold rows on the remote project. `supabase/rollback/evidence_index.sql` is scoped to the evidence model and explicitly leaves them alone.
- The change `add-rag-quality-evals` was archived on 2026-11-14, after this proposal was drafted, and synced a main spec `rag-quality-evals` that still frames evals beside generic search: a requirement "Generic workflow compatibility", a "generic documents are left untouched" clause in the "Seeded corpus lifecycle" reset scenario, and "generic-document" / "generic document" wording in "Read-only evaluation runner". The eval code it shipped also touches generic code in two tests: `ragQualityEvals/corpus/docx.test.ts` imports `extractTextFromGenericDocument`, and `ragQualityEvals/endToEnd.test.ts` reads `app/api/search/route.ts` from disk.
- Three older tests also depend on generic code or docs and were not in the original inventory: `experience/structuredGeneration.test.ts` imports `GEMINI_MAX_OUTPUT_TOKENS` and asserts its 512 default, `experience/documentsPageContracts.test.ts` asserts the Generic Documents section and `/api/documents` URLs are present in the Documents page, and `experience/apiContractDocs.test.ts` asserts the experience README still names the generic routes and says they "remain generic".
- The project's apply guidance requires a real-browser walkthrough for any user-facing change, so removal of UI surfaces is verified in the browser, not only by tests and build.

## Goals / Non-Goals

**Goals:**

- Leave no application code path, UI control, route, test, or document that refers to generic documents, generic search, or the two-model coexistence.
- Keep every experience and JD-fit behavior and test result unchanged except where a test's purpose was to protect generic behavior.
- Leave the remaining UI structurally intact (same pages, same navigation) so the redesign change starts from a known base.

**Non-Goals:**

- Renaming routes, pages, or navigation labels, or changing layout; that is the redesign change.
- Dropping or altering remote database objects or adding migrations.
- Refactoring the shared helper modules beyond deleting dead exports.
- Editing the archived `add-rag-quality-evals` artifacts; its synced main spec is modified through this change's own `rag-quality-evals` delta instead.

## Decisions

### Delete generic code outright rather than feature-flag it

Deletion, not a flag or a hidden route. The product direction is settled, the code has no remaining consumer, and a flag would keep the "two models" framing alive in specs and docs. Rollback is `git revert`; the retired routes have no external clients.

Alternative considered: keep `/api/search` as a hidden maintenance route for inspecting the orphaned `documents` table. Rejected because the table is being left for a separate decommission decision, and a route that exists only to read it would have to be documented, tested, and kept out of the redesign.

### Prune shared helpers to their surviving exports, do not relocate them

`gemini.ts` and `documentExtraction.ts` keep their paths and lose only the generic-only exports listed in Context. Moving the surviving functions under `app/lib/experience/` would touch every experience import for no behavioral gain and would conflict with the redesign change's file footprint.

### Rewrite isolation tests to assert absence, do not delete them

`jdFit/readOnly.test.ts` and `ragQualityEvals/readOnly.test.ts` currently prove "JD-fit and the eval runner never call generic code". After removal the stronger statement is "no generic code exists": the forbidden-token scans stay (they now also catch accidental reintroduction), the `GEMINI_MAX_OUTPUT_TOKENS` default assertion is removed with the constant, and the `generateAnswer` spy seam in the eval test is removed. `searchPageContracts.test.ts`, the generic cases in `uploadUi.test.ts`, the "generic search stays on `/api/search`" case in `jdFit/ui.test.ts`, and the generic suites in `documentExtraction.test.ts` are deleted because they can only pass if the generic code exists.

### Keep `UploadModal` keyed by `kind`, with `experience` as the only kind

The `DocumentsUploadKind` union collapses to `"experience"` and the `generic` config entry is removed. The modal keeps its `kind` prop defaulting to `"experience"` so the component's shape is unchanged for the redesign to replace or restyle. Removing the prop entirely is a redesign-time choice.

### Interim UI: remove surfaces, do not rearrange

`app/page.tsx` drops the mode tablist and the generic panel and renders the JD-fit panel directly; `app/documents/page.tsx` drops the Generic Documents section, the PDF viewer, and the generic upload modal. Headings and navigation labels ("Search", "Documents") stay as they are. The page will look unbalanced for the short window before the redesign; that is accepted over doing half a redesign here.

### Leave the orphaned database objects, record them, defer the drop

The `documents` table, `match_documents` RPC, and `documents` bucket stay. Reasons: they are not under repository migration control, the remote project is the only environment, the drop is irreversible, and the user has not authorized it. The README gains a short "Orphaned generic objects" note listing the three objects and stating that nothing in the application references them. A later change or an explicitly authorized operational step can drop them; `supabase/rollback/evidence_index.sql` is not that step and stays untouched.

### `rag-quality-evals` is modified by a delta in this change, not a follow-up

The original draft assumed `add-rag-quality-evals` would drop its generic requirement before it archived. It archived first, so `rag-quality-evals` now exists on main with that requirement. Because a main spec exists, this change can carry a fourth delta: REMOVE "Generic workflow compatibility", and MODIFY "Seeded corpus lifecycle" and "Read-only evaluation runner" only to drop their generic-document wording. The eval runner's behavioral guarantee is unchanged: it still mutates nothing, and the corpus `reset` still deletes only experience sources. No separate follow-up change is needed.

### Eval and experience tests that reach generic code are trimmed, not deleted

`ragQualityEvals/corpus/docx.test.ts` loses its final "generic documentExtraction path reads the same text" comparison; the experience-path round trip it exists for stays. `ragQualityEvals/endToEnd.test.ts` drops the "leaves generic search untouched" case entirely, since its only purpose was to read the retired route. `experience/structuredGeneration.test.ts` keeps its assertions that structured generation uses its own token limit and timeout, but compares against the literal legacy defaults rather than importing the removed constant. `experience/documentsPageContracts.test.ts` is rewritten to assert the Documents page has only the Experience section and no `/api/documents` reference. `experience/apiContractDocs.test.ts` drops its four generic-route assertions and keeps every experience route and error-code assertion.

### Misleading "generic" labels on evidence-index seams are renamed

Several eval tests and comments call `evidenceServer` functions (`insertProjectEvidence`, `deleteProjectEvidence`, `searchProjectEvidence`) the "generic documents" seam. Those functions belong to the evidence index and survive this change, so the label is wrong rather than dead. They are relabeled "evidence index" in `ragQualityEvals/readOnly.test.ts`, `ragQualityEvals/corpus/commands.test.ts`, and the `commands.ts` reset comment, and the JD-fit `generation.ts` comment stops contrasting itself with a helper that no longer exists. Fixture prose such as "Generic PDF extraction works" in `crossWorkflowAcceptance.test.ts` is test data, not a reference to the generic workflow, and is left alone.

### Spec Purpose lines are edited on main at apply time

The `Purpose` of `jd-fit-evaluation` says "without changing ingestion or generic search behavior". Delta specs cannot change Purpose, so the apply tasks include a direct edit of `openspec/specs/jd-fit-evaluation/spec.md` to drop the generic clause. `structured-project-ingestion` and `project-evidence-index` purposes do not mention generic search and are left alone.

## Risks / Trade-offs

- [A hidden consumer of a generic route or helper exists outside the grep surface, for example a browser bookmark, a script, or a Postman collection] → The routes have no documented external clients and the app is a private personal tool; `npm run build` and `npx tsc --noEmit` catch any in-repo import, and the browser walkthrough confirms the remaining pages make no request to a removed route.
- [Deleting the forbidden-token tests would weaken JD-fit isolation guarantees] → They are kept and now also guard against reintroduction; only assertions that require the generic code to exist are removed.
- [Another test outside the inventory reads a retired file from disk or imports a removed export] → Group 2 and 3 tasks each run the affected suite immediately after the deletion, and the final grep in 6.2 covers test files as well as source.
- [Orphaned remote data is forgotten and later mistaken for live data] → The README note names the three objects and their status; the decommission decision is recorded as explicitly deferred, not omitted.
- [The interim home page is a single panel with a now-meaningless "Search" nav label] → Accepted; the redesign change follows immediately and owns naming and layout.
