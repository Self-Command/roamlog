# R1_REDIS_RESILIENCE — Redis 不可用不再打崩 API（fail-open）

状态: **DONE**
任务 ID: `R1_REDIS_RESILIENCE`
角色: backend_api / 执行者: DSH 子 Agent
日期: 2026-11-19

---

## 1. 复现（红）与修复（绿）

**缺陷证据**
- `.audit/authz-override-report.md:215`：联调时观察到「Redis 不可用时 auth rate-limit 路径把 API 进程打崩（`MaxRetriesPerRequestError`，20 次重试的 ioredis 客户端无 catch）」
- `.audit/g3-api-journeys-report.md:50-62`：更早一次同样现象，`pnpm dev` 因 `REDIS_URL` 指向未监听端口而直接报 `MaxRetriesPerRequestError: Reached the max retries per request limit (which is 20).`

**修复前复现（关闭端口 `redis://127.0.0.1:1`，直接实例化旧 `RedisService`）**

```text
[warn] redis.connection_error {"err":{"errno":-4078,"code":"ECONNREFUSED","syscall":"connect","address":"127.0.0.1","port":1}}
[get] THREW: MaxRetriesPerRequestError - Reached the max retries per request limit (which is 2). after 473 ms
```

- 旧实现：`get()` **拒绝**（`MaxRetriesPerRequestError`）。`apps/api/src` 内**没有任何 `unhandledRejection` / `uncaughtException` 兜底**（`grep -rn "unhandledRejection" apps/api/src apps/api/test` 无命中，`apps/api/src/main.ts:35` 只 catch bootstrap 自身的 promise），因此任一未 await 的 Redis promise 被拒 = 进程退出。`idempotency`、`job-queue` 两处完全无 try/catch。
- 新实现：同样的调用**不抛**，返回降级结果；连接错误被 `on("error")` 监听 + 60s 节流 warn。

**测试红灯 → 绿灯**
| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| 红 | `pnpm --filter @roamlog/api exec vitest run src/modules/redis` | `[get] THREW: MaxRetriesPerRequestError`；`readiness-degraded.spec.ts` 断言 `degraded` 失败、契约 `safeParse` 失败（2 项） |
| 绿 | 同上 | `Test Files 5 passed (5) / Tests 17 passed (17)` |

---

## 2. 变更文件

**核心（允许范围）**
- `apps/api/src/modules/redis/redis.service.ts` —— 客户端选项、失败语义、状态/节流、`REDIS_REQUIRED` 启动门
- `apps/api/src/modules/redis/redis-resilience.spec.ts`（新）—— 关闭端口真实 `ioredis`、选项上限、错误监听、启动门
- `apps/api/src/modules/redis/redis-fail-open.spec.ts`（新）—— 限流放行、缓存回源、队列 fail-closed
- `apps/api/src/modules/redis/readiness-degraded.spec.ts`（新）—— `/v1/ready` 三段语义 + 契约校验
- `apps/api/src/modules/redis/redis-rate-limit.spec.ts` —— 客户端改为「就绪后再断言不降级」（见 §6 风险 3）
- `apps/api/src/modules/idempotency/idempotency.service.ts` —— fail-open 幂等语义
- `apps/api/src/modules/idempotency/idempotency.service.spec.ts` —— 新增降级用例
- `apps/api/src/config/environment.ts` —— `REDIS_REQUIRED`（默认 `false`）
- `apps/api/src/config/app-config.service.ts` —— `redisRequired` getter

**已获根 Agent 追加授权的跨边界改动（见 §7）**
- `apps/api/src/modules/health/readiness.service.ts` —— `ok | degraded | unavailable` 三段语义；移除契约不允许的 `error` 字段
- `apps/api/src/modules/health/health.controller.ts` —— 只有 `unavailable` 才 503
- `packages/contracts/src/api/health.ts` —— `status` 联合补 `unavailable`（仅此一个枚举）
- `apps/api/test/health.e2e-spec.ts` —— 新增「仅 Redis down → degraded + 200 + 进程存活」用例

**证据**
- `.audit/r1-report.md`（本文件）、`.audit/r1-real-verify.sh`、`.audit/r1-real-verify-output.txt`

