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

## Getting Started

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
