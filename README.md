This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment

Create `.env.local` with:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=your-supabase-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
GEMINI_API_KEY=your-google-ai-studio-key
```

`GOOGLE_API_KEY` also works if you prefer that variable name. The app uses `gemini-embedding-001` with `outputDimensionality: 1536`, so it can use the existing Supabase `embedding vector(1536)` schema.

`SUPABASE_SERVICE_ROLE_KEY` is required by the server API routes for document inserts, deletes, storage access, and vector search. Keep it server-only; never prefix it with `NEXT_PUBLIC_`.

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

The two document models coexist:

- `documents` and `match_documents` continue to serve generic `/api/upload`,
  `/api/search`, and `/api/documents`. Existing rows are not migrated.
- `parent_documents` holds project or project-section context, source file
  identity, source file name/type, and JSON metadata.
- `document_chunks` holds exact citation text (`child_text`), contextual embedding
  input (`embedding_text`), a 1536-dimensional vector, metadata, and chunk order.
  Each child references one parent; deleting that parent cascades to its chunks.

Apply the SQL files in `supabase/migrations/` in filename order using the
Supabase SQL editor or the MCP `apply_migration` tool with write access enabled
on a development project. Do not reapply migrations already recorded there.
The migration supports pgvector installed in either `public` or `extensions`.
It creates a cosine HNSW index and maintains `updated_at` on row updates.

The evidence tables have RLS enabled and no browser access policies. Only the
server service role is granted table access and evidence RPC execution. Never
call evidence helpers from client components or expose the service-role key.
Source identifiers are text rather than a foreign key to `documents`: generic
rows represent chunks, and several evidence parents can share one source file.

The server helpers in `app/lib/evidenceServer.ts` insert a parent and its chunks
atomically, embed only `embedding_text`, search via `match_document_chunks`,
expand matched parents, and delete evidence parents. They do not perform
structured LLM extraction, JD-fit evaluation, or route generic uploads into
the evidence model. Metadata and embedding headers must come from the source
or trusted user-provided fields, not invented claims.

Run `supabase/checks/evidence_index.sql` in the SQL editor or via MCP
`execute_sql` for a seeded vector-search and lifecycle smoke check. It rolls
back its own data. The corresponding rollback SQL is in
`supabase/rollback/evidence_index.sql`; it deletes the new evidence model,
so use it only after disabling evidence callers and confirming that no evidence
data needs preservation. It leaves generic data, storage, and `match_documents`
untouched.

## Getting Started

### Supabase MCP (TRAE)

In **Settings > MCP**, enable **Project MCP**. Create `.trae/mcp.json`
with the following project-scoped, read-only configuration:

```json
{
  "mcpServers": {
    "supabase": {
      "url": "https://mcp.supabase.com/mcp?project_ref=lwljmmfcvmbnrfstltzj&read_only=true"
    }
  }
}
```

Authenticate the server using the Supabase login flow when prompted, selecting
the organization that owns this project. Do not put the application's
publishable key or service-role key in the MCP configuration. If the client
does not offer a login flow, complete authentication using a supported MCP
client rather than committing credentials.

Verify the connection by asking: "Use Supabase MCP to list this project's
tables." The server is read-only by default. Remove `&read_only=true` only
when you intentionally need write access, such as applying migrations, and
use a development project rather than production.

See the [Supabase MCP documentation](https://supabase.com/docs/guides/getting-started/mcp)
and [TRAE project MCP setup](https://docs.trae.ai/ide/add-mcp-servers).

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

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
