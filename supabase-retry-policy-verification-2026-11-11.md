# Retry Policy Verification

Date: 2026-11-11
Change: `add-structured-project-ingestion`
Application HEAD: `7f472783bff1495191603d68d86a3624a592d8f1`
Status: Verification passed; authorized API/UI fixes and acceptance evidence complete.

## Scope

The approved policy rejects outdated indexing/publication requests, including
previously published revisions. Only a current-active/latest-approved revision
with valid execution authority and matching publication parameters/live evidence
can return idempotent success. No historical publication receipts are introduced.

The user's apply request authorized the planned verification work. After the
initial inspection pause, the user separately authorized API/UI fixes and
database-free regressions. Neither authorization permits schema deployment,
migration-history reconciliation, or local database operations. Initial findings
below are preserved as historical context; subsequent sections record the fixes.

The original `supabase-remote-verification-2026-11-11.md` remains unchanged.
Its outdated-retry rejection is intentional under the revised policy; changing
the policy alone does not establish application or database acceptance.

## Preflight (11.1)

- MCP `get_project_url` returned exactly
  `https://lwljmmfcvmbnrfstltzj.supabase.co`.
- All SQL goes through that project-bound Supabase MCP connection. SQL
  `app.settings.project_ref` is unavailable (NULL), so it is not used to claim
  target identity. A matching MCP URL is required before each fixture execution.
- Remote Postgres reports 17.11; preflight executes read-only as `postgres`.
  Application-behavior fixtures use `SET LOCAL ROLE service_role`.
- Inspected full remote publication, execution acquisition/completion, approved
  search, and deletion definitions. Candidate checking precedes retry success;
  publication validates execution tokens; search uses the active pointer without
  requiring equality with the latest candidate; deletion removes live evidence
  and revision history.
- The seven scoped evidence/experience tables have RLS enabled, deny SELECT to
  `anon`/`authenticated`, and allow `service_role` SELECT.
- The seven lifecycle RPCs below are SECURITY INVOKER, have fixed search paths,
  deny browser-role EXECUTE, and allow service-role EXECUTE.
- `public.experience_publication_receipts` is absent. No receipt/backfill,
  migrations, schema/grant updates, Gemini calls, or Storage writes were performed.
- Reviewed current Supabase changelog, relevant Postgres 17.11/TLS notices,
  monitoring guidance, and transaction/privilege guidance. No platform upgrade,
  reindexing, or unrelated remediation is part of this work.

| RPC | Remote body MD5 |
| --- | --- |
| acquire_experience_source_execution | 63965d3f8b880a3c473b71a5976923c3 |
| approve_experience_revision | bcc6e3f0db6cc9e12f5147967398b77e |
| complete_experience_source_execution | e3ff37d74bca0dbc65775b8e0ff3d758 |
| delete_experience_source | 1e88050e3f2f016c65885f4a71d46139 |
| match_approved_experience_chunks | 3d6e64c70675c61f8024068cfb5f37ce |
| publish_experience_revision | 1199ee7e79ba9416cf8607ba3d7664f1 |
| stage_experience_embeddings | 559278e29027aa0a785c24899bacd3bd |

## Verification Assets

- [experience_retry_policy.sql](supabase/checks/experience_retry_policy.sql): current retry and both
  newer-approval/newer-publication windows for published and unpublished older
  revisions. Uses random synthetic source identity, finite statement/lock
  timeouts, an exception subtransaction, an explicit PASS/FAIL result, and a final
  `ROLLBACK`. No persistent schema objects or helper functions are created.
- Existing migrations/checks remain unchanged; no migration is replayed.
- [experience_retry_guards.sql](supabase/checks/experience_retry_guards.sql): 31 independently isolated
  current-version invalid-token/parameter/ownership/live-evidence checks.
- [experience_retry_lifecycle.sql](supabase/checks/experience_retry_lifecycle.sql): multi-parent failure,
  replacement, retained approval history, deletion, and server-only access.
