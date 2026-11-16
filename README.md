# JD Fit Check

A personal job-fit tool built on [Next.js](https://nextjs.org). You upload your own experience files (DOCX or selectable-text PDF), review the source-grounded draft the app extracts from each one, and approve and index it as evidence. You then paste a job description, and the app evaluates each of its requirements against that approved evidence, returning a categorical fit report in which every claim cites the source text it came from.

## Pages

The top bar has two destinations and a pill counting the indexed files.

- **Fit Check** (`/`). Paste a job description and choose "Evaluate fit". The report groups requirements as Strong, Partial, Weak or Missing and cites the exact sentence in your file for every claim. "Open in source" opens that sentence on the file's page.
- **Experience** (`/experience`). Upload a DOCX or selectable-text PDF in the "Upload experience file" drop zone. Each file then has its own page, `/experience/[id]`, that walks it through six stages: Upload, Extract, Parse, Review, Approve and Index. Indexing starts only when you choose "Index now". A collapsed "How it works" section on the list explains the stages.

**Feedback.** A button whose request is running shows a spinner and keeps its colour; a greyed button is one you cannot use yet. When an action succeeds, a short notice appears at the bottom left for about five seconds, for example "Draft saved." or "Version 2 is searchable in Fit Check." Removing an evidence item or a source span in review can be undone from its notice. Errors never appear as notices: they stay on the page next to what failed. On the Fit Check report, the four count tiles filter the requirement cards.

Bookmarks to the previous list and review URLs permanently redirect to these pages. The light and dark themes follow your operating-system setting.

## Environment

Create `.env.local` with:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
GEMINI_API_KEY=your-google-ai-studio-key
```

`GOOGLE_API_KEY` also works if you prefer that variable name. The app uses `gemini-embedding-001` with `outputDimensionality: 1536`, so it can use the existing Supabase `embedding vector(1536)` schema.

`SUPABASE_SERVICE_ROLE_KEY` is required by the server API routes for experience ingestion, deletes, private storage access, and vector search. Keep it server-only; never prefix it with `NEXT_PUBLIC_`.

For more reliable PDF parsing, install Poppler and expose its `pdftotext` binary. If it is not on `PATH`, set:

```bash
PDFTOTEXT_PATH=/absolute/path/to/pdftotext
```

The app falls back to `pdf2json` when `pdftotext` is unavailable, but some PDFs with custom embedded fonts parse much more cleanly through Poppler.

Optional model overrides:

```bash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
GEMINI_GENERATION_MODEL=gemini-flash-lite-latest
```

## Evidence Index

The evidence index is the application's only retrieval model:

- `parent_documents` holds project or project-section context, source file
  identity, source file name/type, and JSON metadata.
- `document_chunks` holds exact citation text (`child_text`), contextual embedding
  input (`embedding_text`), a 1536-dimensional vector, metadata, and chunk order.
  Each child references one parent; deleting that parent cascades to its chunks.

The Experience pages are backed by a separate registry that tracks each file
through the six stages: `experience_sources`, `experience_extractions`,
`experience_revisions`, `experience_revision_parents`, and
`experience_index_staging`. Its migrations live alongside the evidence ones in
`supabase/migrations/`.

Apply the SQL files in `supabase/migrations/` in filename order using the
Supabase SQL editor or the MCP `apply_migration` tool with write access enabled
on a development project. Do not reapply migrations already recorded there.
The migration supports pgvector installed in either `public` or `extensions`.
It creates a cosine HNSW index and maintains `updated_at` on row updates.

The evidence tables have RLS enabled and no browser access policies. Only the
server service role is granted table access and evidence RPC execution. Never
call evidence helpers from client components or expose the service-role key.
Source identifiers are text rather than a foreign key, so several evidence
parents can share one source file.

The server helpers in `app/lib/evidenceServer.ts` insert a parent and its chunks
atomically, embed only `embedding_text`, search via `match_document_chunks`,
expand matched parents, and delete evidence parents. They do not perform
structured LLM extraction or JD-fit evaluation. Metadata and embedding headers must come from the source
or trusted user-provided fields, not invented claims.

`supabase/checks/` holds smoke checks you can run in the SQL editor or via MCP
`execute_sql`; each rolls back its own data. `evidence_index.sql` seeds a
vector-search and lifecycle check, and the `experience_*.sql` files cover the
experience registry, retry lifecycle and guards, and index-execution fencing.
The corresponding rollback SQL is in
`supabase/rollback/evidence_index.sql`; it deletes the new evidence model,
so use it only after disabling evidence callers and confirming that no evidence
data needs preservation. It leaves the orphaned objects below untouched.

### Orphaned generic objects

The retired generic document search left three objects on the remote Supabase
project. Nothing in the application references them, and they are kept only
until a separately authorized decommission decides whether to drop them:

- the `documents` table and its existing rows,
- the `match_documents` RPC,
- the `documents` storage bucket.

They were created outside `supabase/migrations/`, so no migration or rollback
script in this repository manages them.

## Getting Started

### Supabase MCP

To let your agent or IDE inspect the database, connect it to the project-scoped,
read-only Supabase MCP server:

```
https://mcp.supabase.com/mcp?project_ref=lwljmmfcvmbnrfstltzj&read_only=true
```

Authenticate using the Supabase login flow when prompted, selecting the
organization that owns this project. Do not put the application's service-role
key in any MCP configuration, and never commit credentials.

Verify the connection by asking: "Use Supabase MCP to list this project's
tables." Remove `&read_only=true` only when you intentionally need write
access, such as applying migrations, and use a development project rather
than production.

See the [Supabase MCP documentation](https://supabase.com/docs/guides/getting-started/mcp).

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to load Nunito Sans (headings) and Source Sans 3 (body text) from Google Fonts.

See the [Next.js documentation](https://nextjs.org/docs) for framework details and [deployment options](https://nextjs.org/docs/app/building-your-application/deploying).
