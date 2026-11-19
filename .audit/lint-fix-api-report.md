# LINT_FIX_API — `apps/api` 五条 lint 错误清零

状态: **DONE**
任务 ID: `LINT_FIX_API`
角色: backend_api
时间: 2026-11-19 (Asia/Shanghai)
Commit: `style(api): clear the five lint errors the full gate surfaced`（本地，精确路径）

---

## 1. 变更文件（7 个代码文件 + 本报告）

```
apps/api/src/modules/ai/ai-plan.service.ts
apps/api/src/modules/email/mail-test-rate-limit.guard.ts
apps/api/src/modules/redis/redis.service.ts
apps/api/src/modules/media/__tests__/media-motion-http.e2e.mts
apps/api/src/modules/reports/__tests__/moderation-http.e2e.mts
apps/api/src/modules/settings/storage-settings.consumer.ts          (根 Agent 授权)
apps/api/src/modules/ai/__tests__/adapters.integration.spec.ts      (根 Agent 授权)
.audit/lint-fix-api-report.md                                       (new)
```

未触碰 `share-links/**`、`apps/admin/**`、`apps/web/**`、`packages/**`、`e2e/**`。
`git diff --stat` 总计 **6 insertions / 8 deletions**，全部为一行级改动。

## 2. 错误清单与修法（逐条）

| # | 文件:行 | 成因 | 修法 |
|---|---------|------|------|
| 1 | `apps/api/src/modules/ai/ai-plan.service.ts:136` | `let pastDateIgnoredThisTurn = false`：该轮 `while` 体在 :205 无条件重置为 `false`，初值在任何读取（:313）之前必被覆盖，是死赋值 | 删初值保留类型：`let pastDateIgnoredThisTurn: boolean;`；:205 的逐轮重置与 :266 的置 `true` 均不动 |
| 2 | `apps/api/src/modules/email/mail-test-rate-limit.guard.ts:40` | `let retryAfterSeconds = MAIL_TEST_WINDOW_SECONDS`：`try`（Redis 成功 :48）与 `catch`（内存计数 :53）两条路径都先赋值，初值在 :64 读取前从未被读 | 删初值：`let retryAfterSeconds: number;`（与相邻的 `let count: number;` 同形） |
| 3 | `apps/api/src/modules/media/__tests__/media-motion-http.e2e.mts:88` | 清单写的 `redis.service.ts:88` 有误（该行是 `lazyConnect: false` 注释，文件内无 `parsed` 符号）；实测该规则命中在这个文件的 :88：`let parsed: Json = {}`，`try`/`catch` 都先赋值，初值在 :94 读取前从未被读 | 删初值：`let parsed: Json;`；赋值分支与返回值不变 |
| 4 | `apps/api/src/modules/redis/redis.service.ts:131` | `onModuleInit` 的 `catch (error)` 里 `throw new Error(...)` 未附 `cause`，原始 Redis 连接错误被丢弃（`preserve-caught-error`） | 第二个参数加 `{ cause: error }`，message 一字未改；ES2023 lib + Node 18+ 原生支持 `ErrorOptions`。这不只是 lint：启动失败时保留 `MaxRetriesPerRequestError` / 连接错误链，排障可追溯 |
| 5 | `apps/api/src/modules/reports/__tests__/moderation-http.e2e.mts:26` | `import { PrismaService }` 未使用：该测试用 `createPrismaClient(...)` + `PrismaModule` 直接建应用，没有 Nest 注入点，属多余 import（不是"注入但没用"） | 删该 import；同类多余 import `AdminReportsService`（:32）一并删除 |
| 6 | `apps/api/src/modules/reports/__tests__/moderation-http.e2e.mts:148` | 同文件同类 `let parsed: Json = {}` 死初值（清单外，根 Agent 授权同文件一次清干净） | 删初值：`let parsed: Json;` |
| 7 | `apps/api/src/modules/settings/storage-settings.consumer.ts:137` | `let items = new Map(...)` 初值从未被读：`try` 成功路径 :146 必覆盖，`catch` 路径在 :153 直接 `return`（清单外，根 Agent 授权，只改这一行） | 删初值：`let items: Map<string, AdminSettingItem>;`；该文件其余内容未动 |
| 8 | `apps/api/src/modules/ai/__tests__/adapters.integration.spec.ts:200` | `// eslint-disable-next-line no-console` 无效：根 eslint 配置未启用 `no-console`，属纯噪声 warning（根 Agent 授权删除） | 只删该注释行，`console.log` 保留 |