**未触碰**：`apps/api/src/modules/{ai,admin,trips,stops,share-links}/**`、`packages/db/**`、`apps/web/**`、`apps/admin/**`、`tooling/**`、`packages/contracts` 其它文件。`git add` 逐条精确路径，未使用 `-A`。

---

## 3. 实现摘要

### 3.1 客户端配置（`redis.service.ts:96-115`）

| 选项 | 值 | 理由 |
| --- | --- | --- |
| `maxRetriesPerRequest` | `2`（常量） | 默认 20 会长时间挂住请求；2 次即失败 |
| `enableOfflineQueue` | `false` | Redis 不在时立即失败，不堆积离线队列（正是旧实现 `MaxRetriesPerRequestError` 的来源） |
| `retryStrategy` | `redisRetryStrategy`：50ms 起指数退避，封顶 2s，**第 10 次后返回 `null` 停止重连** | 有上限，不无限重连 |
| `connectTimeout` | `3000`ms | 握手不挂 |
| `lazyConnect` | `false` | 按任务要求保持现有启动行为（构造即连；ioredis 构造期不抛，失败走 `error` 事件） |
| `keyPrefix` / `connectionName` | 原样保留 | 无行为变化 |
| 错误监听 | `client.on("error")` + `on("ready")` + `on("end")` | `error` 未被监听会直接杀进程；`ready` 清降级标记并记一次 `redis.recovered` |

节流：`noteFailure()` 以 `operation:ErrorName` 为签名，**同一错误 60s 内只 warn 一次**（`REDIS_ERROR_LOG_THROTTLE_MS`），超过 50 个签名时清掉过期项。

命令级超时：`get/set/delete/tryAcquire` 统一 `withTimeout(..., 1000ms)`，避免「TCP 通但不回包」的黑洞 Redis 挂死请求。

### 3.2 逐处失败语义（代码内均有注释）

| 用途 | 调用点 | 故障时行为 | 位置 |
| --- | --- | --- | --- |
| 缓存 places | `PlacesCacheService.read/write` → `redis.get/set` | **fail-open**：读按 miss 处理 → 回源 provider；写静默丢弃 | `places-cache.service.ts:54-95`（调用方自带 try/catch 保留） |
| 缓存 settings | `SettingsService` 直接用 `redis.client.*`（自带 try/catch） | **fail-open**：读版本/值失败 → 回 DB；写/广播失败 → warn | `settings.service.ts:632-697` |
| 缓存 trip / AI run | `AiRunStore.get/set/delete` | **fail-open**：读成 `null` → 视为「plan 不存在」（干净 404/410，不是 500） | `ai-run.store.ts:54-95` |
| 限流 auth / share / media presign | `RateLimitService.consume` → `incrementFixedWindow` | **fail-open**：原语抛错（刻意保留控制流），限流器降级到进程内固定窗口并标 `degraded:true`，不产生 429 风暴 | `rate-limit.service.ts:41-67` |
| 幂等 | `IdempotencyService.run` → `tryAcquire` | **fail-open**：`unavailable` → 记 warn 后**照常执行**；读不到结果视为无记录；清理 best-effort，不掩盖原始错误 | `idempotency.service.ts:63-100` |
| 配额 AI / Geoapify | `AiQuotaService.consume` / `PlacesQuotaService.consume` | **fail-open**：`allowed:true` + warn（调用方已有 try/catch） | `ai-quota.service.ts:59-75`、`places-quota.service.ts:63-75` |
| 队列 ingress（export job） | `JobQueueService.enqueue` → `redis.client.rpush` | **fail-closed（明确错误）**：原始命令拒绝向上抛，**绝不假装入队成功**。选择理由见 §3.5 | `job-queue.service.ts:57` |
| 会话 / 2FA | 不经过 `RedisService`；Better Auth 用自身存储 | 行为不变，Redis 故障不会触达该路径 | — |
| 健康探针 | `ReadinessService.check` → `ping()` | `ping` 保留抛错（探针自己 catch），映射为 `degraded` | `readiness.service.ts:72-84` |

**`incrementFixedWindow` 为什么保留抛错**：只有它需要「由调用方决定失败形态」——限流要进程内窗口、配额要放行。三个调用方全部已 `try/catch + withTimeout`，逐一在代码注释中列出。其余方法一律 total（不抛）。

