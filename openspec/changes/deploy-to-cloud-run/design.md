# Design

## Context

See proposal.md for motivation. Facts that shape the approach:

- **App shape.** Next.js 16.4.6 (App Router, `cacheComponents`, webpack build via `npm run build`), Node 26.2.0 (`.nvmrc`). All data lives in the remote Supabase project in `ap-southeast-2`: Postgres with pgvector RPCs, plus Storage for source files. Gemini is called with an AI Studio API key. There are no scheduled jobs and no background workers.
- **Pipeline timing.** Each stage is one bounded request. Extraction is `pdftotext` (10 s) plus one structured call (120 s). Parsing is one 120 s call. Indexing runs one batch of up to 3 chunks within 75 s per request, and the browser repeats the request until done. Execution leases of 90 s and 180 s make an abandoned stage retryable. Client fetches set no timeout.
- **`pdftotext` is a system binary** ([documentExtraction.ts](../../../app/lib/documentExtraction.ts)), found on `PATH` or through `PDFTOTEXT_PATH`. Without it, PDFs fall back to `pdf2json`.
- **Same-origin guard.** [apiRoutes.ts](../../../app/lib/experience/apiRoutes.ts) rejects a mutation when the `Origin` header differs from `new URL(req.url).origin`. On Cloud Run, TLS ends at Google's front end and the container receives plain HTTP. If `req.url` reports `http://`, every POST from `https://…run.app` would be rejected with 403.
- **Public environment variables are inlined into server code.** Next replaces `process.env.NEXT_PUBLIC_*` in every compiler, server included, whenever the variable is set during `next build` (`next/dist/lib/static-env.js`). [supabaseServer.ts](../../../app/lib/supabaseServer.ts) reads `NEXT_PUBLIC_SUPABASE_URL` on the server only.
- **Existing CI.** `.github/workflows/ci.yml` runs `checks` and `browser` on pull requests and on pushes to `main`, using placeholder secrets. The repository is **public**, so its workflows must never hold deploy credentials that a pull request could reach.
- **Upload limit.** The server already rejects files over 10 MB (`EXPERIENCE_EXTRACTION_LIMITS.maxUploadBytes`) with `file-too-large`. Cloud Run refuses HTTP/1 request bodies over 32 MB before the app sees them, returning a non-JSON error.
- **Owner context.** The project has no Google Cloud organization. The owner account is `kingdesmond1995@gmail.com`, and billing account `01C6B1-0F539E-43ED31` (SGD) holds the monthly AI Pro credit, scoped to all of GCP.

## Goals / Non-Goals

**Goals:**
- One reproducible container that runs the same locally (where Docker is available), in CI and on Cloud Run.
- Keyless, branch-locked deployment from GitHub Actions.
- A private service that needs no application code for access control.
- Every one-time setup step written down, so the project can be rebuilt from the guide.

**Non-Goals:**
- Infrastructure as code (Terraform or Pulumi). The resource count is small and mostly one-time. A command-by-command setup guide is enough for now.
- Custom domain, CDN, load balancer, staging service, Vertex AI, user accounts.
- Changing pipeline timing, batch sizes or lease lengths.

## Decisions

### 1. Build in GitHub Actions and push to Artifact Registry, not `gcloud run deploy --source`

The deploy job runs `docker build` on the GitHub runner, pushes `australia-southeast1-docker.pkg.dev/jd-fit-check/app/web:<sha>`, then runs `gcloud run deploy --image …`.

- *Why:* The runner already has Docker, and its minutes are free for public repositories. Cloud Build is not needed, so neither are its service account or roles. The image tag is the commit SHA, which provides the traceability required by the spec. The same `docker build` works on any machine with Docker.
- *Alternative:* `gcloud run deploy --source .` through Cloud Build. Rejected because it adds a second build identity and another service to secure, and building in GitHub has no drawback here.
- *Alternative:* a Cloud Build trigger on pushes to `main`. Rejected because it would deploy without waiting for the GitHub CI jobs, which breaks "a push whose CI fails is not deployed".

### 2. Deploy job lives in `ci.yml` and needs both CI jobs

Add a `deploy` job to `ci.yml` with `needs: [checks, browser]` and `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`. It holds `permissions: { contents: read, id-token: write }`, and only this job gets `id-token: write`. Also allow `workflow_dispatch` on `main`, for the first deploy and for redeploys.

- *Why:* A job dependency in the same workflow is the simplest way to guarantee that CI passed for the exact commit. A separate `workflow_run` workflow would work too, but it is harder to read and runs on the default branch's definition, which makes it harder to reason about.

### 3. Workload Identity Federation, locked to repository and branch

