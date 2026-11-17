# Tasks

Work happens on branch `deploy-to-cloud-run` (worktree `.claude/worktrees/deploy-to-cloud-run`), cut from `main`. Steps marked **[owner]** need the owner's own action or explicit approval: they create billable resources, change IAM, or use the Google Cloud console.

## 1. Container build

- [x] 1.1 Add `output: "standalone"` to `next.config.ts` (Next reads `NEXT_DEPLOYMENT_ID` natively at build time, so no `deploymentId` entry is needed). Verify `npm run build` still passes with the CI placeholder env, and that `.next/standalone/server.js` exists.
- [x] 1.2 Add `.dockerignore` excluding `node_modules`, `.next`, `.env*`, `.git`, `.claude`, `openspec`, `supabase` and the `.*-test-build` folders. Verify with `git check-ignore`-style review that no `.env*` file can enter the build context.
- [x] 1.3 Add a multi-stage `Dockerfile` (Node `26.2.0-bookworm-slim`; build stage with `ARG NEXT_DEPLOYMENT_ID` and no `NEXT_PUBLIC_*`; runtime stage with `poppler-utils`, the non-root `node` user, `HOSTNAME=0.0.0.0` and `CMD ["node","server.js"]`). Verify in a GitHub Actions run, or locally if Docker is present, that the image builds.
- [x] 1.4 Verify in the built image that `pdftotext -v` runs and that `grep -r` over `/app` finds neither `127.0.0.1:54321` nor any `supabase.co` URL. If the build fails without `NEXT_PUBLIC_SUPABASE_URL`, apply design Decision 5's fallback (server-only `SUPABASE_URL` that takes precedence in `app/lib/supabaseServer.ts`) with a unit test and README env update, then re-verify.

## 2. Early upload size check

- [x] 2.1 Export the upload byte limit and an oversized-file message builder from `app/lib/experience/uploadUi.ts`, sourced from the same 10 MB value as `EXPERIENCE_EXTRACTION_LIMITS.maxUploadBytes` without pulling server-only modules into the client bundle. Verify with a unit test that the value equals the server limit and the message names "10 MB".
- [x] 2.2 In `app/experience/_components/DropZone.tsx`, reject files over the limit before building `FormData`, show the message in the existing error slot, and send no request. Verify with a contract test that the oversized path makes no `fetch` call and the zone stays usable.
- [x] 2.3 Extend `retryConflicts.browser.mjs` (or the browser test suite behind `npm run test:browser`) with an oversized-file drop that asserts the message and zero upload requests. Verify `npm run test:browser` is green.

## 3. One-time GCP setup **[owner]**

- [x] 3.1 Update the local gcloud CLI (`gcloud components update`). Verify `gcloud --version` reports a 2026 release.
- [x] 3.2 Create project `jd-fit-check` (or the closest available ID) under `kingdesmond1995@gmail.com` and link billing account `01C6B1-0F539E-43ED31`. Verify that `gcloud billing projects describe <id>` shows `billingEnabled: True` on that account.
- [x] 3.3 Enable `run`, `artifactregistry`, `secretmanager`, `iap`, `iamcredentials`, `sts` and `billingbudgets` APIs. Verify with `gcloud services list --enabled`.
- [x] 3.4 Create Artifact Registry Docker repository `app` in `australia-southeast1`, with a cleanup policy keeping the 5 latest versions and deleting untagged images after 7 days. Verify with `gcloud artifacts repositories describe app` and `gcloud artifacts repositories list-cleanup-policies app`.
- [x] 3.5 Create service accounts `jd-fit-runtime` (no project roles) and `github-deployer`. Verify with `gcloud iam service-accounts list`.
- [x] 3.6 Create secrets `supabase-service-role-key` and `gemini-api-key` from the owner's values (entered by the owner, never echoed into chat or logs), and grant `jd-fit-runtime` `secretAccessor` on each secret only. Verify with `gcloud secrets get-iam-policy` for each.
- [x] 3.7 Grant `github-deployer`: `roles/run.developer` on the project, `roles/artifactregistry.writer` on repository `app`, and `roles/iam.serviceAccountUser` on `jd-fit-runtime`. Verify with the three IAM policy reads.
- [x] 3.8 Create Workload Identity pool `github` and OIDC provider `github-actions` with attribute condition `assertion.repository == 'desmondtong/AI-Powered-RAG-Search-Application' && assertion.ref == 'refs/heads/main'`, and allow that principal set to impersonate `github-deployer`. Verify with `gcloud iam workload-identity-pools providers describe`.
- [x] 3.9 Create the S$15 monthly budget on the billing account, filtered to the project, with thresholds 50%, 90% and 100% including credits. Verify with `gcloud billing budgets list --billing-account=01C6B1-0F539E-43ED31`.
- [x] 3.10 Record every command from 3.2–3.9 in the deployment guide (section 5), with placeholders instead of secret values.

