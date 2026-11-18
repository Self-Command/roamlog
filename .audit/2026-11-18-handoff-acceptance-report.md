# W0_HANDOFF_QA — 交接验收报告

- **状态**: `NEEDS_REVIEW`（验收结论 **ACCEPT: NO / CHANGES_REQUESTED**）
- **任务 ID**: `W0_HANDOFF_QA`（只读 qa_verifier，未修改任何产品代码）
- **快照时间**: 2026-11-18 18:07 (+08:00)。分支 `main`，HEAD `b96ca9b`，未提交条目 **84**
- **快照漂移**: 18:26 复查时为 86 条，新增的 2 条是 `apps/admin/next-env.d.ts`、`apps/web/next-env.d.ts`（**由我的 build/typegen 触发**，`.next/dev/types` → `.next/types`，非他人改动）。本报告结论以 18:07 快照为准。

---

## 1. 结论摘要（先看这里）

| # | 结论 | 严重度 | Owner |
|---|---|---|---|
| F1 | `pnpm --filter @roamlog/web build` **失败**：`packages/api-mocks/src/demo-content.ts:585-586` 的 `StopSchema.parse` 抛 ZodError（新增必填 `provider` / `providerPlaceId` / `timeZone`），Next 预渲染 `/_not-found` 时中止构建，exit 1 | HIGH（阻断交接） | `W0_CONTRACTS`（契约加字段未同步 mocks） |
| F2 | `pnpm --filter @roamlog/api test` **失败 8 项**（257 通过）：`presentTrip` / `presentStop` / 公开分享 payload 未产出新增必填字段，运行时 `TripSchema/StopSchema/PublicMediaSchema.parse` 抛错 → **已确认 create trip 返回 500**、公开分享读取抛 ZodError | CRITICAL（真实 500） | `W0_CONTRACTS`（读契约先改、生产者未适配） |
| F3 | 审计 UUIDv4 读取兼容**行为正确且仅放宽读取**（详见 §5），Admin P0 无阻断问题 | — | `fix_admin_p0_audit_contract` ✅ |
| F4 | `AdminAuditQuerySchema.actorId` 仍为 `UuidV7Schema` → 按历史 v4 actorId 过滤会 400（风险，按要求不修） | MEDIUM | `fix_admin_p0_audit_contract` |
| F5 | 构建会改写受版本控制的 `apps/{admin,web}/next-env.d.ts`（本次已发生），提交前必须还原 | LOW | `ROOT_TRIAGE` |
| F6 | `.gitignore` 新增 `.codegraph/` 规则，属两批之外的卫生改动（符合 AGENTS.md），非越界 | INFO | `ROOT_TRIAGE` |

**是否可交接**：契约层（W0_CONTRACTS 的生成物一致性）与 Admin P0 部分是干净的；但 W0_CONTRACTS 的读契约扩张**未完成全链路适配**，导致 Web 构建红灯 + API 8 项集成测试红灯（含 500）。**当前状态不可交接、不可并行开发**，需先修 F1/F2。

---

## 2. 变更文件清单与分类

### 2.1 原始数据

- `git log -1 --oneline` → `b96ca9b fix(api): use execute raw for workspace onboarding lock`
- `git status --porcelain=v1` → 84 条（原始快照：`.audit/evidence/handoff-2026-11-18/01-git-status.txt`）
- `git diff --name-status` → 45 条（41 M / 4 D / 0 A 已跟踪）；`git diff --stat` → 45 files, +3223 / −437
- 未跟踪新增：38 个文件（`apps/api/test/admin-audit-uuid-compat.e2e-spec.ts`、`packages/contracts/src/api/places.ts`、`packages/contracts/scripts/openapi/paths-places.ts`、`packages/api-client/src/generated/endpoints/places/`、33 个生成 schema）+ `.audit/`

### 2.2 分类