- A workload identity pool `github` with an OIDC provider for `https://token.actions.githubusercontent.com`.
- Attribute condition: `assertion.repository == 'desmondtong/AI-Powered-RAG-Search-Application' && assertion.ref == 'refs/heads/main'`.
- A deployer service account `github-deployer@jd-fit-check.iam.gserviceaccount.com` that this pool may impersonate.
- Deployer roles:
  - `roles/run.developer` on the project.
  - `roles/artifactregistry.writer` on the `app` repository only.
  - `roles/iam.serviceAccountUser` on the runtime service account only.
- GitHub repository **variables** (not secrets) hold the project ID, region, provider resource name and deployer email. None of them is a credential.

- *Why:* The repository is public. With this condition, pull requests, other branches and forks cannot mint a token, which meets the spec's "only `main` can deploy". No JSON key exists that could leak.
- *Alternative:* a service-account key in GitHub secrets. Rejected because a long-lived credential is the first thing to leak, and Google discourages it.

### 4. Runtime identity and secrets

- Runtime service account `jd-fit-runtime@…`, with no project-level roles.
- Secret Manager secrets `supabase-service-role-key` and `gemini-api-key`, created with automatic replication. The runtime service account gets `roles/secretmanager.secretAccessor` on those two secrets only.
- The service maps them as environment variables pinned to `:latest` (`--set-secrets SUPABASE_SERVICE_ROLE_KEY=supabase-service-role-key:latest,GEMINI_API_KEY=gemini-api-key:latest`). Cloud Run resolves `latest` when an instance starts, so a rotated secret takes effect on the next deploy or restart, as the spec requires.
- Non-secret configuration is plain environment variables set on the service: `NEXT_PUBLIC_SUPABASE_URL`, and optionally the `GEMINI_*` model names and `JD_FIT_MODEL`.

### 5. Container: multi-stage, standalone, Poppler in the runtime stage

- `next.config.ts` gains `output: "standalone"`.
- Build stage: `node:26.2.0-bookworm-slim`, `npm ci`, then `npm run build`, **with no `NEXT_PUBLIC_*` set**, so the Supabase URL stays a runtime read (see Context). The build stage also gets no Supabase key or Gemini key.
- Runtime stage: `node:26.2.0-bookworm-slim` plus `apt-get install --no-install-recommends poppler-utils`. It copies `.next/standalone`, `.next/static` and `public`, runs as the non-root `node` user with `HOSTNAME=0.0.0.0`, and starts with `node server.js`. Cloud Run supplies `PORT`.
- `.dockerignore` excludes `node_modules`, `.next`, `.env*`, test build folders, `.git`, `.claude`, `openspec` and `supabase`.
- *Verification built into tasks:*
  - The build succeeds without `NEXT_PUBLIC_SUPABASE_URL`.
  - `grep` over `.next/standalone` finds no Supabase URL or placeholder URL.
  - `pdftotext -v` runs inside the image.
  - Uploading a PDF on the hosted service records the Poppler extraction path.
- *Fallback if the build needs the URL:* add a server-only `SUPABASE_URL` to [supabaseServer.ts](../../../app/lib/supabaseServer.ts) that takes precedence over `NEXT_PUBLIC_SUPABASE_URL`, and keep the existing name working locally.

### 6. Cloud Run service settings

`jd-fit-check` in `australia-southeast1`:
- `--timeout=600`, `--memory=1Gi`, `--cpu=1`, `--min-instances=0`, `--max-instances=2`.
- Default concurrency (80) and request-based billing (CPU throttled outside requests).
- `--service-account=jd-fit-runtime@…`, `--no-allow-unauthenticated`, ingress `all`.

- *Why:* 10 minutes covers the 120 s stages with room to spare. Memory covers `pdftotext` plus in-memory DOCX expansion, which is capped at 50 MB. Two instances bound cost, and personal traffic never needs more. Request-based billing is correct because no work continues after a response is sent.
- *Alternative:* `min-instances=1` to avoid cold starts. Rejected: about US$10–15 a month of idle cost for a 1–3 s cold start on a personal tool.

### 7. IAP directly on Cloud Run

- Enable IAP on the service with `gcloud beta run services update jd-fit-check --iap` (or the console toggle). No load balancer is used.
- The project has no organization, so IAP needs a **custom OAuth client**:
  - Configure an External consent screen (app name "JD Fit Check", user type External, publishing status Testing, test user `kingdesmond1995@gmail.com`).
  - Create a Web OAuth client.
  - Point IAP's settings for the service at that client.
  - Google has deprecated the API for creating IAP OAuth clients, so these are owner-run console steps, recorded in the guide.
- Grant `roles/iap.httpsResourceAccessor` on the service to `user:kingdesmond1995@gmail.com`.
- Grant the IAP service agent (`service-<number>@gcp-sa-iap.iam.gserviceaccount.com`) `roles/run.invoker` on the service.

- *Why:* This needs zero application code and costs nothing extra. It stops anonymous traffic before Next runs, which is the property the spec requires, given the service-role key behind every route.
- *Risk handled below:* IAP blocks unauthenticated health and smoke checks too, so post-deploy checks use Cloud Run's revision status, not an HTTP probe.

