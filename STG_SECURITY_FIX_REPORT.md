# STG-SECURITY-FIX delivery report

状态: DONE
任务 ID: STG-SECURITY-FIX
角色: Roamlog Staging 安全修复工程师
结论: QA 报告中的 STG-SEC-001/002/003/005 已修复并有 API 回归测试。
STG-SEC-004 的 test/staging Origin 行为也因全局 Origin guard 与 production
统一。未 commit，未停止 3000/3001 预览。

## 1. 变更范围

产品代码:

- `apps/api/src/common/security/**`（新增）
- `apps/api/src/app.module.ts`
- `apps/api/src/config/app-config.service.ts`
- `apps/api/src/config/environment.ts`
- `apps/api/src/config/environment.spec.ts`
- `apps/api/src/modules/auth/auth-options.ts`
- `apps/api/src/modules/auth/auth.controller.ts`
- `apps/api/src/modules/auth/auth.module.ts`
- `apps/api/src/modules/auth/__tests__/auth-options.spec.ts`
- `apps/api/src/modules/share-links/share-links.controller.ts`
- `apps/api/src/modules/share-links/share-links.module.ts`
- `apps/api/src/modules/share-links/share-links.service.ts`
- `apps/api/src/modules/media/media.controller.ts`
- `apps/api/src/modules/media/media.module.ts`
- `apps/api/src/modules/redis/redis.service.ts`
- `apps/api/src/modules/trips/content-values.ts`
- `apps/api/src/modules/trips/content-presenters.ts`
- `apps/api/src/modules/trips/trips.service.ts`

测试与本地 Redis 协议辅助:

- `apps/api/src/common/security/__tests__/origin.guard.spec.ts`
- `apps/api/src/common/security/__tests__/rate-limit.service.spec.ts`
- `apps/api/src/modules/redis/redis-rate-limit.spec.ts`
- `apps/api/test/staging-security.e2e-spec.ts`
- `apps/api/test/trip-origin.e2e-spec.ts`
- `apps/api/test/content-trips.e2e-spec.ts`
- `apps/api/test/collab-share.e2e-spec.ts`
- `e2e/live-support/redis-stub.ts`（按任务授权扩展 INCR/TTL/SET/GET/EXPIRE）

边界说明:

- 未修改 Web/Admin UI、contracts、DB schema/migration、Docker/CI 或 root lockfile。
- 未修改 `apps/api/package.json`，没有新增依赖。
- `.env.example` 不在本任务可写范围，因此新增环境变量由运维/根 Agent 后续同步。

## 2. 修复内容

### STG-SEC-001 — Auth 读取不再被全局 10/min 误伤

- 关闭 Better Auth 自身的全局 `rateLimit`；它此前会把 `get-session` 也计入
  10/min/IP。
- 新增 `AuthMutationRateLimitGuard`，只对 `/v1/auth/**` 的 unsafe method
  （POST/PUT/PATCH/DELETE）执行 10/min/IP；GET/HEAD/OPTIONS 不计数。
- 登录、注册、密码重置、邮箱验证、2FA 等 POST 仍受限制。
- 429 由统一 Problem Details filter 输出，并带 `Retry-After`。

### STG-SEC-002 — 公开分享与上传限流

新增 Redis-first、进程内 fallback 的固定窗口限流：

- 公开分享读取：60/min/IP。
- 分享密码尝试：20/min/IP。
- media presign：20/min/IP。

默认窗口 60 秒，均可配置:

```text
RATE_LIMIT_WINDOW_SECONDS=60
AUTH_RATE_LIMIT_MAX=10
PUBLIC_SHARE_RATE_LIMIT_MAX=60
PUBLIC_SHARE_PASSWORD_RATE_LIMIT_MAX=20
MEDIA_PRESIGN_RATE_LIMIT_MAX=20
```

Redis 使用 `INCR` + `TTL` + 按需 `EXPIRE` 的分布式固定窗口。Redis 不可用或
750ms 内未响应时回退到当前 API 进程内计数器，并同时:

- 在响应中设置 `X-RateLimit-Degraded: true`；
- 以节流方式记录 `rate_limit.redis_fallback` 警告；
- 在 429 响应中始终设置整数秒 `Retry-After`。

