# production-hosting Specification

## Purpose

Defines how the application is hosted for real use: who can reach it, how its secrets and runtime limits are handled, how new versions reach production from `main`, and how cost stays bounded.

## Requirements

### Requirement: Private hosted access
The hosted application SHALL be reachable only by Google identities on an explicit allow-list, initially the owner's account alone. A request from any other identity, or with no identity, SHALL be refused before it reaches the application, so no page, API route or file download is served to it.

#### Scenario: Allow-listed owner opens the app
- **WHEN** the owner opens the hosted URL and signs in with the allow-listed Google account
- **THEN** the Fit Check page loads and the Experience pages and API calls work as they do locally

#### Scenario: Unknown visitor is refused
- **WHEN** a visitor opens the hosted URL without signing in, or signs in with an account that is not on the allow-list
- **THEN** the visitor sees a Google sign-in or access-denied page and the application receives no request

#### Scenario: Direct API call without identity
- **WHEN** a client calls a hosted API route such as `GET /api/experiences` without an allow-listed identity
- **THEN** the call is refused before the application and returns no experience data

### Requirement: Secrets stay out of code and images
The Supabase service-role key and the Gemini API key SHALL NOT appear in the repository, the container image, the build logs or the CI configuration. The hosted service SHALL read them at runtime from a managed secret store that only the service's runtime identity can read.

#### Scenario: Image inspection reveals no secret
- **WHEN** the deployed container image's layers and environment are inspected
- **THEN** neither the service-role key nor the Gemini API key is present

#### Scenario: Secret is rotated
- **WHEN** the owner adds a new version of either secret and redeploys or restarts the service
- **THEN** the service uses the new value without any code or image change

### Requirement: Hosted runtime parity
The hosted service SHALL extract, parse, index and evaluate with the same behavior as local development with Poppler installed. PDF extraction SHALL use Poppler's text extractor, not the fallback parser.

#### Scenario: PDF is processed on the hosted service
- **WHEN** the owner uploads a selectable-text PDF on the hosted app and processing runs
- **THEN** extraction succeeds through Poppler and the file reaches review exactly as it would locally

#### Scenario: State-changing call from the hosted page
- **WHEN** the hosted page sends a same-origin request that changes state, such as saving a draft, approving or indexing
- **THEN** the request is accepted, and cross-origin requests are still rejected

### Requirement: Bounded hosted request lifetime
The hosted service SHALL allow each request at least 10 minutes, more than the longest bounded pipeline stage. Work in progress when the browser disconnects SHALL either finish and be persisted or remain recoverable through the existing execution lease. No background worker, queue or always-on instance is required.

#### Scenario: Longest stage completes
- **WHEN** a structured parse runs up to its own 120-second limit on the hosted service
- **THEN** the hosting platform does not end the request before the application responds

#### Scenario: Browser leaves during extraction
- **WHEN** the owner closes the tab while an extraction request is running
- **THEN** the extraction still completes and is stored, or its lease expires so that the stage can be retried

### Requirement: Scale to zero with a bounded ceiling
The hosted service SHALL run no instances while idle. It SHALL also cap the number of concurrent instances, so traffic cannot raise compute cost without limit.

#### Scenario: Idle service
- **WHEN** no request has arrived for the platform's idle period
- **THEN** no instance is running and no compute is billed, and the next request starts an instance

#### Scenario: Burst of requests
- **WHEN** more requests arrive than the capped instances can serve
- **THEN** extra requests queue or are rejected by the platform rather than starting more instances

### Requirement: Automated deployment from main
Every push to `main` whose CI checks and browser tests pass SHALL be built and deployed automatically. A push whose CI fails SHALL NOT be deployed. Each deployed version SHALL be traceable to the commit it was built from. Only this repository's `main` branch SHALL be able to deploy.

#### Scenario: Merge with green CI
- **WHEN** a pull request is merged to `main` and both CI jobs pass on the resulting push
- **THEN** a new version built from that commit is serving the hosted URL without any manual step

#### Scenario: CI fails on main
- **WHEN** either CI job fails on a push to `main`
- **THEN** no build or deployment runs, and the previous version keeps serving

#### Scenario: Pull request or fork attempts to deploy
- **WHEN** a workflow runs for a pull request, another branch or a fork
- **THEN** it cannot obtain Google Cloud credentials and cannot deploy

### Requirement: Consistent client version across deploys
When a new version is deployed while a page from the previous version is open, the next navigation SHALL load the new version completely. The page SHALL NOT mix assets or server responses from two builds.

#### Scenario: Navigation after a deploy
- **WHEN** a page loaded before a deploy navigates to another route after the deploy
- **THEN** the browser performs a full reload of the new version instead of a client-side transition that fails

### Requirement: Spending alert
The hosting project SHALL have a monthly budget that notifies the owner by email when actual spend reaches 50%, 90% and 100% of S$15.

#### Scenario: Spend crosses a threshold
- **WHEN** the project's monthly cost, after credits, crosses 50%, 90% or 100% of the budget
- **THEN** the billing account's owner receives an alert email for that threshold
