# MAIN_HARDENING — API 进程级兜底、启动阶段可观测、优雅退出

状态: **DONE**（2 项环境限制已说明：Windows 无法投递 POSIX 信号；仓库内 6 个 storage 测试失败属于并行 Agent 的进行中改动）
任务 ID: `MAIN_HARDENING`
角色: backend_api + devops

## 变更文件

已写（全部在授权清单内）：

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `apps/api/src/common/process-guards.ts` | 新增 | `unhandledRejection` / `uncaughtException` 兜底、降级计数、窗口阈值、flush 上限、结构化错误摘要 |
| `apps/api/src/bootstrap/shutdown.ts` | 新增 | 幂等优雅退出控制器、`SHUTDOWN_GRACE_MS` 解析、在途请求计数、信号注册 |
| `apps/api/src/bootstrap/bootstrap.ts` | 新增 | 分阶段启动、阶段耗时日志、失败阶段 fatal + exit 1、依赖探测 |
| `apps/api/src/bootstrap/startup-logger.ts` | 新增 | Nest 建立前的 early pino logger（结构化 JSON，字段与 Nest logger 对齐） |
| `apps/api/src/bootstrap/run-api.ts` | 新增 | 生产入口编排：先装 guard，再 bootstrap，懒解析 logger/shutdown |
| `apps/api/src/bootstrap/configure-app.ts` | 修改 | `configureApp(app, { shutdownHooks })`，生产路径把信号所有权交给 shutdown 控制器 |
| `apps/api/src/main.ts` | 重写（原 37 行 → 6 行） | 只做 `reflect-metadata` + `runApiProcess()`，无测试后门 |
| `apps/api/src/common/__tests__/process-guards.spec.ts` | 新增 | 12 个用例 |
| `apps/api/src/bootstrap/__tests__/shutdown.spec.ts` | 新增 | 10 个用例 |
| `apps/api/src/bootstrap/__tests__/bootstrap.spec.ts` | 新增 | 6 个用例 |
| `.env.example` | 修改 | 只新增 `SHUTDOWN_GRACE_MS=10000`（含注释） |
| `.audit/main-hardening-report.md` | 新增 | 本报告 |

**未触碰**：`apps/api/src/modules/{storage,places,settings,ai,stops}/**`、`apps/web/**`、`packages/**`、`modules/health/**`、ready 契约。

## 实现摘要（逐 5 项）

### 1) 进程级兜底（`common/process-guards.ts`）

- `process.on("unhandledRejection", …)`：
  - 每条都 `logger.fatal({ event: "process.guard", guard: "unhandledRejection", verdict, name, message, stack[3], requestId?, count, windowCount, threshold, windowMs, degraded: true }, "unhandled_rejection")`；
  - `stack` 只保留前 3 行；`requestId` 从错误自身/`cause` 链最多 2 层读取（当前请求上下文没有 AsyncLocalStorage，取不到就不伪造）；
  - **不立即退出**：把进程标记 `degraded`，维护总计数 + 最近 5 条摘要（`snapshot().recent`）；
  - 60s 滑动窗口内 ≥10 次 → `verdict:"exit"`，走注入的 `onFatal`（优雅 close）→ flush（上限 2s）→ `exit(1)`；
  - `exitFatal` 有 `exiting` 闸门，风暴不会并发 teardown。
- `process.on("uncaughtException", …)`：结构化 `fatal`（`"uncaught_exception"`, `verdict:"exit"`）→ 同样的 teardown → flush → `exit(1)`。
- 两条路径都先 `await flushLogger()`；`flushLogger` 兼容 `PinoLoggerService`（探 `logger.flush`）、裸 pino（探 `.logger.flush`），2s 截止后强制继续退出。
- `install()` / `uninstall()` 幂等；测试用注入 `exit`/`now`/`flush`/`onFatal`，不真退进程。

### 2) 优雅退出（`bootstrap/shutdown.ts`）