所有限流响应同时带 `RateLimit-Limit`、`RateLimit-Remaining` 和
`RateLimit-Reset`。

### STG-SEC-003 — unsafe 写接口 Origin/Referer 校验

新增全局 `OriginGuard`，覆盖全部 unsafe `/v1/**` 自定义写接口及 Better Auth
路由:

- 有 `Origin` 时只校验 `Origin`；没有时校验 `Referer`。
- allowlist = `APP_URL`、`ADMIN_URL`、`API_URL`、`BETTER_AUTH_URL` 和
  `CORS_ORIGINS` 的去重 origin 集合。
- 恶意、空、`null`、数组或不可解析 Origin/Referer 返回 403
  `CSRF_ORIGIN_REJECTED`。
- 两者都缺失的非浏览器请求放行。
- 逻辑不读取 `NODE_ENV`，test/staging/production 行为一致；Better Auth 在
  staging 的恶意 Origin 现在也会在进入 handler 前返回 403。

### STG-SEC-005 — 省略可选 origin 不再 500

- 新增 canonical origin：
  - 省略、空串、纯空白或 legacy 空值统一呈现为 `未填写`；
  - 非空值先 `trim()`。
- create/update 写入前规范化，`presentTrip` 对历史空值同样做 fallback。
- 公开分享 payload 也做同一 fallback，避免历史空 origin 在 public share
  再次触发 `ZodError`。
- 说明：`packages/contracts` 的 `TripSchema.origin` 当前要求 1–120 字符，
  且任务禁止修改 contracts，因此不能直接返回 literal `""`/`null`。本实现采用
  QA 报告给出的第一个建议（非空 canonical value `未填写`）。若要强制 API
  返回空串/null，必须由契约 owner 先修改 `TripSchema`/`PublicTripSchema`。

## 3. 修复前后证据

### 修复前（QA 实际运行）

- `STG-SEC-001`: production API 同一 IP 连续 15 次
  `GET /v1/auth/get-session` -> `200 x10`，随后 `429 x5`。
  证据: `test-results/staging/evidence/production-headers.json`。
- `STG-SEC-002`: share 读取 80 次无 429；密码错误 20 次无 429；
  presign 20 次全部 201。
  证据: `test-results/staging/evidence/rate-limit-probes.json`。
- `STG-SEC-003`: evil Origin 的 production 自定义写返回 201；staging 因空 body
  返回 400 `VALIDATION_ERROR`，不是 403。任务内新增的修复测试使用 test 环境
  复现并断言 403。证据: `test-results/staging/evidence/csrf-probe.json`。
- `STG-SEC-004`: staging `NODE_ENV=test` 的 evil-Origin sign-in 为 200，
  production 为 403。证据: 同目录 `csrf-probe.json` 与
  `production-headers.json`。
- `STG-SEC-005`: 省略 origin 的 create trip 返回 500，日志为
  `ZodError` in `presentTrip`。证据: `STG_QA_SECURITY_REPORT.md` §4。

### 修复后（本工作区实际执行）

- `apps/api/test/staging-security.e2e-spec.ts`
  - 15 次 get-session 中无 429；
  - auth mutation 前 10 次非 429，第 11 次 429，含 `Retry-After`；
  - share read 第 61 次 429；
  - share password 第 21 次 429；
  - media presign 第 21 次 429；
  - evil Origin/Referer 返回 403 `CSRF_ORIGIN_REJECTED`；
  - 无 Origin 和允许 Origin 均通过 Origin guard（随后正常 401）；
  - fallback 响应的 `X-RateLimit-Degraded: true` 被断言。
- `apps/api/src/common/security/__tests__/origin.guard.spec.ts`
  - `production=false` 与 `production=true` 两组均执行相同 allow/reject
    断言，并覆盖 `null` 与重复 Origin header。
- `apps/api/src/modules/redis/redis-rate-limit.spec.ts`
  - 通过真实 TCP Redis 协议 stub 验证 `INCR/TTL` 分布式计数：
    10 次 allowed，第 11 次 denied，`degraded=false`。
