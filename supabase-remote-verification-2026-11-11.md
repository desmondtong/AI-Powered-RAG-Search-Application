# 远程 Supabase 验证报告

日期：2026-11-11
项目：`lwljmmfcvmbnrfstltzj`
URL：`https://lwljmmfcvmbnrfstltzj.supabase.co`
OpenSpec：`add-structured-project-ingestion`

## 结论

通过 Supabase MCP 的 `get_project_url` 确认目标项目，使用远程 `execute_sql`、`list_migrations` 和两类 `get_advisors` 完成检查。未使用本地数据库作为证据。

远程数据库与当前本地迁移的目标实现一致，但不能判定完全符合 OpenSpec：已复现一处旧版发布重试契约偏差，另有迁移历史漂移。没有发现缺失的目标表、RPC、RLS、触发器或索引。

本次未修改远程 schema、权限、迁移历史或实际 Storage 对象。

## 已确认符合

- 七张表均启用 RLS，没有浏览器策略：`parent_documents`、`document_chunks`、`experience_sources`、`experience_extractions`、`experience_revisions`、`experience_revision_parents`、`experience_index_staging`。
- `anon` 和 `authenticated` 对七张表没有表级或列级访问权限；`service_role` 具备所需读写权限。其实际权限还包括 TRUNCATE、REFERENCES、TRIGGER，属于比最低业务需求更宽的服务角色授权，没有因此形成浏览器访问通道。
- 下列 13 个 RPC 的签名和返回类型符合当前迁移，均为 SECURITY INVOKER，固定 search_path，浏览器角色无 EXECUTE，service_role 有 EXECUTE。
- 五个 experience 不变量触发器函数同样为 SECURITY INVOKER，且不向浏览器角色开放。
- 19 个相关函数体与本地目标定义一致：10 个原始函数体 MD5 相同；其余 9 个读取完整 prosrc 后按 SQL token 比较一致，仅格式不同。发布函数的本地目标定义包含 fencing 迁移的字符串变换结果。

| RPC | 关键参数 |
| --- | --- |
| `match_document_chunks` | vector, double precision, integer |
| `insert_project_evidence` | jsonb, jsonb |
| `reserve_experience_source` | text, text, text, bigint, text, text |
| `reconcile_experience_source_storage` | uuid, text, text, text |
| `acquire_experience_source_execution` | uuid, text, integer |
| `complete_experience_source_execution` | uuid, uuid, text, text, uuid, uuid, jsonb |
| `update_experience_revision_draft` | uuid, integer, jsonb |
| `approve_experience_revision` | uuid, uuid, integer, jsonb, text |
| `create_experience_draft_from_approved` | uuid, uuid, uuid, jsonb, integer |
| `stage_experience_embeddings` | uuid, uuid, uuid, jsonb |
| `publish_experience_revision` | uuid, uuid, text, text, integer, integer, text, text, text, integer, uuid |
| `match_approved_experience_chunks` | vector, double precision, integer, uuid[] |
| `delete_experience_source` | uuid |

- 发布函数最后一个参数为 `p_execution_token uuid DEFAULT NULL`；省略 token 的实际调用被拒绝。旧十参数重载的 `to_regprocedure(...)` 返回 NULL。
- 来源所属的 extraction/draft/approved/active 指针验证触发器已启用；active 指针必须指向同源、有映射的 indexed revision。
- extraction 更新不可变、approved revision 内容不可变、revision/extraction 同源、revision/parent 同源验证触发器均存在且启用。
- execution_stage、execution_token、execution_token_expires_at、execution_started_at 列、token 一致性 CHECK 和 token/expiry 索引存在。
- 目标 CHECK、FK、PK、UNIQUE 约束均已验证；所检查的索引全部 valid/ready。外键缺失前导索引查询返回空集。
- live 文件 hash/path 部分唯一索引、approved hash 唯一索引、revision/logical parent 和 revision/logical chunk 唯一约束存在。
- evidence 与 staging embedding 均为 `vector(1536)`；`document_chunks_embedding_idx` 为 HNSW `vector_cosine_ops`。
- chunk 到 parent、mapping 到 parent/revision、staging 到 revision 的 CASCADE，以及 revision 到 extraction 的 RESTRICT 符合迁移。
- `experience-sources` bucket 存在且 `public=false`；Storage objects 无策略。bucket 未被公开。
- 本地 experience 文件访问实现使用服务器 `.download(storage_path)`，未发现该路径生成永久公共 URL。此项是源码检查，不是已部署应用的运行时证明。

## 远程回滚检查

全部使用合成 SQL 数据；没有上传或删除 Storage 文件，没有调用 Gemini。