## 3. 验证命令与原始输出

### 3.1 `pnpm --filter @roamlog/api lint` → exit 0

```
$ eslint .
```
（无任何 error / warning；命令退出码 0）

### 3.2 `pnpm lint`（全仓）→ exit 0，0 error

```
   • Running lint in 11 packages
   • Remote caching disabled
...
@roamlog/worker:lint: ✖ 19 problems (0 errors, 19 warnings)
...
 Tasks:    11 successful, 11 total
Cached:    9 cached, 11 total
  Time:    4.42s
```
19 条 warning 全部为 `@roamlog/worker` 的 `@typescript-eslint/no-explicit-any`（`dependencies.ts` 3 条、`jobs/export.ts` 14 条、`jobs/types.ts` 1 条、`test/jobs.spec.ts` 1 条，合计 19），与本次改动无关。

### 3.3 `pnpm --filter @roamlog/api typecheck` → 0

```
$ tsc --noEmit
```
（无输出，退出码 0）

### 3.4 `pnpm --filter @roamlog/api exec vitest run src/modules/ai src/modules/email src/modules/redis src/modules/media` → 全绿

```
 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/api

 ✓ src/modules/ai/__tests__/ai.controller.spec.ts (6 tests)
 ✓ src/modules/redis/redis-resilience.spec.ts (6 tests)
 ✓ src/modules/media/__tests__/media-bucket.spec.ts (2 tests)
 ✓ src/modules/ai/__tests__/ai-plan.service.spec.ts (18 tests)
 ✓ src/modules/email/__tests__/mail.service.spec.ts (8 tests)
 ✓ src/modules/redis/redis-rate-limit.spec.ts (1 test)
 ✓ src/modules/media/__tests__/media-read.spec.ts (11 tests)
 ✓ src/modules/ai/__tests__/ai-stops-add.spec.ts (2 tests)
 ✓ src/modules/media/__tests__/media-motion.spec.ts (8 tests)
 ✓ src/modules/email/__tests__/mail-test.controller.spec.ts (6 tests)
 ✓ src/modules/ai/__tests__/ai-execute.service.spec.ts (8 tests)
 ✓ src/modules/ai/__tests__/ai-dates.spec.ts (5 tests)
 ✓ src/modules/ai/__tests__/ai-settings.spec.ts (9 tests)
 ✓ src/modules/redis/redis-revival.spec.ts (3 tests)
 ✓ src/modules/media/__tests__/media-url.service.spec.ts (11 tests)
 ✓ src/modules/email/__tests__/mail-test-rate-limit.guard.spec.ts (3 tests)
 ✓ src/modules/ai/__tests__/ai-quota.service.spec.ts (4 tests)
 ✓ src/modules/redis/redis-fail-open.spec.ts (3 tests)
 ✓ src/modules/media/__tests__/media-rules.spec.ts (4 tests)
 ✓ src/modules/redis/readiness-degraded.spec.ts (4 tests)
 ✓ src/modules/media/__tests__/trip-cover-projection.spec.ts (8 tests)
 ✓ src/modules/ai/__tests__/golden.spec.ts (3 tests)
 ✓ src/modules/ai/__tests__/adapters.integration.spec.ts (7 tests | 6 skipped)

 Test Files  23 passed (23)
      Tests  134 passed | 6 skipped (140)
   Duration  16.71s
```
6 skipped 是 `adapters.integration.spec.ts` 里 `describe.skipIf(!hasGateway)` 的真实网关用例（无 AI 网关密钥时既有行为，非本次引入）。