- 顺序：`server.close()` + `closeIdleConnections()`（停止接受新请求）→ 等待在途请求（`request` 事件计数，`res.close` 递减，无轮询定时器）→ `app.close()`（Nest 依次销毁 Socket.IO / Prisma / Redis / 队列）。
- `SHUTDOWN_GRACE_MS`（默认 `10_000`，合法 0–300000，非法值作为 `environment` 阶段失败）包住整条 drain；超时 → `shutdown.timeout` + `shutdown.complete(ok:false, exitCode:1)` + exit 1。
- `SIGTERM` / `SIGINT` 由控制器注册；重复信号只记 `shutdown.duplicate_signal`，关闭链只执行一次；`close()` 返回同一个 in-flight promise。
- 成功 → `shutdown.complete(ok:true, exitCode:0)` → flush → exit 0。
- `configureApp` 在 Bootstrap 里传 `{ shutdownHooks: false }`：Nest 12 的 `enableShutdownHooks()` 在 close 后 `process.kill(pid, signal)` 重放信号（exit 143），且无 deadline，因此生产路径由本控制器接管；e2e 的 `test-app.ts` 仍走默认 `true`，行为不变。

### 3) 启动失败要说清楚（`bootstrap/bootstrap.ts`）

- 阶段：`environment`（env 文件 + `validateEnvironment` + `SHUTDOWN_GRACE_MS`）→ `modules`（动态 import AppModule）→ `nest`（`NestFactory.create`，`abortOnError:false` 防止 Nest 自己 `exit(1)` 绕过日志）→ `configure` → `listen` → `database` / `redis` / `storage` 探测 → `ready`。
- 每阶段一行 `startup.stage`（`stage`、`status`、`durationMs`），顺序与耗时可直接定位卡点；最后 `api.started` 带 `startupMs`、`shutdownGraceMs`、`dependencies` 快照。
- 外层 `try/catch`：任何阶段抛错 → `startup.stage(status:"failed")` + `startup.failed`（含 `stage`）→ 尽力 `app.close()`（5s 上限）→ flush → `exit(1)`（再 rethrow 给调用方，进程已退出）。
- 依赖探测决策：**硬依赖 down 不 kill 进程**（`error` 级 `startup.dependency_unavailable` + `hardDependency`/`readiness` 字段，`/v1/ready` 仍按既有契约返回 503）。理由：与 R1 已确立的 “Redis degraded 仍 200”、与本仓 `/v1/ready` 现有的 503 摘流设计一致；boot 即 exit 会导致依赖抖动时 crash-loop，反而掩盖故障。**若根 Agent 要求严格 fail-fast，把 `probe()` 的 down 分支改为 `throw new StartupFailure(name, error)` 即可（一行）**，测试与日志字段无需改。

### 4) 可观测 + ready 契约判断（重要）

- **`ReadyResponseSchema` 是 `.strict()`**（外层和 `checks` 内层都是），`HealthResponseSchema` 也是 `.strict()` 且要求 `version`/`uptimeSeconds` → **没有**向 `/v1/ready` 塞任何新字段；也没有动 `/v1/health`（它不在我的可写范围，且当前实现只返回 `{status:"ok"}`，与严格契约本来就存在漂移，见“未覆盖项”）。
- `/v1/metrics` 用的是 `MetricsService` 私有 `new Registry()`，外部无法注册 gauge，而 `metrics.service.ts` 不在我的可写范围 → 本次**不静默改契约、不改别人的文件**。
- 计数实际暴露位置：
  - 每条 guard 日志都带 `count` / `windowCount` / `threshold` / `windowMs` / `degraded` / `recent` 语义字段；
  - `shutdown.start` / `shutdown.complete` 带 `processGuards: snapshot()`（由 `run-api.ts` 注入 `shutdownContext`）；
  - 导出 `snapshot()`：`{ degraded, unhandledRejections, rejectionsInWindow, windowMs, threshold, recent[5], lastAt?, exiting }`，后续接 `/v1/metrics` 只需一行 `new Gauge({ collect })`（建议下一步 1）。
