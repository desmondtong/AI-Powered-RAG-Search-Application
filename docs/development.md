# Development

How changes are made and checked, plus agent and IDE tooling. Setup and the main workflow are in the [README](../README.md#running-locally).

## Branches and CI

Work is organised around OpenSpec changes, and the git rules follow from that.

- **One branch per change, named after the change id.** Cut it from `main` before the proposal is committed:

  ```bash
  git switch -c <change-id> main
  ```

- **All three commits land on the branch**: `docs: propose <change-id>`, the implementation, and `chore: archive <change-id>` as the last commit. `main` therefore never holds an active change.
- **`main` is updated only through a pull request**, merged with "rebase and merge" once all required CI checks are green. The branch is deleted on merge, locally and on origin.
- **Parallel changes use one git worktree each**, outside the repository, with its own install and env file:

  ```bash
  git worktree add ../rag-worktrees/<change-id> -b <change-id> main
  cp .env.local ../rag-worktrees/<change-id>/.env.local
  (cd ../rag-worktrees/<change-id> && npm ci)
  ```

  Every worktree shares the same remote Supabase project, so only one in-flight change may touch `supabase/` at a time. A second worktree running the browser test needs its own port: `EXPERIENCE_PREVIEW_PORT=3034 npm run test:browser`.

CI runs on every pull request and on pushes to `main` ([ci.yml](../.github/workflows/ci.yml)). Three jobs are required checks, and a fourth deploys `main`:

| Job | Runs |
| --- | --- |
| `checks` | `npm run test:experience`, `npm run test:jd-fit`, `npm run test:rag-eval`, `npm run eval:rag` (offline retrieval-quality eval), `openspec validate --all`, `npm run lint`, `npx tsc --noEmit`, `npm run build` |
| `browser` | `npx playwright install --with-deps chromium`, then `npm run test:browser` |
| `image` | `docker build` of the production image, then checks that `pdftotext` is present, that no secret or Supabase URL is baked in, and that the server answers |
| `deploy` | Only on `main`, after the three jobs pass and once the GCP repository variables exist: pushes the image and deploys it to Cloud Run ([docs/deploy.md](deploy.md)) |

`npm run test:browser` builds the app, serves it on port 3033, drives the four indexing-conflict scenarios and the oversized-upload check in headless Chromium with every API call intercepted, and stops the server. It never reaches Supabase or Gemini, so CI uses placeholder values for the environment variables the build reads. The live RAG eval, corpus seeding and the SQL checks in `supabase/checks` need the real project and stay manual.

A new test file inside an existing suite's folder runs in CI automatically. A new suite or job needs a step in `ci.yml`, and a new job also needs adding to the required checks on `main`. Locally, install the browser once with `npx playwright install chromium`; if a server is left behind after an interrupted run, `lsof -i :3033` finds it.

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