| 批次 | 文件 | 判定 |
|---|---|---|
| **W0_CONTRACTS** | `packages/contracts/src/{api/{index,media,places,share-links,stops,trips}.ts,entities/{stop,trip}.ts,__tests__/{entities,openapi}.test.ts}`、`packages/contracts/scripts/**`、`packages/contracts/openapi.json`、`packages/api-client/src/generated/**`（含 4 个删除的 `*Variants.ts` + 33 个新 schema/endpoint） | 在批次内 |
| **ADMIN_P0** | `packages/contracts/src/entities/audit-log.ts`、`packages/api-client/src/generated/schemas/{auditLog,adminAuditPageItemsItem,workspaceAuditPageItemsItem}.ts`、`apps/api/src/modules/admin/__tests__/admin-audit.service.spec.ts`、`apps/api/test/admin-audit-uuid-compat.e2e-spec.ts`(新增)、`apps/admin/lib/admin-data-source.ts`、`apps/admin/components/dashboard/dashboard-view.{tsx,test.tsx}` | 在批次内 |
| **SUPPORT** | `.gitignore`（+`.codegraph/`） | 批次外、良性（符合 AGENTS.md）；**不是越界** |
| **审计产物** | `.audit/**` | 可接受 |
| **越界/夹带** | **无**。无迁移、无 `prisma/schema.prisma` 改动、无 `package.json`/`pnpm-lock.yaml`、无 `.env`、无其它模块业务代码 | ✅ |

**注意**：F1/F2 的根因文件 `packages/api-mocks/src/demo-content.ts`、`apps/api/src/modules/trips/content-presenters.ts`、`apps/api/src/modules/share-links/share-links.service.ts` **都不在本次 diff 中** —— 即“未修改的消费者被新契约打破”，属跨模块影响，归属应记 `W0_CONTRACTS`。

### 2.3 敏感信息扫描（不输出值）

| 检查 | 结果 |
|---|---|
| tracked diff 的 `+` 行匹配 `api_key/secret/password/token/bearer/postgres://redis:///BEGIN PRIVATE KEY/sk-*/AKIA*/xox*/ghp_*` | 仅 2 处**测试标题**含 "secrets" 字样（`projects a serializable cover without storage secrets` 等），非真实密钥 |
| 真实邮箱 / 内网 IP（10./192.168./172.16-31） | 无命中 |
| 38 个未跟踪文件同规则扫描 | 干净 |
| `.env` / `.data/` / `.codegraph/` / 截图 / 日志 / dump / `.pem` 是否误入 | 无；仅已跟踪的 `.env.example`（未改动） |

**结论：未发现敏感信息泄漏。**

### 2.4 生成物一致性

| 命令 | 退出码 | 耗时 | 关键输出 |
|---|---|---|---|
| `pnpm contracts:check`（= contracts `contracts:check` + api-client `api-client:check`） | **0** | 5.5s | `OpenAPI contract is fresh: 92 paths, 203 schemas.` / `Generated API client is fresh: 23 endpoint files, 593 schema files.` |

- 被删除的 4 个 `*Variants.ts`（`publicMediaVariants` / `publicEntryMediaItemVariants` / `publicTripResponseMediaItemVariants` / `publicTripResponseEntriesItemMediaItemVariants`）：对 `packages`、`apps` 全量 grep（排除 node_modules/dist）**零残留引用**，无悬空 import。
- `openapi.json` 新契约存在性（脚本核对）：`/v1/places/search` ✅、`GET /v1/media/{mediaId}` ✅、`Trip.cover` ✅、`Trip.durationDays` ✅、`PublicMedia` / `GetMediaResponse` schema ✅、`PublicTripResponse` = `{trip,stops,entries,media,budget}` ✅。UUID 相关 schema 只有 `UuidV7`（`AuditRecordUuid` 是 Zod 内部 const，未导出到 OpenAPI —— 符合“仅放宽读取、不改公开契约”的意图）。
- **未重新生成**任何产物（约束遵守）。

---

## 3. 验证命令与结果

顺序执行，原始日志在 `.audit/evidence/handoff-2026-11-18/`。