- 统一字段：`event=process.guard` + `msg=unhandled_rejection|uncaught_exception`；`event=shutdown.start|shutdown.complete|shutdown.timeout|shutdown.failed|shutdown.duplicate_signal`；`event=startup.stage`（`stage`,`status`,`durationMs`）/`startup.failed`。

### 5) 测试（28 个新用例）

- 单次 rejection：不退出、`fatal` 一次、`snapshot().degraded=true`、`count=1`、`recent` 保留；
- 60s 内 10 次：第 10 次 `verdict:"exit"`，`onFatal` → flush → 注入 `exit(1)` 被调用一次；
- 滑窗：9 次后跨 61s，第 10 次不计入旧窗口（`rejectionsInWindow=1`、不退出）；新窗口再累积到 10 次才退出（总计数 19）；
- `uncaughtException`：`fatal("uncaught_exception")` → `onFatal` → flush → `exit(1)`；
- flush 挂起：2s 截止后仍 `exit(1)`，并记 `process.guard_flush_timeout`；
- 监听器 install 幂等/uninstall 干净、真实 `process.emit("unhandledRejection")` 路径；
- 优雅退出：关端点→等在途→关应用→flush→exit 0；两次信号只跑一次关闭链（`closeApplication` 1 次、`exit` 1 次、`duplicate_signal` 1 条）；在途请求未关闭前不关 DB；grace 到期强制 exit 1；`closeApplication` 抛错 exit 1；`ERR_SERVER_NOT_RUNNING` 视为已关闭；flush 超时不影响 exit 0；`installSignals` 二次调用只加一个监听器、`uninstallSignals` 移除；
- bootstrap：阶段顺序与 `api.started` 快照；`nest` 创建失败 → `startup.failed.stage="nest"` + exit 1；`listen` 端口占用 → stage `listen` + 半启动 app 被 close + exit 1；非法 `SHUTDOWN_GRACE_MS` → stage `environment` + exit 1；配置校验抛错 → stage `environment` + exit 1；依赖 down → 记录 error 级但不退出。

## 验证命令与结果（原始输出）

### 1. `pnpm --filter @roamlog/api typecheck`

**结论：整包失败，失败点全部在并行 Agent 的进行中文件；我的文件 0 错误。**

```text
src/modules/reports/report-targets.ts(128,9): error TS2353 ...
src/modules/reports/admin-reports.service.ts(...): error TS2551 Property 'report' does not exist on type 'PrismaClient'
src/modules/storage/storage-settings.consumer.spec.ts(...): error TS...
../../packages/db/src/factories.ts(...): error TS2305 Module ... has no exported member 'ModerationAction'
../../packages/contracts/src/api/reports.ts(101,5): error TS18004 ...
（共 50 条，全部位于 src/modules/reports/**、src/modules/storage/storage-settings.consumer.spec.ts、packages/**）
```

过滤我的路径：

```text
$ npx tsc --noEmit 2>&1 | grep -E "src/(bootstrap|common/process-guards|main)"
NO ERRORS IN MAIN_HARDENING FILES
```

### 2. `pnpm --filter @roamlog/api exec vitest run src/common src/bootstrap src/main`

```text
 ✓ src/bootstrap/__tests__/shutdown.spec.ts (10 tests) 73ms
 ✓ src/common/__tests__/process-guards.spec.ts (12 tests) 48ms
 ✓ src/bootstrap/__tests__/bootstrap.spec.ts (6 tests) 11ms
 ✓ src/common/__tests__/tenant.guard.spec.ts (5 tests) 13ms
 ✓ src/common/security/__tests__/rate-limit.service.spec.ts (3 tests) 12ms
 ✓ src/common/security/__tests__/origin.guard.spec.ts (8 tests) 9ms
 ✓ src/common/__tests__/permission.service.spec.ts (18 tests) 12ms
 ✓ src/common/__tests__/log-redaction.spec.ts (2 tests) 5ms

 Test Files  8 passed (8)
      Tests  64 passed (64)
```

### 3. `pnpm --filter @roamlog/api test`（全量）

```text
 Test Files  2 failed | 95 passed | 7 skipped (104)
      Tests  6 failed | 743 passed | 16 skipped (765)
```