### 3.3 总开关 `REDIS_REQUIRED`（默认 `false`）
- `environment.ts` + `app-config.service.ts` 新增键与 getter（含语义注释）。
- `RedisService.onModuleInit()`：仅当 `true` 时 ping，不可达则抛 `Redis is required (REDIS_REQUIRED=true) but unreachable at boot: ...` → 启动失败。**运行时仍 fail-open**（刻意：把 Redis 变成每请求硬依赖，正是本任务要消灭的故障放大）。
- `tooling/scripts/check-env.ts` 不在边界（且与刚提交的 E0 有撞车风险，根 Agent 未扩权）→ **TODO**（§8）。

### 3.4 健康与可观测
三段语义（与根 Agent 确认后实现）：

| 依赖状态 | `status` | HTTP |
| --- | --- | --- |
| 全部 up | `ok` | 200 |
| **仅 Redis down** | **`degraded`** | **200**（不踢出负载均衡） |
| database 或 storage down | `unavailable` | 503（保持原语义） |

同时修正两处**既存契约违约**（不是本任务引入）：
1. `ReadinessService` 返回 `unavailable`，但 `ReadyResponseSchema` 只允许 `ok|degraded` → 契约补 `unavailable`（根 Agent 授权）。
2. 失败探针返回 `error: "dependency check failed"`，而 `DependencyHealthSchema` 是 `.strict()` → **任何 down 的响应都不合法**；已移除该字段（顺带避免错误信息从无鉴权端点外泄）。这是 `readiness-degraded.spec.ts` 的契约断言抓到的真实缺陷。

### 3.5 队列 ingress 选择：fail-closed
读了现有实现（`job-queue.service.ts:42-59`）：API 不接 BullMQ，只把 envelope `rpush` 进 ingress list，worker 负责 drain。若这里 fail-open：
- 返回 `{jobId}` 而实际没入队 = **静默丢导出任务**，用户看到「已排队」却永远拿不到文件；
- 与「入队幂等」承诺冲突（重复请求会被当作已入队）。
因此保留 fail-closed：Redis 故障时 `enqueue` 抛错，**不伪造成功**。HTTP 状态映射属 `exports` 模块（不在边界），当前很可能是 500；建议 exports 负责人改为 503 `SERVICE_UNAVAILABLE`（§8）。

---

## 4. 验证命令与原始输出

### 4.1 `pnpm --filter @roamlog/api typecheck`
```text
> roamlog-api@ typecheck C:\Users\BY9700\Desktop\UI\roamlog\apps\api
$ tsc --noEmit
```
（exit 0，无输出）

### 4.2 定向测试（redis / guards / idempotency）
```text
$ pnpm --filter @roamlog/api exec vitest run src/modules/redis src/common/guards src/modules/idempotency

 ✓ src/modules/redis/redis-resilience.spec.ts (6 tests) 261ms
 ✓ src/modules/redis/redis-rate-limit.spec.ts (1 test) 28ms
 ✓ src/modules/idempotency/idempotency.service.spec.ts (3 tests) 7ms
 ✓ src/modules/redis/redis-fail-open.spec.ts (3 tests) 10ms
 ✓ src/modules/redis/readiness-degraded.spec.ts (4 tests) 8ms

 Test Files  5 passed (5)
      Tests  17 passed (17)
```
覆盖任务要求：关闭端口读写不抛/降级（`redis-resilience`）、限流放行（`redis-fail-open`）、缓存回源（`redis-fail-open`）、幂等降级（`idempotency.service.spec.ts` + `redis-fail-open`）、retryStrategy 上限（`redis-resilience` 选项用例）、错误监听存在（`listenerCount("error")`）、ready degraded+200（`readiness-degraded`）。

### 4.3 全量 `pnpm --filter @roamlog/api test`
```text
 Test Files  86 passed | 7 skipped (93)
      Tests  677 passed | 16 skipped (693)
   Start at  14:21:24
   Duration  75.96s
```
**无并行 Agent 的在途文件污染本套件**：`apps/api/src/modules/{ai,trips}/**` 的同批改动（`ai-tools.ts`、`stops.service.ts` 等）在本次运行中全绿，未出现失败。