| # | 命令 | 退出码 | 耗时 | 关键输出 | 归属 |
|---|---|---|---|---|---|
| 1 | `pnpm contracts:check` | **0** | 5.5s | OpenAPI 92 paths/203 schemas fresh；api-client 23 endpoints/593 schemas fresh | ✅ |
| 2 | `pnpm --filter @roamlog/contracts typecheck` | **0** | ~6s | `tsc --noEmit` 无输出 | ✅ |
| 3 | `pnpm --filter @roamlog/contracts test` | **0** | 2s | 7 files / **52 tests** 全通过 | ✅ |
| 4 | `pnpm --filter @roamlog/api typecheck` | **0** | 8s | 干净 | ✅ |
| 5 | `pnpm --filter @roamlog/web typecheck` | **0** | 14s | `next typegen` + `tsc --noEmit` 干净（注：typecheck 抓不到 F1，因为 `schema.parse(unknown)`） | ✅ |
| 6 | `pnpm --filter @roamlog/admin typecheck` | **0** | 6s | 干净 | ✅ |
| 7 | `pnpm --filter @roamlog/api exec vitest run src/modules/admin/__tests__/admin-audit.service.spec.ts` | **0** | 4s | 1 file / 4 tests | ✅ |
| 8 | `pnpm --filter @roamlog/admin exec vitest run components/dashboard/dashboard-view.test.tsx` | **0** | 4s | 1 file / 4 tests | ✅ |
| 9 | `pnpm --filter @roamlog/admin build` | **0** | 16s | Next build 成功 | ✅ |
| 10 | `pnpm --filter @roamlog/web build` | **1** | 14s | **F1**：`ZodError` @ `packages/api-mocks/src/demo-content.ts:586`，`provider` 期望 `photon\|local`、`providerPlaceId`/`timeZone` 为 undefined → `Export encountered an error on /_not-found/page` | ❌ `W0_CONTRACTS` |
| 11 | `pnpm --filter @roamlog/admin test` | **0** | 15s | 16 files / **44 tests** | ✅ |
| 12 | `pnpm --filter @roamlog/api test`（含集成，`ROAMLOG_TEST_DATABASE_URL` 指向真实 PG） | **1** | 53s | **8 failed / 257 passed / 6 skipped**（4 文件）：`collab-share`、`content-stops`、`content-trips`(×5)、`trip-origin`(×2) | ❌ `W0_CONTRACTS` |
| 13 | `pnpm --filter @roamlog/db test` | **0** | 3s | 4 files / **21 tests**（含 `seed.integration.test.ts` 对真实 PG 的种子幂等/租户隔离） | ✅ |
| 14 | `ROAMLOG_TEST_DATABASE_URL=... vitest run test/admin-audit-uuid-compat.e2e-spec.ts` | **0** | 26s | 1 test 通过（见 §5） | ✅ |
| 15 | `vitest run test/admin-routes.e2e-spec.ts` | **未覆盖** | — | 时间预算内未执行（需 Redis/S3，可能环境缺失） | — |

Web build 失败**不是**环境变量问题（`NEXT_PUBLIC_*` 缺失会导致另一种报错）：日志显示 `✓ Compiled successfully in 4.4s` 后进入 `Collecting page data using 15 workers ...` 阶段，由 Zod 校验失败触发。

---

## 4. 静态审查（CodeGraph）

### 4.1 审计 UUIDv4 只读兼容 —— 通过

- `AuditRecordUuidSchema = z.uuid()`（`packages/contracts/src/entities/audit-log.ts:11`），仅替换 `id` / `actorId` / `targetId` / `workspaceId` 四处**读取**校验；`.strict()` 保留。
- 实测 Zod 4.6.7 行为：`z.uuid()` 接受 v1/v4/v7，拒绝 `not-a-uuid` 与无连字符畸形串；`z.uuidv7()` 明确拒绝 v4（证明放宽是真实且必要的）。
- 生产侧未放宽：`packages/db/prisma/schema.prisma:762` 仍为 `id String @id @default(uuid(7)) @db.Uuid`，**该文件不在 diff 中**；无迁移、无历史审计改写（`git diff --name-status` 无 `prisma/migrations/**`）。
- 读取链路：`presentAdminAuditLog`（`apps/api/src/modules/admin/admin.presenters.ts:22`）→ `AuditLogSchema.parse`；`presentAuditLog`（`audit.service.ts:106`）同 schema，因此 workspace 审计读取同样受益。
- 测试覆盖：`admin-audit.service.spec.ts`（4 用例）+ 新 e2e（v4 行 4 端点 200）。
- **风险 F4**：`AdminAuditQuerySchema.actorId`（`packages/contracts/src/api/admin.ts:175`）仍 `UuidV7Schema`，用历史 v4 actorId 过滤 → 400。同类问题可能存在于 `WorkspaceAuditQuerySchema`（未逐条验证，标为待确认）。