- Application checks: [indexing.test.ts](app/lib/experience/indexing.test.ts),
  [crossWorkflowAcceptance.test.ts](app/lib/experience/crossWorkflowAcceptance.test.ts),
  and [retryConflicts.browser.mjs](app/lib/experience/retryConflicts.browser.mjs).
- Updated implementation contract: [README.md](app/lib/experience/README.md).

## Baseline

Fingerprints are MD5 of ordered JSONB row aggregates (or `[]` for empty tables);
only hashes, not user content, are recorded.

| Data | Rows | Before fingerprint |
| --- | ---: | --- |
| Generic documents | 8 | ab27264b187f3f0332d7dd1e14bbd98e |
| Evidence parents/chunks, sources/extractions/revisions, mappings/staging | 0 each | d751713988987e9331980363e24189ce each |
| Storage objects | 2 | 5a2a5b8626721a27140d27324e62125b |

After `experience_retry_policy.sql`, all nine fingerprints exactly matched the
baseline. No fixture rows or Storage changes persisted.
Sequential state simulations do not establish two-session concurrency coverage.

## Current and Outdated Retries (11.2, 11.3)

Executed the repository script through project-confirmed MCP as `service_role`;
the final result was `status: PASS`, followed by `ROLLBACK`.

- First publication: correct indexed status, revision/active identity, counts,
  and plan; all four lease fields cleared and target staging removed.
- Current retry: a fresh valid lease returns the exact expected idempotent
  response, retains parent/child identities and counts, and consumes the lease.
  Reusing the consumed token fails without changing source state.
- After R2 approval: both published R1 and the fully staged but never-published
  older revision fail with SQLSTATE `40001` and
  `Experience publication candidate is stale`. Source, lease, revisions, live
  evidence, mappings, and staging are unchanged relative to immediately before
  the rejected calls. R1 remains searchable.
- After R2 publication: the same two outdated requests fail without side effects,
  R2 remains searchable, and R1 parents/chunks/mappings remain absent.
  All three approved revisions and the extraction snapshot are retained.
- There were no embedding API calls; this is database verification, not proof
  that the application's current-active shortcut complies with the lease rule.

The first script submission failed PL/pgSQL compilation with `42601` because
`window` was used as a variable name. No fixture body executed. An explicit
`ROLLBACK` was issued; the variable was renamed `retry_window` in the repository,
and the corrected full script passed. This was a check-script defect, not a
publication defect.

## Retry Guards (11.4)

`experience_retry_guards.sql` returned `status: PASS` for all 31 cases as
`service_role`, ended with `ROLLBACK`, and all nine post-check fingerprints matched
the baseline. Each rejected request preserved the exact pre-request source
(including lease), revision, parent, child, and mapping JSON.

| Cases | Observed rejection |
| --- | --- |
| Omitted/null, replaced, expired, wrong-stage token | `40001`: indexing execution token stale or expired |
| Wrong-source revision | `40001`: revision unavailable for publication |
| Wrong approved hash | `40001`: approved content hash mismatch |
| Wrong plan, positive but wrong parent/child counts, chunking, model | `40001`: existing publication counts/configuration mismatch |
| Null/empty hash, plan, chunking, model; null/zero counts | `P0001`: required-value/positive-count validation |
| Wrong task type or dimensions | `P0001`: required document task/1536 dimensions |
| Null task or dimensions | `40001`: existing publication counts/configuration mismatch |
| Removed child, removed mapping, altered mapping model | `40001`: existing publication counts/configuration mismatch |

Test-only corruption is individually rolled back before the next case. These
results distinguish input/lease/configuration failures from stale-candidate
conflicts; SQLSTATE `40001` alone does not identify candidate staleness.

## Replacement and Deletion (11.5)

The corrected `experience_retry_lifecycle.sql` returned `status: PASS` as
`service_role`, ended with `ROLLBACK`, and all nine post-check fingerprints matched
the baseline.

