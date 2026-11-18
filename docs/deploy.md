# Deploying JD Fit Check

The app runs on **Cloud Run** in a Google Cloud project of its own, region `australia-southeast1` (Sydney), next to the Supabase project in `ap-southeast-2`.
- **Supabase** keeps the database, vector search and source files. Gemini is called with an AI Studio key.
- **Access:** Identity-Aware Proxy (IAP) admits only the owner's Google account. The app has no login of its own, and its server uses the Supabase service-role key. The top bar's account avatar reads the email IAP forwards in `x-goog-authenticated-user-email` for display only; no page or API decision depends on it.
- **Deploys:** every push to `main` that passes CI is built into a container and deployed automatically by the `deploy` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

```
browser ──► IAP (Google sign-in, allow-list) ──► Cloud Run: Next.js standalone + pdftotext ──► Supabase · Gemini
                                                   ▲ secrets from Secret Manager
GitHub main ──► CI (checks, browser, image) ──► deploy job (WIF, no keys) ──► Artifact Registry ──► Cloud Run
```

Billing: the project is linked to the owner's billing account, which carries the Google AI Pro monthly Google Cloud credit. The credit only applies while the project stays on that billing account.

## Settings at a glance

| Setting | Value | Why |
|---|---|---|
| Timeout | 600 s | Longest pipeline stage is a 120 s structured call |
| Memory / CPU | 1 GiB / 1 | `pdftotext` plus in-memory DOCX expansion (50 MB cap) |
| Min / max instances | 0 / 2 | Scale to zero; cap cost |
| Runtime identity | `jd-fit-runtime@<gcp-project-id>.iam.gserviceaccount.com` | Reads the two secrets, nothing else |
| Secrets | `supabase-service-role-key`, `gemini-api-key` (`:latest`) | Never in the repo, image or CI |
| Plain env | `NEXT_PUBLIC_SUPABASE_URL` | Read at runtime; deliberately not set during `docker build` |

The deploy job sets these flags on every deploy, so the workflow file is the source of truth for them. IAP is configured once, outside the workflow, and persists across deploys.

## One-time setup

Run these from a shell signed in as the owner (`gcloud auth login`). Values in `<angle brackets>` are yours to fill in. Never paste a secret into a command line that lands in shell history; the secret steps below read from a hidden prompt.

```bash
PROJECT_ID=<gcp-project-id>
REGION=australia-southeast1
SERVICE=<service-name>              # the SERVICE value in ci.yml's deploy job
BILLING_ACCOUNT=<billing-account-id>
OWNER=<owner-google-account>
REPO=desmondtong/AI-Powered-RAG-Search-Application
RUNTIME_SA=jd-fit-runtime@${PROJECT_ID}.iam.gserviceaccount.com
DEPLOYER_SA=github-deployer@${PROJECT_ID}.iam.gserviceaccount.com
```

### 1. Project, billing and APIs

```bash
gcloud components update
gcloud projects create "$PROJECT_ID" --name="JD Fit Check"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iap.googleapis.com iamcredentials.googleapis.com sts.googleapis.com billingbudgets.googleapis.com
```

### 2. Artifact Registry with a cleanup policy

```bash
gcloud artifacts repositories create app --repository-format=docker --location="$REGION" \
  --description="JD Fit Check container images"

cat > /tmp/jd-fit-cleanup.json <<'EOF'
[
  {"name": "keep-latest-5", "action": {"type": "Keep"},
   "mostRecentVersions": {"packageNamePrefixes": ["web"], "keepCount": 5}},
  {"name": "delete-untagged", "action": {"type": "Delete"},
   "condition": {"tagState": "UNTAGGED", "olderThan": "7d"}},
  {"name": "delete-old", "action": {"type": "Delete"},
   "condition": {"tagState": "ANY", "olderThan": "30d"}}
]
EOF
gcloud artifacts repositories set-cleanup-policies app --location="$REGION" \
  --policy=/tmp/jd-fit-cleanup.json --no-dry-run
```

Keep rules win over delete rules, so the five newest images always survive.

### 3. Service accounts

```bash
gcloud iam service-accounts create jd-fit-runtime --display-name="JD Fit Check runtime"
gcloud iam service-accounts create github-deployer --display-name="GitHub Actions deployer"
```

### 4. Secrets

```bash
gcloud secrets create supabase-service-role-key --replication-policy=automatic
gcloud secrets create gemini-api-key --replication-policy=automatic

read -rs -p "Supabase service-role key: " SECRET && echo && \
  printf '%s' "$SECRET" | gcloud secrets versions add supabase-service-role-key --data-file=- ; unset SECRET
read -rs -p "Gemini API key: " SECRET && echo && \
  printf '%s' "$SECRET" | gcloud secrets versions add gemini-api-key --data-file=- ; unset SECRET

for s in supabase-service-role-key gemini-api-key; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:${RUNTIME_SA}" --role=roles/secretmanager.secretAccessor
done
```