### 4.2 Admin 总览分区块降级 —— 逻辑正确，测试有小缺口

`combineDashboardResources`（`apps/admin/lib/admin-data-source.ts:277`）：

| 要求 | 实现 | 判定 |
|---|---|---|
| 单数据源失败只降级该区块 | `fatalError = authFailure ?? (allFailed ? failures[0] : null)`；非致命时仍返回 `{...map(), sources}`，视图按 `sources[x].status` 分区渲染 `DashboardSourceNotice` | ✅ |
| 认证/权限失败仍整页失败 | `AUTH_FAILURE_CODES = {ADMIN_ACCESS_DENIED, ADMIN_ACTION_FORBIDDEN, ADMIN_2FA_REQUIRED, UNAUTHENTICATED}` → `fatalError` → `data=null` → `AdminDataBoundary` 渲染整页 `role="alert"` | ✅ |
| 不把 `EMPTY_ADMIN_METRICS` 的 0 当真实数据 | metrics 失败时 `data.metrics` 确实为全 0，但视图用 `metricsReady` 门控：核心指标卡、趋势图、队列健康、`generatedAt` 全部替换为错误/占位；组件测试断言 `queryByText("用户总数")` 为 null 且区块内有 `role="alert"` | ✅（0 值仅作为**不可达的兜底**存在，未渲染） |
| `isLoading` 语义 | `Object.values(queries).every(q => q.isLoading)` —— 只有**全部**加载中才为 true | ⚠️ 语义偏差：1 源失败 + 其余加载中时 `isLoading=false`、`data` 非空（非致命），会先渲染“部分错误 + 部分 loading”，符合降级意图但与传统 `some()` 语义不同；建议注释说明 |
| `refetch` | 每个 `sources[x].refetch` 只重取该数据源；顶层 `resource.refetch` 重取全部 | ✅ |
| `degraded` | `degradedFromQueries(全部 query)` 聚合 `x-roamlog-degraded` 头 | ✅ |
| 组件测试覆盖 | 覆盖 emails / audit / metrics 三种单区块失败 + emails “重试”按钮点击（4 用例）；**未覆盖** `combineDashboardResources` 的致命分支（auth 失败整页、三源全挂），CodeGraph blast radius 显示该函数“no tests found within 3 caller hops” | ⚠️ 缺口（非缺陷） |
| 类型契约 | `AdminDashboardResourceData extends AdminDashboardData { sources }`；`DashboardViewProps.data: AdminDashboardData & { sources?: AdminDashboardSources }`，页面 `AdminDataBoundary` 泛型消费正确 | ✅ |
| `any` / `ts-ignore` / 空 `catch {}` / `eslint-disable` | diff 中 **0 命中** | ✅ |
| 前端吞错掩盖 500 | 未发现：`failureFromQuery` 把 `status>=400` 转 `AdminApiFailure`，视图显示 code + detail，不吞错 | ✅ |

**CodeGraph 证据**:
- `codegraph explore "AuditLogSchema AuditRecordUuidSchema presentAdminAuditLog AdminAuditPageSchema AdminAuditQuerySchema"` → 命中 `packages/contracts/src/entities/audit-log.ts:11,15`、`packages/contracts/src/api/admin.ts:173-201`、`apps/api/src/modules/admin/{admin.presenters.ts:22,admin-audit.service.ts:48}`；blast radius：`AdminAuditPage` 2 callers、`AdminAuditQuerySchema` 2 callers、`AuditLogSchema` 6 callers。
- `codegraph explore "useAdminDashboardResource combineDashboardResources dashboardSourceState AdminDashboardSources DashboardView"` → 调用链 `useAdminDashboardResource(636) → combineDashboardResources(277) → dashboardSourceState(262)`；动态分发 `AdminOverviewPage → DashboardView`。
- `codegraph explore "AdminDataBoundary admin-data-boundary.tsx"` → 21 callers，确认整页错误/加载/空态三态处理。