- R1's two children remain searchable after R2 approval and preparation.
- Invalidating R2's second child raises `23514` after the first parent's insertion
  is attempted; the complete pre-publication source/revision/evidence/mapping/
  staging snapshot remains identical, and R1 remains searchable.
- Valid replacement removes R1's live parents/children, publishes both R2 parents,
  and retains the approved revisions and extraction snapshot.
- A third candidate is staged while R2 is active. Deletion removes 2 parents,
  2 children, 3 revisions, 1 extraction, and 2 staging rows. Late R2 retries with
  the former indexing token fail in both tombstoned and cleanup-pending states;
  repeated deletion reports `already_deleted: true`.
- A synthetic standalone parent and child survive experience deletion and never
  appear in ingestion-owned search. Persistent generic documents remain unchanged.
- Catalog assertions verify seven tables deny all table and relevant column
  privileges to both browser roles, retain RLS, and lifecycle RPCs remain
  non-definer and inaccessible to those roles.

The first run reached the cleanup-pending fixture and reported `22P02` because
the test assigned a plain string to the JSONB `cleanup_error` field. Its exception
subtransaction and final `ROLLBACK` undid the fixture. The repository script now
uses the required JSON object; the full rerun passed. This was not a deletion
implementation defect. Actual Storage cleanup was not invoked or fault-injected.

## Application Discrepancies (Initial Inspection)

Before the separately authorized application fixes, static inspection confirmed
the following discrepancies (line references identify that pre-fix version):

1. `app/lib/experience/apiService.ts:963-985` returns current-active success
   before lease acquisition at line 988, without invoking the publication RPC
   or validating live evidence. It fabricates publication counts from the plan
   and omits the nested `publication.revision_id`. Required fix: obtain a valid
   lease and use authoritative RPC verification/response without re-embedding.
2. `app/lib/experience/apiService.ts:1036-1047` maps publication-time candidate
   staleness to generic `index-publication-conflict` with `retry-index`, unlike
   the early `index-candidate-stale` response at line 937. Required fix:
   distinguish actual late candidate staleness from other conflicts, preserve
   its actionable classification, and verify failure cleanup cannot overwrite
   newer execution/lifecycle state. Cleanup safety is not yet runtime-verified.
3. `app/experiences/[id]/ExperienceReviewClient.tsx:437-465` returns on indexing
   errors at lines 453-455 and reaches `loadDetail()` only on success. Required
   fix: refresh source/candidate/active state on stale conflict, preserve clear
   guidance, handle refresh failure by keeping indexing stopped, and require
   explicit action on refreshed state rather than stale reuse.

At the initial pause, the inspected client handler had one POST per invocation;
this was not proof of
browser request counts or full absence of automatic retry behavior. Database-free
API regressions and browser/network-count checks have not been run this session.
No application code or existing tests were modified.

Per design follow-up step 4, implementation fixes require separate authorization.
Apply pauses before changing application behavior or adding acceptance exceptions.
Do not close tasks 11.6/11.7 merely because these discrepancies were identified.
Task 11.8 and final acceptance 10.4 remain open until application evidence and
any authorized fixes are verified.

## Initial Verification Summary

- Completed this session: 11.1, 11.2, 11.3, 11.4, 11.5.
- Three new repository SQL verification files; no migrations or existing SQL
  files changed. Passing fixture executions ended in explicit `ROLLBACK`.
  Script-error attempts are documented above and rolled back.
- All final ordered-row fingerprints equal the recorded baseline for generic
  documents, evidence tables, experience tables, and Storage object metadata.
- No local database access, persistent remote data/schema/grant changes, real
  Storage operations, Gemini calls, migration-history writes, migration replay,
  `supabase db push`, or git commits occurred.
- SQL scripts use sequential state simulations; no concurrent-session load test,
  real upload/download, production deployment, or complete UI acceptance is claimed.
- `openspec validate add-structured-project-ingestion --strict` and
  `git diff --check` passed. The CLI remains `ready` with four unchecked tasks;
  this pause is for required fix authorization, not missing planning artifacts.