失败全部在 storage（并行 Agent 的进行中模块，不在我的改动路径内，而且其 spec 本身在 `tsc --noEmit` 里就有 4 条错误）：

```text
 FAIL  src/modules/storage/storage-client.factory.spec.ts
   > builds new clients and retires the old pair 60s later  (expected 1, got 2)
   > destroys active and retired clients on module destroy  (expected 1, got 2)
 FAIL  src/modules/storage/storage-settings.consumer.spec.ts
   > uses the stored database value over env when a row exists  (expected 'env-access', got 'test-access-key')
   > falls back to env when a stored value is empty
   > uses env when no row exists and the code default only when env is absent
   > changes the version only when a resolved value changes
```

16 skipped 是既有的 `ROAMLOG_TEST_DATABASE_URL` 集成测试跳过（本机无 PostgreSQL/Redis/MinIO）。

### 4. 真实进程验证

本机 `docker`/`psql`/`redis` 均不可用（5432/6379/9000 全 closed，4000 是其它 Agent 已运行的旧实例），所以“正常依赖”无法复现；下列 4 次都是**真实 node 进程 + 真实 HTTP**，依赖缺失这一事实同时成为“依赖探测不静默”的证据。探针文件全部在仓库外：`%TEMP%\roamlog-hardening\*.cjs`，通过 `NODE_OPTIONS=--require` 注入，`main.ts` 无任何测试后门。

**(a) 正常启动 + health 200（端口 4101，pid 11828）**

```text
{"event":"startup.stage","stage":"listen","status":"ok","durationMs":3332}
{"event":"startup.stage","stage":"database","status":"down","durationMs":488,"hardDependency":true,"servingDegraded":true,"readiness":"unavailable","msg":"startup.dependency_unavailable"}
{"event":"startup.stage","stage":"redis","status":"down",...,"readiness":"degraded"}
{"event":"startup.stage","stage":"storage","status":"down","durationMs":507,"hardDependency":true,...}
{"event":"startup.stage","stage":"ready","status":"ok","durationMs":0}
{"event":"startup.complete","port":4101,"startupMs":16359,"shutdownGraceMs":10000,"dependencies":{"database":"down","redis":"down","storage":"down"},"msg":"api.started"}

$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:4101/v1/health
HTTP 200        {"status":"ok"}
```

**(b) 启动阶段失败 = 阶段名 + exit 1（未设 API_PORT，撞上已占用的 4000）**

```text
{"event":"startup.stage","stage":"listen","status":"failed","durationMs":1480,"err":{"code":"EADDRINUSE","message":"listen EADDRINUSE: address already in use :::4000"}}
{"event":"startup.failed","stage":"listen","startupMs":3382,"err":{"code":"EADDRINUSE",...}}
$ cat api2.exit
EXIT:1
```

**(c) 单次未捕获拒绝：进程不死 + 日志有 `unhandled_rejection`（端口 4102，pid 21124，探针 5s 后 `Promise.reject(new Error("probe: unhandled rejection #1"))`）**

```text
$ curl before/after →  health HTTP 200   (探针触发前后各一次)
{"level":"fatal","event":"process.guard","guard":"unhandledRejection","verdict":"degraded",
 "name":"Error","message":"probe: unhandled rejection #1",
 "stack":["Error: probe: unhandled rejection #1","at Timeout._onTimeout (...\\rejection-probe.cjs:6:20)","at listOnTimeout (node:internal/timers:685:17)"],
 "count":1,"windowCount":1,"threshold":10,"windowMs":60000,"degraded":true,"msg":"unhandled_rejection"}
已监听: TCP 0.0.0.0:4102 LISTENING 21124   ← pid 前后对照：探针触发后仍为同一 pid 并继续监听
```

**(d) 两次 SIGTERM 幂等 + 优雅退出 exit 0（端口 4103）**