---

## 5. 真实 PostgreSQL 证据

环境：仓库内 embedded PG **17.11**（`@embedded-postgres/windows-x64`），`initdb -A trust -E UTF8 --locale=C`，数据目录 `.data/handoff-qa-20261118/pgdata`，端口 **55440**，仅监听 `127.0.0.1`。测试后 `pg_ctl stop -m fast` 已执行，**数据目录保留（51 MB）**。

> 环境缺口：该 embedded 包**只带 `initdb/pg_ctl/postgres`，没有 `createdb/psql`**。因此建库与 SQL 取证改用仓库已有的 `pg` (8.23.1) 驱动执行等价 SQL（`CREATE DATABASE roamlog_handoff`、`information_schema` 查询），不改变取证含义。

| 证据 | 结果 |
|---|---|
| 迁移（空库） | `Applying migration 0001_init` / `0002_two_factor_state` → `All migrations have been successfully applied.` exit 0 |
| 幂等（第二次） | `No pending migrations to apply.` exit 0 |
| `prisma migrate status` | `Database schema is up to date!` exit 0；`_prisma_migrations` 两条均 applied |
| `AuditLog.id` 列默认值 | `column_default = null`、`data_type = uuid` —— 迁移 SQL 为 `"id" UUID NOT NULL`，**无服务端 DEFAULT**（Prisma 的 `uuid()` 由客户端生成，非 DB 默认）。`schema.prisma` 仍声明 `@default(uuid(7))` |
| 新记录仍是 v7 | Prisma 实测创建（不带 id）→ `id=01a1ee31-471e-75cf-90f1-5abe3168434c`，版本 nibble = **7**（探针脚本 `.audit/evidence/handoff-2026-11-18/19-uuid7-probe.mts`，创建后已删除该行） |
| v4 只读兼容、不被改写 | 直接插入 v4 行 `9f1b1c2d-…-4a5b-…`（version nibble=4）→ 回读 `id` **完全不变**、`action` 不变 → 无触发器改写；非法值 `not-a-uuid` 被 DB 拒绝（`invalid input syntax for type uuid`） |
| UUIDv4 审计 e2e | `test/admin-audit-uuid-compat.e2e-spec.ts` **1/1 通过**（26s）：Prisma 写入 v4 审计 → `GET /v1/admin/audit` **200** 且 items 含该 v4 `id`/`targetId`/`action`；`GET /v1/admin/audit/export` **200** 且 CSV 含该 id；`GET /v1/admin/metrics`、`GET /v1/admin/emails` 均 **200**（不再因 v4 行 500） |
| db 包集成测试 | `pnpm --filter @roamlog/db test` 21/21 通过，含 `seedDemoData against PostgreSQL`（幂等 + 租户隔离），说明迁移后数据约束可用 |

**结论**：F3 成立 —— 审计 UUIDv4 读取兼容在真实 PG 上不再 500，数据库侧仍生成 v7，历史行保持原样。

---

## 6. 已知风险

1. **F2 是真实产品缺陷，不只是测试问题**：`POST /v1/workspaces/:id/trips` 等写路径返回 **500**（`expected 500 to be 201`），公开分享读取 throw ZodError。任何依赖创建旅行/读取公开分享的并行任务都会被阻断。
2. **F1** 使 `apps/web` 无法构建；`packages/api-mocks` 同时被 web 演示态与若干测试使用，修复面可能扩大。
3. `AdminAuditQuerySchema.actorId` 仍 `UuidV7Schema` → 按 v4 actorId 过滤 400（F4）。
4. `next-env.d.ts` 被 build/typegen 改写为 `.next/types/*`（dev 路径丢失），提交前需还原，否则会夹带噪声（F5）。本次未还原（禁 `git checkout`）。
5. `contracts:check` 与 `api-client:check` 都是“重生成后比对”，**只证明生成物与当前源码一致**，不能证明契约本身对消费者安全（F1/F2 正是反例）。
6. 我的 `api test` 影响了本地 QA 库数据（e2e 会写行、seed 集成会播种）；不影响仓库与生产。
7. 18:26 起工作树已被并行任务改动，本报告不涵盖 18:07 之后的任何变更。