### 5. Deployer permissions

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOYER_SA}" --role=roles/run.developer
gcloud artifacts repositories add-iam-policy-binding app --location="$REGION" \
  --member="serviceAccount:${DEPLOYER_SA}" --role=roles/artifactregistry.writer
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:${DEPLOYER_SA}" --role=roles/iam.serviceAccountUser
```

### 6. Workload Identity Federation (keyless GitHub sign-in, `main` only)

```bash
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github-actions \
  --location=global --workload-identity-pool=github --display-name="GitHub Actions OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository == '${REPO}' && assertion.ref == 'refs/heads/main'"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO}"
```

The attribute condition is the lock: a token from a pull request, another branch or a fork is refused before it can impersonate the deployer.

### 7. Budget alert

```bash
gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
  --display-name="JD Fit Check monthly" --budget-amount=15SGD \
  --filter-projects="projects/${PROJECT_ID}" --credit-types-treatment=include-all-credits \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

Alerts go to the billing account's admins by email. Including credits means the alerts track what is actually charged after the AI Pro credit.

### 8. GitHub repository variables

None of these is a secret.

```bash
gh variable set GCP_PROJECT_ID --body "$PROJECT_ID"
gh variable set GCP_REGION --body "$REGION"
gh variable set GCP_WIF_PROVIDER \
  --body "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github-actions"
gh variable set GCP_DEPLOYER_SA --body "$DEPLOYER_SA"
gh variable set NEXT_PUBLIC_SUPABASE_URL --body "https://<project-ref>.supabase.co"
```

Until `GCP_PROJECT_ID` is set, the deploy job is skipped and CI behaves as before.

### 9. First deploy

```bash
gh workflow run CI --ref main
gh run watch
gcloud run services describe "$SERVICE" --region="$REGION" \
  --format='value(status.url,spec.template.spec.containers[0].image)'
```

The first deploy creates the service without public access. Nothing can reach it until IAP is on.

### 10. Private access with IAP

The project has no Google Cloud organization, and Google does not allow OAuth clients to be created from the command line, so IAP is first enabled in the console:

1. **Google Auth Platform → Branding** (`console.cloud.google.com/auth/branding`). Click Get started, set app name "JD Fit Check" and the owner as support email, choose audience **External**, and create.
2. **Audience**: keep the publishing status **Testing** and add the owner's Google account as a test user. That account is the only one that will be able to sign in.
3. **Cloud Run → your service → Security → Identity-Aware Proxy**: enable IAP, choose **Configure in IAP**, then **Auto generate credentials** to create the custom OAuth client and its redirect URI, and save. The console also grants the IAP service agent `roles/run.invoker`.
4. Allow the owner, then check:

```bash
gcloud iap web add-iam-policy-binding --resource-type=cloud-run --service="$SERVICE" --region="$REGION" \
  --member="user:${OWNER}" --role=roles/iap.httpsResourceAccessor

gcloud run services describe "$SERVICE" --region="$REGION" | grep -i iap      # expect: Iap Enabled: true
gcloud run services get-iam-policy "$SERVICE" --region="$REGION"               # expect the IAP service agent as run.invoker
```

If the console did not grant the invoker role ("Setting IAM permissions failed"), grant it by hand:

```bash
gcloud services identity create --service=iap.googleapis.com --project="$PROJECT_ID"
gcloud run services add-iam-policy-binding "$SERVICE" --region="$REGION" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-iap.iam.gserviceaccount.com" --role=roles/run.invoker
```

Check from a private browser window: the service URL must show a Google sign-in, and an account other than the owner's must be refused. `curl <service-url>/api/experiences` must not return experience data.

## Day-to-day

Commands use the variables set at the start of One-time setup.

- **Deploy:** merge a pull request to `main`. When `checks`, `browser` and `image` pass, `deploy` builds `…/app/web:<commit-sha>` and rolls it out. To redeploy without a code change, run `gh workflow run CI --ref main`.
- **See what is serving:** `gcloud run services describe "$SERVICE" --region="$REGION"`. The image tag and the `commit-sha` label are the commit.
- **Roll back:**
  ```bash
  gcloud run revisions list --service="$SERVICE" --region="$REGION"
  gcloud run services update-traffic "$SERVICE" --region="$REGION" --to-revisions=<previous-revision>=100
  ```
  The next merge to `main` deploys a new revision and sends traffic back to the latest.
- **Rotate a secret:** add a version (step 4's `read … | gcloud secrets versions add …`), then redeploy. Instances read `:latest` when they start.
- **Logs:** `gcloud run services logs read "$SERVICE" --region="$REGION" --limit=50`, or Logs Explorer in the console.
- **Add another person:** run step 10's `add-iam-policy-binding` with their account. While the consent screen is in Testing, also add them as a test user.
- **Tear down:** `gcloud projects delete <gcp-project-id>`. Nothing outside the project depends on it.