- 执行 `evidence_index.sql` 的全部断言，随后 ROLLBACK：精确引用、cosine 搜索、孤儿拒绝、parent 删除级联、HNSW 和 server-only 权限通过。
- 执行 `experience_index_fencing.sql` 的全部断言，使用 SET LOCAL ROLE service_role，随后 ROLLBACK：过期、被替换和空 token 拒绝；有效 token staging/publication、当前 active revision 幂等重试及租约原子清除通过。
- 执行额外 scoped lifecycle 检查，使用 service_role，随后 ROLLBACK：重复 reservation、storage 状态 reconciliation、租约冲突/接管、旧 completion 拒绝、乐观草稿保存、过期版本 approval 拒绝、内容不可变、未发布 active 指针拒绝、standalone/draft 排除、选定/空/未知 source 搜索、多 parent 失败回滚、完整替换、历史保留、协调及幂等删除、删除后禁止发布、standalone 保留通过。
- scoped 检查首次在预期的无效 child 上收到 `23514`，因检查脚本最初只捕获 `raise_exception` 而提前中止；修正为捕获 `check_violation` 后完整重跑通过。这不是远程原子性缺陷。
- 未完整执行 1075 行的 `experience_registry.sql`；上述 scoped lifecycle 不应表述为该脚本全量通过。

| 记录 | 检查前 | 检查后 |
| --- | ---: | ---: |
| generic documents | 8 | 8 |
| evidence parents / chunks | 0 / 0 | 0 / 0 |
| sources / extractions / revisions | 0 / 0 / 0 | 0 / 0 / 0 |
| mappings / staging | 0 / 0 | 0 / 0 |
| Storage objects | 2 | 2 |

## 偏差与问题

### 1. 已发布旧 revision 的重试不返回历史成功

严重度：中；已远程复现，不是本地推断。

复现：发布 R1，创建并批准 R2，发布 R2 完成替换，获取有效 indexing token，再对 R1 用原 hash/plan/config 调用发布 RPC。

实际：`SQLSTATE 40001`，`Experience publication candidate is stale`。

预期：design.md 第 191 行要求已发布 revision 返回先前成功，且不得重新激活被替换版本；spec.md 第 157-159 行要求丢失发布响应后重试返回 indexed 状态而不重复 evidence。

原因：`latest_approved_revision_id` 检查先于幂等分支，且分支只支持当前 active revision。旧映射在替换时删除，因此修复还需要保留可验证的历史 publication receipt，不能简单绕过候选校验。

本地 `20261029070512_publish_experience_revision.sql` 第 78-88 行同样如此；fencing 迁移保留该行为。这属于实现与契约的共同偏差，不是远程独有 schema 漂移。不会使旧 evidence 重新可见，但响应丢失跨越新版批准/替换时，不能兑现完整的幂等响应契约。

### 2. 迁移历史不一致

远程共有 9 条记录，本地共有 13 个迁移文件。目标对象存在与历史完整是两个不同结论。

| 远程版本 | 远程名称 |
| --- | --- |
| 20261028083152 | evidence_tables |
| 20261028083405 | evidence_search |
| 20261028083703 | evidence_insert |
| 20261029100021 | approve_experience_revision |
| 20261029100036 | create_draft_from_approved |
| 20261029100104 | publish_experience_revision |
| 20261029100121 | approved_experience_search |
| 20261029100139 | delete_experience_source |
| 20261029100806 | experience_index_execution_fencing |

没有对应远程历史项的本地迁移：`20261028000400_experience_registry.sql`、`20261029034026_experience_invariants.sql`、`20261029034319_experience_source_storage.sql`、`20261029035315_experience_execution_locks.sql`。其目标对象均已确认存在。

其余 9 个迁移名称与本地文件的描述后缀一致，但时间戳全部与本地不同。未伪造、重命名或修复历史记录。

### 3. Advisors

- Security：8 条 [RLS 无策略 INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)，service-role-only 表上符合项目设计。
- Security：1 条 [mutable search_path WARN](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)，对象为既有 `public.match_documents`，不在本次 experience RPC 中。
- Security：1 条 [extension in public WARN](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)，对象为既有 `vector` 扩展。
- Performance：14 条 [unused index INFO](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)。experience corpus 当前为空，不据此建议删除正确性或 FK 索引。
- 没有 experience-specific SECURITY WARN 或缺失 FK 索引报告；这不等同于对全部应用层安全作保证。

## 未确定范围

- 未验证已部署应用的外部访问控制、浏览器服务密钥泄漏、真实文件下载/上传、转换器、Gemini、完整 UI 或运行时性能。
- 没有双会话并发压测；lease/token/replacement 检查是事务内确定性状态模拟。
- 没有真实 Storage cleanup 故障注入；reconciliation 测试确认数据库 checkpoint，并未证明实际对象上传。
- 本次数据库证据不能单独证明所有应用层 OpenSpec 要求完成。

## 建议下一步

- 可继续在可信私有部署边界内使用该远程项目开展开发/验证；不要把结论写为“完全符合 OpenSpec”。
- 若需要严格契约验收，先确认并修复历史 publication 幂等响应：保留验证信息，同时维持最新候选、token fencing、删除及不重新激活旧版的边界。通过新的受控迁移同步本地与远程后再验证，不仅临时修改远程。
- 使用未来 CLI push/pull 前，单独审阅并协调迁移历史映射。不要盲目 `supabase db push` 或重放本地迁移。
- 通用 search_path/extension WARN 可独立治理；本次未自动修复或移动扩展。
