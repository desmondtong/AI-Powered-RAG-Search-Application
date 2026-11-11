# Remote Supabase Alignment

Date: 2026-10-29
Change: `add-structured-project-ingestion`
Project: `lwljmmfcvmbnrfstltzj`
Access: Supabase MCP; project URL confirmed against the application's configuration.

## Result

Five missing database RPCs were deployed through MCP. A sixth migration closes a verified execution-token fencing gap in embedding staging and publication. The remote database now has the documented ingestion database objects plus the fencing fix; the scoped lifecycle and concurrency checks below pass.

OpenSpec reports 50/50 tasks complete and strict validation passes. Remote verification was performed independently of those checkboxes.

## Deployed This Session

| Migration | Remote Version | RPC |
| --- | --- | --- |
| approve_experience_revision | 20261029100021 | approve_experience_revision |
| create_draft_from_approved | 20261029100036 | create_experience_draft_from_approved |
| publish_experience_revision | 20261029100104 | publish_experience_revision |
| approved_experience_search | 20261029100121 | match_approved_experience_chunks |
| delete_experience_source | 20261029100139 | delete_experience_source |
| experience_index_execution_fencing | 20261029100806 | stage_experience_embeddings; token-fenced publish_experience_revision |

The first five migrations implement the existing local migration logic. The fencing migration and application changes add token-checked staging, pass the acquired lease to publication, and consume it atomically. No foundation RPC signature, generic table, or existing source file was changed.

Before deployment, the five registry tables, private `experience-sources` bucket, invariant triggers, reservation/reconciliation helpers, and execution/draft-update helpers were already present remotely.

## Remote Verification

Synthetic SQL checks ran inside transactions ending in `ROLLBACK`, including a lifecycle run under `service_role`.

Passed:

- Byte-identical source reservation and storage-state reconciliation.
- Competing lease rejection, lease replacement, and stale completion rejection.
- Optimistic draft saves and stale approval rejection.
- Approval without publication; approved-content and extraction immutability.
- Rejection of an unpublished active pointer.
- Multi-parent publication; an invalid child rolls back all new evidence.
- Idempotent publication, selected-source search, empty selection, and unknown-source rejection.
- Draft cloning without changing active evidence.
- New approval blocks older publication; replacement removes old live parents and children while retaining accepted history.
- Coordinated deletion, cascading evidence removal, idempotent deletion, and post-deletion publication rejection.
- Foundation search, exact citations, orphan rejection, cascading deletion, cosine HNSW index, and server-only access.
- Expired and replaced tokens cannot stage or publish; tokenless publication is rejected.
- Current-token staging and publication succeed; both first publication and idempotent RPC retry clear the lease atomically.

Catalog checks confirmed RLS on every experience table, indexed foreign keys, and service-role-only experience function execution. The unfenced ten-argument publication overload was removed; the new signature adds `p_execution_token uuid`. No experience function uses `SECURITY DEFINER`.

Counts before and after verification:

| Record | Before | After |
| --- | ---: | ---: |
| Generic document rows | 8 | 8 |
| Evidence parents | 0 | 0 |
| Evidence children | 0 | 0 |
| Experience sources | 0 | 0 |
| Experience revisions | 0 | 0 |
| Storage objects | 2 | 2 |

No live Gemini, real file upload, browser workflow, or complete existing `experience_registry.sql` execution was performed in this session. The scoped remote SQL lifecycle checks above were used instead.

## Closed Behavioral Gap

The design requires every staging/completion write to check current execution ownership and publication to reject stale tokens.

An isolated remote probe acquired an indexing lease, expired it, inserted a prepared staging row, and successfully called `publish_experience_revision`. The entire probe was rolled back.

The original publication RPC had no execution-token argument, and the application checked the lease only after publication. That could not roll back an already committed publication. Staging also used direct writes rather than a token-fenced operation.

After user approval, the application was updated to call `stage_experience_embeddings` with its acquired token and to pass that token to publication. Both RPCs validate token, stage, expiry, source ownership, and deletion state with source-then-revision locking. Publication consumes the lease in its own transaction, including idempotent RPC retries. Direct service-role SQL remains privileged administrative access; application staging no longer uses direct upserts.

Repeatable rollback-only fencing checks are in `supabase/checks/experience_index_fencing.sql`. Existing registry checks were updated for token-bearing publication calls. Local checks passed: 109 experience tests, `npx tsc --noEmit`, lint, production build, and strict OpenSpec validation. The build warns that Node 20 is deprecated by supabase-js; Node 22+ is recommended.

## Migration History

The four earlier experience migrations have objects present remotely but no corresponding entries in `supabase_migrations.schema_migrations`. Foundation migration timestamps also differ from local filenames, and MCP assigned new timestamps to the six migrations applied here.

No history entries were fabricated or renamed. Before using CLI push/pull, reconcile migration history separately after validating schema equivalence; blindly replaying the local migrations could fail on already-existing objects.

## Advisors

No experience-specific security warning or missing foreign-key index was reported.

- RLS with no policies is informational and intentional for service-role-only tables: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Existing generic `match_documents` has a mutable search path: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
- Existing `vector` extension is installed in `public`: https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public
- Unused experience indexes are informational on the currently empty experience corpus: https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index

The generic-function and extension warnings were not changed because this change preserves the foundation and generic workflow.