### 4.4 真实进程验证（关闭端口 Redis）
脚本 `.audit/r1-real-verify.sh`，完整原始输出 `.audit/r1-real-verify-output.txt`。环境：真实 API `apps/api/src/main.ts`、真实 PostgreSQL（127.0.0.1:55444）、本地假 S3（9111，仅让 `HeadBucket` 成功，从而**只有 Redis 是坏的**）、`REDIS_URL=redis://127.0.0.1:1`。

```text
fake-s3 pid=3088 port=9111
api pid=9236 REDIS_URL=redis://127.0.0.1:1
--- ps ---
process 9236 NOT RUNNING            # MSYS 看不到 Windows PID，故下两行取系统级 PID
--- OS-level listener PID (netstat) ---
  TCP    0.0.0.0:4321           0.0.0.0:0              LISTENING       19028
--- kill -0 9236 (process alive?) ---
ALIVE pid=9236
--- GET /v1/health (with status) ---
{"status":"ok"}
HTTP 200
--- GET /v1/ready (with status) ---
{"status":"degraded","checks":{"database":{"status":"up","latencyMs":146},"redis":{"status":"down","latencyMs":10},"storage":{"status":"up","latencyMs":121}}}
HTTP 200
--- GET /v1/ready again (no crash after repeated degraded probes) ---
HTTP 200
--- still alive after both probes? ---
ALIVE pid=9236
--- stopping processes we started ---
api stopped cleanly after kill
```
日志侧同样自证启动成功与降级：`"msg":"api.started"`（Redis 全坏的情况下照常 listen 4321）、`"msg":"redis.unavailable_fail_open"`、`"dependency":"redis","msg":"readiness.dependency_unavailable"`。**进程在 Redis 全程不可用时没有退出，两次 `/v1/ready` 探测后仍 ALIVE，最终由我主动 kill。**

---

## 5. CodeGraph 证据
1. `codegraph status` → `[OK] Index is up to date`（1,616 文件 / 24,881 节点 / 55,508 边）。
2. `codegraph_explore "RedisService redis.module.ts RedisConnectionError retryStrategy maxRetriesPerRequest"` →
   - blast radius：`RedisService`（`redis.service.ts:10`）**39 个调用方**，含 `common/security/rate-limit.service.ts`、`admin-queue`、`admin-system`、`ai-quota`、`exports/job-queue`、`health/readiness`、`idempotency`、`places-*`、`settings`、`realtime/presence` + 10 余文件；测试 12 个。
   - 该结果直接决定策略：**必须在 `RedisService` 层做成 total**，否则不可能在 60 分钟内逐文件加 try/catch（且多数文件不在我的边界）。
3. `codegraph_explore "ReadinessService readiness redis check rate-limit.service.ts …"` → 调用链 `HealthController.ready → ReadinessService.check → probe → redis.ping`、`ReadinessService` 3 个调用方；确认 `RateLimitService` 9 个调用方（3 个 guard）。
4. `codegraph_explore "places-cache … job-queue … ai-quota … environment.ts"` → 确认 `PlacesCacheService`/`PlacesQuotaService`/`AiQuotaService` 已有 try/catch（因此**未修改**它们），`JobQueueService` 走裸 `client.rpush`，`app-config.service.ts:71-77` 的 `redisUrl/redisPrefix`。

---

## 6. 已知风险

1. **重连预算耗尽后不会自愈**（最重要）。`retryStrategy` 第 10 次后返回 `null`（任务明确要求「最多 10 次后停止重连」），ioredis 进入 `end` 且**不会再自动重连**：一次超过约 14s 的 Redis 重启/维护会让该 API 实例在**进程重启前**一直无 Redis（所有 Redis 功能持续降级，但 API 不崩）。两种修法二选一，需根 Agent 裁决：
   - (a) 改为「无限次封顶退避」（`return Math.min(...)` 永不返回 `null`）——生产最常见做法，但违反本次任务书写法；
   - (b) 保留 10 次上限，另加一个慢速复活探针（`on("end")` 后每 30s 单次 `client.connect()`，`unref()`，`onModuleDestroy` 清理）。约 12 行，可放在 `redis.service.ts`。