- `apps/api/test/trip-origin.e2e-spec.ts`
  - 省略 origin -> HTTP 201，响应 `origin: "未填写"`；
  - 带 `"  Shanghai  "` -> HTTP 201，响应 `origin: "Shanghai"`。
- `apps/api/test/content-trips.e2e-spec.ts`
  - legacy `origin: ""` 由 `presentTrip` 正常呈现为 `未填写`。
- `apps/api/test/collab-share.e2e-spec.ts`
  - legacy 空 origin 的 public share 正常返回 `未填写`。

## 4. 验证命令与结果

最终全量结果:

```text
pnpm --filter @roamlog/api test
49 passed | 4 skipped files
259 passed | 7 skipped tests
exit 0

pnpm --filter @roamlog/api typecheck
tsc --noEmit
exit 0

pnpm --filter @roamlog/api build
tsc -p tsconfig.build.json
exit 0

pnpm --filter @roamlog/api lint
eslint .
exit 0
```

聚焦回归:

```text
pnpm --filter @roamlog/api test -- --run test/staging-security.e2e-spec.ts
7 passed

pnpm --filter @roamlog/api test -- --run \
  src/common/security/__tests__/rate-limit.service.spec.ts \
  src/common/security/__tests__/origin.guard.spec.ts \
  test/staging-security.e2e-spec.ts \
  test/trip-origin.e2e-spec.ts \
  test/content-trips.e2e-spec.ts
29 passed

pnpm --filter @roamlog/api test -- --run src/modules/redis/redis-rate-limit.spec.ts
1 passed
```

## 5. 已知风险 / 未覆盖项

1. 进程内 fallback 不是跨实例共享限流。Redis 不可用时会标注 degraded，
   但仍可能在多副本部署中放大有效阈值。production/staging 应保留 Redis
   readiness 告警，并把 degraded 响应纳入监控。
2. 本次 Redis 证据来自扩展后的协议 stub，不是真实 staging Redis。需要按
   staging 复验任务在真实 Redis 上重跑 k6/并发多实例门禁。
3. `apps/api/src/config/environment.ts` 已接受并校验五个限流变量，但
   `.env.example` 与 `docker/staging.env.example` 不在本任务可写范围；
   集成前需由对应 owner 补入示例文档。
4. 既有 `e2e/staging/security-gates.spec.ts` 的请求数与“超过阈值才拒绝”
   语义有 off-by-one 差异：
   - password/upload 当前各发 20 次，严格语义下第 21 次才 429；
   - share enumeration 在同一测试内先发 64 次不同 token，IP 级 60/min
     会让第 61 次开始 429。
   本任务未修改该文件（不在可写范围）。复跑 staging 前应改为
   password/upload 至少 21 次，并把 enumeration 与 rate-limit probe 拆分或
   使用不同时间窗/IP。
5. Origin guard 依赖 Express 的 `request.ip`。反向代理后必须正确设置
   `TRUST_PROXY=true`，否则所有客户端可能共享 edge IP；现有环境已提供该开关。
6. 未执行真实 staging PostgreSQL/Redis/MinIO 的 `pnpm e2e:staging` 或 k6。
   本次结论是 API 代码、契约边界和回归测试层面的修复证据。

## 6. 建议的下一步

1. 根 Agent 验收本 diff 后，在真实 staging Redis 上执行更新后的
   `e2e/staging/security-gates.spec.ts`（21 次阈值 + 独立枚举测试）和 k6
   security summary。
2. 将五个限流环境变量同步到 `.env.example` 和 staging env 示例，并在
   dashboards/alerts 中加入 `X-RateLimit-Degraded` / fallback warning。
3. 如产品确需 API literal `origin: ""` 或 `null`，先开 ADR/contract 变更，
   同步 `TripSchema`、`PublicTripSchema`、OpenAPI、Orval、Web 展示和迁移。
4. 后续可加入 route-level 429 指标和按 account/token 组合的辅助限流，
   但当前实现已满足本任务的 IP 阈值。

## 7. 证据边界声明

- 3000/3001 预览未由本任务停止；结束检查为 3000=200、3001=307。
- 未 commit、未建分支、未 push。
- 未声称真实 staging、真实 Redis、MinIO、TLS 或 k6 已通过。