---

## 7. 未覆盖项（明确未执行）

- `pnpm --filter @roamlog/api exec vitest run test/admin-routes.e2e-spec.ts`（时间预算）
- Web / Admin 全量 E2E（Playwright `e2e:web` / `e2e:api`）、MSW 演示态回归
- 可访问性（a11y）审计、视觉回归、桌面/移动端视觉检查
- staging 环境、TLS/DNS、真实 OAuth/Resend、Docker 镜像、k6 压测、备份恢复与迁移回滚演练
- `WorkspaceAuditQuerySchema.actorId` 是否为 v7 的逐条确认
- lint（`pnpm lint`）与 `turbo` 全量流水线
- W0_CONTRACTS 新增 `/v1/places/search` 的 API 实现侧行为（仅校验了 OpenAPI 与生成物存在性）
- `pnpm --filter @roamlog/web build` 修复后复跑

---

## 8. 建议的下一步（按优先级）

1. **`W0_CONTRACTS` 补适配（阻断项）**：
   - `apps/api/src/modules/trips/content-presenters.ts`：`presentTrip` 补 `durationDays`（复用契约 `tripDurationDays`）、`cover`（含 `mediaId/status/url/thumbUrl/width/height/blurhash/expiresAt`）、`originLat/originLng/originCountryCode`、`timeZone`；`presentStop` 补 `provider/providerPlaceId/timeZone`。
   - `apps/api/src/modules/share-links/share-links.service.ts`：公开分享 payload 补 `media[].url/thumbUrl/...` 与 trip 的 `cover/durationDays`。
   - `packages/api-mocks/src/demo-content.ts`：stop 种子补 `provider:"local"`、`providerPlaceId:"…"`、`timeZone:"Asia/Shanghai"` 等合法值；trip 种子补 `cover`/`durationDays`。
2. 复跑：`pnpm --filter @roamlog/web build`、`pnpm --filter @roamlog/api test`（期望 8 项转绿）。
3. **`fix_admin_p0_audit_contract`**：记录 F4 风险；若要在 UI 用历史 actorId 过滤，需把 `actorId` 放宽为 `AuditRecordUuidSchema`（或明确产品不接受 v4 过滤）。
4. **`W0_CONTRACTS` 补测试**：给 `combineDashboardResources` 的致命分支（auth 失败、三源全挂）加单测；给 `DashboardView` 加 metrics 失败时"不出现 0 值"的断言。
5. **提交前**：还原 `apps/{admin,web}/next-env.d.ts`；确认 `.gitignore` 的 `.codegraph/` 规则是否随本批提交。

---

## 9. 证据路径

原始日志/清单（已脱敏，无密钥/无真实邮箱）：

```
.audit/evidence/handoff-2026-11-18/
├── 01-git-status.txt            变更快照（84 条）
├── 02-admin-data-source.diff    Admin 数据源 diff
├── 10-initdb.log                initdb 输出
├── 11-pg-server.log             PG 17.11 启动日志（127.0.0.1:55440）
├── 12-migrate.log               迁移 ×2 + migrate status
├── 13-builds.log                admin(0) / web(1) 构建
├── 14-unit-tests.log            契约/api spec/admin 组件测试
├── 15-uuid-compat-e2e.log       UUIDv4 审计 e2e（1 passed）
├── 16-db-evidence.log           列默认值 / 迁移表 / 行数
├── 17-db-tests.log              db 包 21 tests
├── 18-v4-row-probe.log          v4 行插入-回读-非法值拒绝
├── 19-uuid7-probe.mts/.log      Prisma 生成 v7 的探针
├── 20-api-full-tests.log        api 全量（8 failed）
└── 21-admin-full-tests.log      admin 全量（44 tests）
```

PG 数据目录：`.data/handoff-qa-20261118/pgdata`（保留，服务已 stop）
