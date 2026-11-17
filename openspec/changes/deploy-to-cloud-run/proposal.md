# Proposal

## Why

The application runs only on a developer machine. It needs a hosted home that stays private, because it has no user login and its server reaches Supabase with the service-role key, so anyone who can open it can read and change every experience file. Google Cloud is the chosen host: the owner's billing account carries a monthly Google AI Pro credit that should pay for the running cost, and Cloud Run in Sydney sits next to the Supabase project (`ap-southeast-2`).

## What Changes

- **New GCP project `jd-fit-check`**, owned by the owner's Google account and linked to the billing account that holds the AI Pro monthly credit. Nothing is deployed to the existing DisFwd project.
- **Container image.** The app is built as a Next.js standalone server in a container that includes Poppler's `pdftotext`, so hosted PDF extraction uses the same Poppler path as local development instead of falling back to `pdf2json`.
- **Cloud Run service** in `australia-southeast1` that scales to zero, allows a 10-minute request timeout, and caps instances to bound cost. No queue, scheduler or always-on instance is added: every pipeline stage already finishes inside one bounded request.
- **Private access through Identity-Aware Proxy.** Only the owner's Google account can reach the service. Every other visitor is stopped at a Google sign-in before any request reaches the app.
- **Secrets outside the code.** The Supabase service-role key and the Gemini API key are stored in Secret Manager and read only by the service's own runtime identity.
- **Automatic deployment on merge to `main`.** After both existing CI jobs pass on a push to `main`, a GitHub Actions job builds the image, pushes it to Artifact Registry tagged with the commit, and deploys it. GitHub signs in to Google Cloud without stored keys (Workload Identity Federation), and only `main` of this repository can deploy.
- **Hosting-safe request handling.** State-changing API calls keep working behind Cloud Run's front end, where TLS ends before the container. Each deploy carries a deployment identifier, so a browser holding an older build reloads instead of mixing versions.
- **Early size check on upload.** The drop zone rejects files over the existing 10 MB upload limit before sending them, so very large files show the app's own message rather than the hosting platform's raw error.
- **Cost guardrail.** A billing budget on the new project emails the owner as spend approaches S$15 a month.

Out of scope: moving Gemini calls to Vertex AI (a separate later change; the AI Studio free-tier key stays), user accounts or public access, a custom domain, staging environments, and background job infrastructure.

## Capabilities

### New Capabilities

- `production-hosting`: how the application is hosted, reached, configured, deployed and kept within budget: private access, secret handling, runtime limits, automated deployment from `main`, and parity of the hosted runtime with local behavior.

### Modified Capabilities

- `jd-fit-workspace-ui`: **Inline experience upload** gains a scenario. A file larger than the upload limit is rejected in the drop zone before any request is sent, with a message that names the limit.

## Impact

- **New files.** `Dockerfile`, `.dockerignore`, a deploy job in `.github/workflows/ci.yml` (or a sibling workflow that depends on CI), and a short deployment guide (README section or `docs/deploy.md`) covering the one-time GCP setup.
- **Code.** `next.config.ts` (standalone output, deployment identifier), `app/lib/experience/apiRoutes.ts` (only if the hosted origin check fails, see design), `app/lib/supabaseServer.ts` (server-only Supabase URL variable if build-time inlining is confirmed), `app/experience/_components/DropZone.tsx` and `app/lib/experience/uploadUi.ts` (early size check), with matching tests.
- **External systems.** A new GCP project with Cloud Run, Artifact Registry, Secret Manager, IAP, IAM and a budget. No change to Supabase, its schema or Gemini usage.
- **Operations.** The first deploy and the IAP OAuth client need one-time console steps by the owner. Later deploys need no manual step.
- **Cost.** Expected to stay inside Cloud Run's free tier plus the monthly credit at personal traffic. `max-instances` and the budget alert bound the worst case.