```text
{"event":"shutdown.start","reason":"SIGTERM","graceMs":10000,"inFlight":0,"processGuards":{"degraded":false,"unhandledRejections":0,"exiting":false},"msg":"shutdown.start"}
{"event":"shutdown.duplicate_signal","reason":"SIGTERM","inFlight":0,"msg":"shutdown.duplicate_signal"}
{"event":"shutdown.complete","reason":"SIGTERM","ok":true,"timedOut":false,"durationMs":9,"exitCode":0,"inFlight":0,"msg":"shutdown.complete"}
$ cat api-signal.exit
EXIT:0
端口 4103 已关闭（netstat 无监听）
```

> Windows 限制：MSYS 的 `kill -TERM/-INT` 对原生 Node 是硬终止，实测 `EXIT:130`/无 `shutdown.start` 日志，所以 (d) 用 `process.emit("SIGTERM","SIGTERM")` 在真实进程内触发同一监听器与关闭链。操作系统真实信号投递只能在 Linux CI 验证（未覆盖项）。

**(e) 60s 内 10 次拒绝：优雅退出 exit 1（端口 4104）**

```text
9 × {"event":"process.guard","guard":"unhandledRejection","verdict":"degraded",...}
   {"event":"process.guard","guard":"unhandledRejection","verdict":"exit","count":10,"windowCount":10,"threshold":10}
{"event":"shutdown.start","reason":"unhandledRejection","graceMs":10000,"processGuards":{"degraded":true,"unhandledRejections":10,"rejectionsInWindow":10,...}}
{"event":"shutdown.complete","reason":"unhandledRejection","fatal":true,"ok":true,"timedOut":false,"durationMs":12,"exitCode":1,"processGuards":{...10...}}
$ cat api-threshold.exit
EXIT:1
端口 4104 已关闭
```

## CodeGraph 证据

- `codegraph status`（开工时）：`[OK] Index is up to date`，1,632 files / 25,227 nodes / 56,570 edges。
- `mcp codegraph_explore "apps/api/src/main.ts bootstrap NestFactory ready health shutdown"` → 命中 `main.ts`（原 37 行实现）、`health.controller.ts`、`readiness.service.ts`、`packages/api-client .../health.ts`，并给出 `ready → ReadinessService.check` 调用链；确认 `/v1/ready` 由 `ReadinessService` 供数、无进程级兜底。
- `mcp codegraph_explore "configure-app.ts PinoLoggerService AppConfigService ... ReadyResponseSchema"` → 命中 `bootstrap/configure-app.ts`（已有 `app.enableShutdownHooks()`）、`packages/contracts/src/api/health.ts`（`.strict()`）、`pino-logger.service.ts`（无 `flush`，但有 `.logger`）；**证实全仓无 `unhandledRejection`/`SHUTDOWN_GRACE_MS` 符号**（explore 明确返回 “Not in the index: SHUTDOWN_GRACE_MS”）。
- `codegraph explore "process-guards createShutdownController runApiProcess startApi startup.stage"`（改动后）→ 返回新调用链：`runApiProcess → startApi → createShutdownController`，`shutdown → close → drain/flushBounded`，blast radius 指向 `shutdown.spec.ts` / `bootstrap.spec.ts`。
- `codegraph sync` 尝试失败：`CodeGraph database is locked by another process (PID 18668)`（其它 Agent 的 watcher 持有锁，未强行 unlock，避免打断并行工作）；但新旧文件的 explore 均已可返回源码，索引可用。
- 补充（非代码搜索，符合 AGENTS.md 例外）：`.audit/r1-report.md` §7 原文确认 “契约只允许 ok|degraded…”；`.env.example` 是配置样例文本。

## 已知风险