2. **settings 跨实例失效订阅不会重试**：`apps/api/src/modules/settings/settings.service.ts:112` 在 `onModuleInit` 里 `subscribe`。`enableOfflineQueue:false` 后，若启动瞬间 Redis 尚未 ready 或当时不可用，订阅**立即失败且不再重试**（日志已见 `settings.redis_degraded` / `operation:"subscribe_failed"`）。后果被既有 30s TTL 收敛窗口兜住（见 `authz-override-report.md:208`），但跨实例即时失效在「Redis 后恢复」场景下失效。建议 settings 负责人订阅 `RedisService` 暴露的 `ready` 事件重连；本任务不改 settings（越界）。
3. **启动/重连瞬间会短暂 fail-open**：`enableOfflineQueue:false` + 构造即连，首批命令在 `ready` 前会立即失败（限流放行、缓存 miss）。这是刻意取舍（宁可放行也不排队），已把 `redis-rate-limit.spec.ts` 改为等待 `ready` 后断言，避免误判为「时刻降级」。
4. **幂等在故障期可能重复执行**：明确的 fail-open 取舍（写入注释）。数据库自身唯一约束仍是最后防线；若某端点不能容忍重复，应改为对该端点 fail-closed。
5. **队列 ingress 的 HTTP 语义**：当前会把 Redis 错误冒泡成 500（exports 控制器不在边界）。fail-closed 正确，但状态码应为 503。
6. **无全局 `unhandledRejection` 兜底**（根 Agent 已确认另派）：`apps/api/src/main.ts:35` 只处理 bootstrap promise。建议在 `bootstrap()` 之后加 `process.on("unhandledRejection", …)` 记 fatal 并**不**退出（或显式 `process.exit(1)` 交给编排器重启），位置：`apps/api/src/main.ts` 顶层、`void bootstrap()` 前后。
7. `REDIS_REQUIRED=true` 只强化启动期；运行期依旧 fail-open（刻意，已在 `environment.ts` 注释与 `redis.service.ts` 类注释中写明）。

## 7. 边界例外说明（已获授权）
`apps/api/src/modules/health/**`、`packages/contracts/src/api/health.ts`、`apps/api/test/health.e2e-spec.ts` 原本不在我的可写清单。我先向根 Agent 报告事实（契约只允许 `ok|degraded`，实现却返回 `unavailable` 且有 e2e 断言 + 503），获批后按「ok 200 / degraded 200 / unavailable 503」实现，并**只**向契约 `status` 联合追加 `unavailable`（一个枚举，未动其它结构）。没有为了让测试变绿而把 db/storage 的 503 改成 200。

## 8. 未覆盖项 / TODO
1. `tooling/scripts/check-env.ts` 的 `REDIS_REQUIRED` 校验（不在边界，根 Agent 未扩权）——建议在必填项校验旁新增可选项解析 + `REDIS_REQUIRED=true` 时把 `REDIS_URL` 升为不可缺失（当前 `REDIS_URL` 本来就必填，需改为按开关报错文案）。
2. `.env.example` / 部署文档补 `REDIS_REQUIRED`（不在边界）。
3. OpenAPI / 生成客户端同步 `ReadyResponse.status` 新枚举（`packages/api-client` 的 `ReadyResponse` 由 `packages/contracts` 类型推导，但 `openapi.json` 与 orval 产物需重新生成；本任务未跑生成器）。
4. Redis 恢复后的自动重连（§6.1）。
5. `exports` 的 503 映射（§6.5）。

## 9. 建议下一步
1. 裁决 §6.1（推荐 (a) 无限封顶退避，或 (b) 复活探针），我可以 15 分钟内补一个 `redis-revival.spec.ts`。
2. 派 settings 负责人接 `RedisService` 的 `ready` 事件做订阅重连（跨实例失效恢复）。
3. 单独任务补 `main.ts` 的 `unhandledRejection` / `uncaughtException` 兜底（属于「进程最后防线」，与本任务互补）。
4. 在 staging 做一次「Redis 停机 60s 后恢复」演练，观察 §6.1 的实际影响面与 §6.2 的收敛窗口。