### 8. Hosting-safe origin check: verify first, then fix only if needed

- First verify on the deployed service: save a draft from the hosted page and check that it does not return 403 `cross-origin-rejected`. Next's server may already rebuild `req.url` from `x-forwarded-proto` and `host`, which Cloud Run's front end sets and overwrites.
- If it fails, change `assertSameOriginMutation` and `assertTrustedReadBoundary` to compare `Origin` with an expected origin built from `x-forwarded-proto` (first value) and `x-forwarded-host` or `host`, falling back to `req.url`. Add tests in `app/lib/experience` covering:
  - an https `Origin` against an http `req.url` with `x-forwarded-proto: https` (accepted);
  - a different host (rejected);
  - no forwarded headers (unchanged behavior).
- *Why trusting forwarded headers is acceptable:* Cloud Run's front end overwrites them, and behind IAP only the owner reaches the app. Locally, a spoofed header would weaken the check only for the person spoofing it.

### 9. Deployment identifier

- Set `deploymentId: process.env.NEXT_DEPLOYMENT_ID` in `next.config.ts`.
- The Docker build receives `--build-arg NEXT_DEPLOYMENT_ID=<sha>`, set as `ENV` in the build stage only.
- Unset locally and in the CI check jobs, which keeps current behavior.
- *Why:* Next then appends `?dpl=` to assets, sends `x-deployment-id`, and does a hard reload when the deployed version changes. That meets "Consistent client version across deploys" without a shared cache.

### 10. Early upload size check

- `uploadUi.ts` exports the upload limit, the same 10 MB value as `EXPERIENCE_EXTRACTION_LIMITS.maxUploadBytes`, imported from a module that is safe to load in the browser, plus a message builder ("This file is larger than 10 MB. Upload a smaller or split document.").
- `DropZone.upload` checks `file.size` before building the `FormData`, shows the message, and returns without fetching.
- The server check stays authoritative.
- Contract tests sit beside the existing upload UI tests. The browser walkthrough covers the oversized case.

### 11. Budget

- Create a budget on billing account `01C6B1-0F539E-43ED31`, filtered to project `jd-fit-check`.
- Amount S$15 per month. Thresholds 0.5, 0.9 and 1.0 on current spend, with credits included so the alerts track what is actually charged.
- Notifications go to the billing account's admins by default.

### 12. Artifact Registry cleanup

- Docker repository `app` in `australia-southeast1`.
- Cleanup policy: keep the 5 most recent versions of `web`, and delete untagged images older than 7 days.
- Keeps storage inside the 0.5 GB free tier.

## Risks / Trade-offs

- **[The origin check rejects hosted mutations]** → Verified on the first deploy (Decision 8). The fix is small and tested, and until then the owner can only read.
- **[Build needs `NEXT_PUBLIC_SUPABASE_URL`]** → Fall back to the server-only `SUPABASE_URL` (Decision 5). Detected by the first local or CI Docker build.
- **[IAP OAuth client steps change in the console]** → The guide records intent and the fields to set, not screenshots. The steps are one-time and verified by the "unknown visitor is refused" check from a signed-out browser.
- **[Cold start of 1–3 s after idle]** → Accepted for a personal tool. Revisit with `min-instances=1` if it becomes annoying.
- **[Gemini free-tier data use and rate limits apply in production]** → Accepted for now, because only the owner can reach the app. The Vertex AI move is a separate change.
- **[Docker is not installed on the owner's Mac]** → All builds run in GitHub Actions. The first deploy uses `workflow_dispatch` on `main` after merge, so local Docker is optional.
- **[A deploy breaks the running app]** → Cloud Run keeps earlier revisions. Rollback is `gcloud run services update-traffic jd-fit-check --to-revisions=<previous>=100`, recorded in the guide.
- **[Same project billed by a different account later]** → The guide notes that the AI Pro credit applies only while the project stays on billing account `01C6B1-…`.

## Migration Plan

1. **One-time GCP setup.** Run by the owner, or by the agent with the owner's approval for each billable or outward-facing step.
   - Create the project and link billing.
   - Enable the APIs: Run, Artifact Registry, Secret Manager, IAP, IAM Credentials, STS and Billing Budgets.
   - Create the repository, secrets, service accounts, WIF pool and provider, and budget.
2. **Merge to `main`.** Merge this change's pull request. CI runs. The deploy job is skipped until the repository variables exist, or fails clearly when they don't.
3. **First deploy.** Set the repository variables, then run the workflow manually on `main`. The deploy creates the service.
4. **Enable IAP.** Turn on IAP, configure the custom OAuth client, and grant access to the owner.
5. **Verify** the spec scenarios on the hosted URL.
6. **Rollback.** Route traffic back to a previous revision. Tear down by deleting the project; nothing outside it depends on it.

## Open Questions

None that change the plan. Model names stay at their code defaults on the hosted service unless the owner sets them.