Repository SQL SHA-256 fingerprints:

| Script | SHA-256 |
| --- | --- |
| experience_retry_policy.sql | 3a4dbc5a2890313ef8c6f27f0e44e4b5078aadc57b7f9280433fe0d6a6f9b54a |
| experience_retry_guards.sql | 7654be01e722aae04155f91292e0bd0ca0546f471c861b7120056eeb3224f420 |
| experience_retry_lifecycle.sql | 55b5ded808ca3dce2412af54a198b776770765bb918027db5fd9bacf0a688bc1 |

## Authorized API Fixes (11.6)

The user explicitly authorized API/UI fixes and database-free regressions after
the initial pause. No additional database execution or schema changes are needed.

- Current-active retries now acquire a fresh lease and call the existing
  publication RPC with the frozen hash, configuration, and counts, without
  reading staging or embedding again. Responses come from validated RPC data;
  missing data never becomes fabricated success.
- Early and publication-time stale-candidate errors share HTTP 409,
  `index-candidate-stale`, and `refresh-source` guidance. Other `40001` errors
  remain ordinary publication conflicts.
- Indexing completion/failure cleanup uses an atomic conditional source update,
  matching token, stage, expiry, indexing status, candidate, active, draft, and
  nondeleted state. It cannot overwrite a newer approval that kept the old
  token. If state no longer matches, cleanup leaves it untouched and preserves
  the original error; the existing bounded lease can expire normally.
- Publication success does not trigger a second completion write. An invalid
  response after an error-free RPC also causes no completion/failure write
  because publication may already have committed.

Regression scope: `indexExperienceRevision` and its directly exercised helpers,
using in-memory Supabase doubles and synthetic vectors; no network/database calls.
New coverage includes current retry/lease denial, late approval, cleanup races,
replaced execution, deletion, invalid live/configuration responses, malformed
publication response, and both outdated-published windows.

The first focused run reproduced the defects: 5 passed, 4 failed. After the
authorized production changes, all focused checks passed. The broader suite
initially exposed missing `.gt()` support and a historical expired timestamp in
the cross-workflow mock; both fixture issues were corrected without weakening
assertions. Final `npm run test:experience`: **121 passed, 0 failed**.

Commands used outer 120-second focused / 300-second package timeouts. Unit-test
preparation, context/scope selection, defect mapping, generation/verification,
and `utree flush` reporting completed. Browser and final acceptance evidence
follow below.

### Final Lease Expiry Regression

Final inspection found the new conditional cleanup initially compared lease
expiry to application time, contrary to the design's database-time rule. Two
additional tests advanced the independent mock database clock to the exact expiry
and one second beyond it. Before correction, the focused suite reported
18 passed / 2 failed: cleanup incorrectly cleared the expired lease.