## 4. Deployment workflow

- [x] 4.1 Add a `deploy` job to `.github/workflows/ci.yml`. It has `needs: [checks, browser, image]` (the `image` job builds and checks the container on every run), runs only on `push` to `refs/heads/main` or `workflow_dispatch` on `main`, and is skipped when `vars.GCP_PROJECT_ID` is empty. Its permissions are `contents: read` and `id-token: write`, and no other job gets `id-token`. Verify on the pull request that `checks` and `browser` run and `deploy` is skipped.
- [x] 4.2 In the job, authenticate with `google-github-actions/auth` via the WIF provider and deployer from repository variables, and build with `--build-arg NEXT_DEPLOYMENT_ID=${{ github.sha }}`. Push `…/app/web:${{ github.sha }}`, then run `gcloud run deploy jd-fit-check` with the image, region, runtime service account, `--timeout=600 --memory=1Gi --cpu=1 --min-instances=0 --max-instances=2`, `--set-secrets` for both secrets, and `NEXT_PUBLIC_SUPABASE_URL` from a repository variable. Do not pass `--allow-unauthenticated`. Verify with `actionlint`, or a careful review if it is unavailable.
- [x] 4.3 **[owner]** Set repository variables `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA` and `NEXT_PUBLIC_SUPABASE_URL` in GitHub. Verify with `gh variable list`.

## 5. Documentation

- [x] 5.1 Add a "Deploying" section to `README.md`, or `docs/deploy.md` linked from the README. It covers the architecture in one paragraph, the one-time setup commands from group 3, the IAP console steps from group 6, how deploys happen, how to roll back with `gcloud run services update-traffic`, how to rotate a secret, and a note that the AI Pro credit applies only on billing account `01C6B1-…`. Verify that each command in the guide matches what was run.

## 6. First deploy and private access **[owner]**

- [x] 6.1 Merge the pull request, set the variables (4.3), then run the workflow on `main` with `workflow_dispatch`. Verify that `gcloud run services describe jd-fit-check --region australia-southeast1` shows the commit SHA image tag, the 600 s timeout, 1 GiB, max instances 2 and the runtime service account.
- [x] 6.2 Configure the External OAuth consent screen (Testing, test user `kingdesmond1995@gmail.com`) and create a Web OAuth client in the console. Enable IAP on the service and set IAP to use that client. Grant `roles/iap.httpsResourceAccessor` to the owner, and grant `roles/run.invoker` to the IAP service agent. Verify that the IAP settings for the service show the custom client.
- [x] 6.3 Verify private access from a signed-out browser window and with `curl https://<service-url>/api/experiences`: both are refused before the app, and Cloud Run logs show no request for them. Then verify the owner's signed-in browser loads Fit Check.

## 7. Hosted verification

