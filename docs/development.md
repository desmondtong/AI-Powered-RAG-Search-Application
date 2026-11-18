# Contributor tooling

Notes for working on the codebase with an agent or IDE. Setup and the main workflow are in the [README](../README.md#running-locally).

## Supabase MCP

To let your agent or IDE inspect the database, connect it to the project-scoped, read-only Supabase MCP server, replacing `<project-ref>` with your Supabase project's reference ID:

```
https://mcp.supabase.com/mcp?project_ref=<project-ref>&read_only=true
```

Authenticate using the Supabase login flow when prompted, selecting the organization that owns the project. Do not put the application's service-role key in any MCP configuration, and never commit credentials.

Verify the connection by asking: "Use Supabase MCP to list this project's tables." Remove `&read_only=true` only when you intentionally need write access, such as applying migrations with the MCP `apply_migration` tool, and use a development project rather than production.

See the [Supabase MCP documentation](https://supabase.com/docs/guides/getting-started/mcp).

## Legacy objects on the remote project

The retired generic document search left a `documents` table, a `match_documents` function and a `documents` bucket on the remote project. Nothing references them, they were created outside `supabase/migrations/`, and they are kept only until a separate decommission drops them.

## README images

`npm run capture:screenshots` rebuilds the app with placeholder credentials, serves it on port 3035, and writes the screenshots and demo GIFs in `docs/images/`. Every API call is answered in the browser from synthetic data, so it never reaches Supabase or Gemini. The GIFs need `ffmpeg` on `PATH`. To capture from a server that is already running, set `CAPTURE_URL=http://127.0.0.1:<port>`. It is not part of CI.

## Verification reports

[`docs/verification/`](verification/) keeps the remote database verification reports referenced from [app/lib/experience/README.md](../app/lib/experience/README.md).