## 4. CodeGraph 证据

1. `codegraph_explore`（MCP，projectPath=`C:\Users\BY9700\Desktop\UI\roamlog`）查询 `ai-plan.service.ts pastDateIgnoredThisTurn`：返回 `apps/api/src/modules/ai/ai-plan.service.ts` 的逐行源码（含 :129-136 声明、:205 重置、:266 置 true、:313 读取），确认初值确实在任何读取前被覆盖；同文件 blast radius 显示 `AiPlanService.chat` 的调用方与 ai 模块测试。
2. `codegraph explore "MailTestRateLimitGuard canActivate RedisService onModuleInit"`：
   - `RedisService`（`apps/api/src/modules/redis/redis.service.ts:70`）— **55 callers**（bootstrap、rate-limit、admin-queue、admin-system 等 16+ 文件），tests: `bootstrap.spec.ts`、`rate-limit.service.spec.ts`、`mail-test-rate-limit.guard.spec.ts`、`job-queue.service.spec.ts` 等 21 个；
   - `MailTestRateLimitGuard`（:26）— 3 callers（`mail-test.controller.ts`、`mail.module.ts`）+ `mail-test-rate-limit.guard.spec.ts`；
   - `canActivate → withTimeout / incrementFixedWindow / incrementMemoryCounter` 调用链，与本次保持的赋值路径一致。
   → 据此确认：改的是死初值与错误 cause，不改变任何调用方契约；定向测试覆盖了这些调用链。

## 5. 已知风险

- **`redis.service.ts` 的 `cause`**：抛出的 message 不变，只多出 `error.cause`。若有日志/Sentry 序列化整条错误链，启动失败日志会附带原始连接错误——这是本次改动的目的（可排障），但不属于"字节级无变化"。该路径只在 `REDIS_REQUIRED=true` 且 Redis 不可达的启动失败时触发。
- **`.mts` e2e 文件不在 `tsc --noEmit` 的 include 内**（`apps/api/tsconfig.json` 只 include `src/**/*.ts`、`test/**/*.ts`），所以两个 `let parsed: Json;` 由 ESLint 解析器而非 tsc 校验；运行时语义不变（`try` 与 `catch` 都会在返回前赋值，不存在未赋值路径）。`moderation-http.e2e.mts` 删除的两个 import 经 grep 确认全文件无其它引用（`PrismaModule` 仍在用，`createPrismaClient` 自建客户端）。
- `storage-settings.consumer.ts` 按根 Agent 授权**只改一行**，未动该文件其它逻辑（40 条测试的已验收代码）。

## 6. 未覆盖项

- 两个 `.mts` HTTP e2e（media motion、moderation）未实际执行：需要 `ROAMLOG_TEST_DATABASE_URL` 与真实 API 进程，属环境型 e2e，本次只做了静态确认（删未用 import / 删死初值，均无行为变化）。
- 未跑全仓 e2e / build（任务边界外，且其它 Agent 在途改动会污染结果）。

## 7. 建议下一步

1. 在 CI 用 `ROAMLOG_TEST_DATABASE_URL` 跑一次 `moderation-http.e2e.mts`、`media-motion-http.e2e.mts`，把静态确认升级为运行证据。
2. 全仓 lint 的 19 条 worker warning 单独开任务清理（`no-explicit-any`，非门禁）。
3. 根 Agent 汇总时注意：本任务开始时清单的 `redis.service.ts:88` 是行号/文件引用错误，真实命中在 media e2e :88；`pnpm lint` 的 turbo 缓存可能掩盖 `apps/api` 的新错误，门禁验证应带 `--force` 或直接 `pnpm --filter @roamlog/api lint`。