- [x] 7.1 On the hosted app, save a draft or run another state-changing call. Verify it is accepted, not rejected with 403 `cross-origin-rejected`. Decision 8 was reproduced locally against the standalone server with Cloud Run headers and is already implemented in `app/lib/experience/apiRoutes.ts`, with tests in `apiRoutes.test.ts`.
- [x] 7.2 Upload a selectable-text PDF on the hosted app and run it to review. Verify in the extraction snapshot or logs that the Poppler path was used, not `pdf2json`.
- [x] 7.3 Run one file through approve and index, and run one Fit Check evaluation on the hosted app. Verify that both complete and that no request ends with a platform timeout in Cloud Run logs.
- [x] 7.4 Drop a file over 10 MB on the hosted drop zone. Verify that the size message appears and no upload request is logged.
- [x] 7.5 Push a trivial change through a pull request to `main` while a hosted page is open, then navigate. Verify that the new revision serves automatically, carries the new SHA, and that the open page does a full reload on navigation.
- [x] 7.6 Browser walkthrough per the project's apply guidance: record the hosted URL, the steps performed for 6.3 and 7.1–7.5, the observed results, and screenshots in the implementation summary.

## Hosted walkthrough record (7.6)

- **Where it ran:** https://jd-fit-check-229321594006.australia-southeast1.run.app, behind IAP, signed in as the owner, driven in Chrome on 2026-11-17. The checks ran against revision `00002` (`fed4693`) and, after the Fit Check fix, revision `00003` (`632294b`).
- **6.3 Private access.**
  - Anonymous `GET /` and `GET /api/experiences` get 302 to Google sign-in; `POST` and a fake bearer token get 401.
  - None of these reached the app (Cloud Run request logs).
  - The owner gets in, and the owner confirmed another Google account is refused.
- **7.4 Oversized file.** An 11 MB file was given to the drop zone. It showed "This file is larger than 10 MB. Upload a smaller or split document.", made 0 upload requests, and the page stayed on `/experience` with the input cleared.
- **7.2 PDF through Poppler.**
  - A synthetic selectable-text PDF uploaded and extracted.
  - The hosted extraction is identical line for line (14 lines) to the app's `pdftotext` extractor run locally on the same file; `pdf2json` gives a single padded line.
  - No `pdftotext` warnings in the logs.
- **7.1 State-changing calls.** These hosted POST/PATCH/DELETE calls were all accepted: retry parse, save draft (PATCH 200, `draft_version` 2), approve, index (two batches), and delete.
  - Parse first failed with Gemini's own `503 UNAVAILABLE` (high demand) and succeeded on retry.
  - The first draft save returned 422 under the app's rule that an unassigned block must be acknowledged; it saved once acknowledged.
- **7.3 Full pipeline.**
  - Approve and index returned 200 ("Indexed · version 1").
  - Fit Check was first rejected as cross-origin. The JD-fit route kept its own copy of the old origin check; fixed in #6 (Decision 8).
  - On `632294b` one attempt returned 500 "unexpected error" (transient), and the retry returned 200: 8 requirements (6 strong, 1 partial, 0 weak, 1 missing), each citing the test file.
- **7.5 Deploy on merge and full reload.**
  - Merging #6 deployed revision `00003` with no manual step; the image tag and `commit-sha` label are the merge commit.
  - A page opened on `fed4693` (marker set, assets `dpl=fed46931f759`) was navigated through the in-app Experience link after the deploy. It did a full load: marker gone, new `navigate` entry, assets `dpl=632294b64739`.
- **Also found on the hosted app.** The webpack production build served uncompiled Tailwind, so the page was unstyled. Fixed in #5 (Decision 13).
- **Cleanup.** The test file was deleted (DELETE 200). The Experience list is back to the original 6 indexed files.

## Workflow follow-up

- Update the session memory `gcp-hosting-target`, which still names DisFwd, to the new project ID and service URL.
- Archive the change after review, then open or update the pull request, rebase-merge once both CI checks are green, delete the branch locally and on origin, and remove the `.claude/worktrees/deploy-to-cloud-run` worktree.
- Later change: move Gemini calls to Vertex AI in `jd-fit-check` so the AI Pro credit covers them.