1. **退出阈值是否过激**：10 次/60s 是按“系统性失控”设计的，但本机实测在 Redis 持续不可用 + 强制终止时，ioredis 自身会抛出 `MaxRetriesPerRequestError` 形式的未捕获拒绝（一次进程退出瞬间观察到 4 条）。稳态 60s 观测窗口内没有复现，但若线上依赖风暴叠加第三方 promise 泄漏，可能误触 exit 1。建议上线后观察 `process.guard` 日志 1–2 周，必要时把阈值改为 20 或按错误签名去重。
2. **flush 超时**：2s 硬上限。当前 pino 是同步输出（无 transport），不丢日志；将来引入 `pino.transport` 时尾部日志可能丢，需改为 `transport.flushSync` 或调大上限。
3. **依赖 down 不 exit** 是明确决策（见 3.4）；若产品要求 fail-fast，需要根 Agent 决策后改一行并补一条 bootstrap 用例。
4. **Windows 信号不可投递**：优雅退出只在进程内事件路径验证；真实 `SIGTERM` 需 Linux CI。
5. **WebSocket 长连接**：`server.close()` 在 Socket.IO 客户端未断开时不会立即完成，drain 可能用满 grace 后 exit 1（已记录 `shutdown.timeout`）。`app.close()` 会断开 Socket.IO，但顺序上要等 HTTP 在途清空，极端情况下会被超时截断。
6. **日志音量**：每条 unhandled rejection 都是 `fatal` 级别，Redis 完全不可用且出现批量泄漏时会刷屏（阈值会兜住到 10 条/窗口，但仍可能被日志聚合系统当成告警风暴）。

## 未覆盖项

- 无法验证“正常依赖下的 SIGTERM”：本机无 PostgreSQL/Redis/MinIO，也无 docker CLI；依赖探测的正确性用了 4 次真实进程验证（含 down 路径），但“全部 up → shutdown.complete(durationMs 包含真实 DB/Redis 关闭)”没有真实验证。
- 没有 Linux CI 的 `kill -TERM` e2e（Windows 平台限制）。
- `/v1/health` 的既有契约漂移（`HealthResponseSchema` 要求 `version`/`uptimeSeconds`，`HealthController.health()` 只返回 `{status:"ok"}`）是**既有问题**，位于 R1 授权过的 `modules/health/**`，不在本任务可写范围，未修。
- `/v1/metrics` 未暴露 guard 计数（`MetricsService` 私有 Registry，不在可写范围），只导出了 `snapshot()`。

## 建议下一步

1. 把 `snapshot()` 接进 `/v1/metrics`：`MetricsService` 增加一个 `Gauge`（collect 回调），并由 `run-api.ts` 传入 snapshot 提供者；这是一行级改动，但需要更新 `metrics.service.ts` 的文件归属。
2. 修 `/v1/health` 契约漂移（补 `version`/`uptimeSeconds`，或把契约改成当前实现），并同步 `packages/api-client` 生成物。
3. 在 Linux CI 增加一条真实的 `SIGTERM → exit 0 + shutdown.complete` 用例（复用本任务的 controller 单测覆盖不到的 OS 信号路径）。
4. 观察 `process.guard` 日志一周，再决定阈值/是否按签名去重；同时把 `degraded` 纳入告警。
5. 若需要严格 fail-fast：`bootstrap.ts` 的依赖 `down` 分支改为 `throw new StartupFailure(name, error)`，并新增一条 bootstrap 用例。

## 复现命令

```bash
cd apps/api
# 单元/集成（本任务新增）
pnpm --filter @roamlog/api exec vitest run src/common src/bootstrap src/main

# 真实进程（需先导出 API_PORT，避免撞 4000 的旧实例）
API_PORT=4101 LOG_LEVEL=debug node --import tsx src/main.ts
curl -s http://127.0.0.1:4101/v1/health

# 探针注入（仓库外文件）
NODE_OPTIONS="--require $(cygpath -w /tmp/roamlog-hardening/rejection-probe.cjs)" \
  PROBE_DELAY_MS=5000 PROBE_COUNT=1 API_PORT=4102 node --import tsx src/main.ts
NODE_OPTIONS="--require $(cygpath -w /tmp/roamlog-hardening/signal-probe.cjs)" \
  PROBE_DELAY_MS=8000 PROBE_SIGNAL_COUNT=2 API_PORT=4103 node --import tsx src/main.ts
NODE_OPTIONS="--require $(cygpath -w /tmp/roamlog-hardening/rejection-probe.cjs)" \
  PROBE_DELAY_MS=8000 PROBE_COUNT=10 API_PORT=4104 node --import tsx src/main.ts
```