The filter now sends `execution_token_expires_at=gt.now`; PostgreSQL interprets
the timestamp input `now` as current transaction time. Reference:
[PostgreSQL 17 special date/time values](https://www.postgresql.org/docs/17/datatype-datetime.html#DATATYPE-DATETIME-SPECIAL-TABLE).
Token, expiry equality, lifecycle pointers, and nondeleted predicates remain in
the same conditional update. Both expiry cases and normal unexpired completion
now pass. This is application query construction, not a schema/RPC change.

- Scope: `completeIndexingExecution`, exercised via `indexExperienceRevision`.
- Defect analysis: application/database clock disagreement could permit expired
  cleanup; fixed using a database-evaluated timestamp input.
- Generated cases: exact-expiry and after-expiry preservation of the entire
  pre-cleanup source state and original preparation error.
- Verification: full suite **123 passed, 0 failed, 32 suites** after correction.
  No coverage threshold was requested; coverage measurement was skipped.
  Required test preparation and `utree flush` completed.
- An isolated installed PostgREST-client transport check confirmed PATCH filter
  serialization to `gt.now` with zero network requests. The initial full-client
  harness hit the existing Node 20 native-WebSocket limitation before sending a
  request; using its installed PostgREST client directly passed. This does not
  claim new remote execution of the application cleanup query.

## Browser Conflicts (11.7)

The review client now blocks duplicate in-flight Index actions, refreshes on
HTTP 409, preserves the conflict explanation, and requires another explicit
Index action against successfully refreshed latest-approved state. It never
falls back to an older active revision. Failed refresh leaves Index disabled
until Refresh State succeeds. Approved and active identities remain distinct,
with an explanation that existing active evidence stays searchable.

Executed the repository fixture against a loopback Next preview with dummy
Supabase/Gemini credentials. Playwright 1.62.1 came from the existing npm cache:

```sh
PLAYWRIGHT_MODULE_PATH=/Users/bytedance/.npm/_npx/e41f203b7505f1fb/node_modules/playwright \
perl -e 'alarm shift; exec @ARGV' 120 \
node app/lib/experience/retryConflicts.browser.mjs
```

| Scenario | Result | Index POST revisions | Total detail reads | Escaped requests |
| --- | --- | --- | ---: | ---: |
| Newer approved | PASS | `r1`, then explicit `r2` | 4 | 0 |
| Newer published | PASS | `r1` only | 3 | 0 |
| Refresh failure and recovery | PASS | `r1`, then explicit `r2` | 5 | 0 |
| Lease conflict, unchanged candidate | PASS | `r1` only | 3 | 0 |

Each conflict added exactly one detail refresh and sent exactly one old-revision
POST during the 600-ms no-retry observation window. Total reads also include
initial development-mode loads and explicit successful-action refreshes.
Manual refresh sent no Index POST. Newer publication displayed approved and
active `r2` and removed the Index action. All four scenarios had zero page errors.
Every API was intercepted; unexpected APIs/external requests were blocked and
asserted absent, with service workers disabled. No real API, Gemini, Storage, or
database operation was performed. The isolated preview was stopped afterward.

## Final Acceptance (11.8, 10.4)

| Check | Result |
| --- | --- |
| `npm run test:experience` | PASS, 123 tests across 32 suites |
| Updated API/planning/workflow documentation tests | PASS, 5 tests |
| Four browser conflict fixtures | PASS |
| `npm run lint` | PASS |
| `npx tsc --noEmit` | PASS |
| `npm run build` | PASS, rerun after final expiry fix |
| `openspec validate add-structured-project-ingestion --type change --strict --json` | PASS, no issues |
| `git diff --check` | PASS |
| Repository SQL SHA-256 recheck | All three match the recorded hashes |

The build used loopback-invalid Supabase URL `http://127.0.0.1:1` and
`browser-fixture-only` credentials. It is an isolated verification build, not a
deployment configured for production. Existing Node 20 deprecation and
out-of-repository lockfile warnings did not fail the build.

Implementation documentation retains earlier acceptance evidence and configured
upload/extraction/planning limits, and now records the three-chunk/75-second
embedding preparation defaults, fresh current-retry leases, authoritative
publication responses, database-time conditional cleanup, and explicit conflict
refresh/retry controls.

The remote results in sections 11.1-11.5 remain the evidence for the unchanged
database RPCs. Every final fixture run rolled back, failed attempts were rolled
back as documented, and all nine persistent data/Storage metadata fingerprints
matched the baseline. No further database execution occurred during the
authorized application phase; the local database, existing migrations, migration
history, and original remote report remain untouched. No receipt schema,
backfill, real Storage mutation, JD-fit implementation, formal RAG evaluation,
deployment, archive, or git commit was performed.

Limitations: browser API responses and service database interactions are mocked;
the new cleanup query was not exercised against remote PostgREST. Remote checks
simulate state ordering sequentially, not concurrent database sessions. Actual
Storage cleanup remains outside this rollback-only follow-up. These boundaries
match the approved verification tasks and are not claims of live end-to-end
deployment validation.
