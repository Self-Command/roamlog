# API_PLACES — 服务端地点搜索实现报告

- 任务 ID：`API_PLACES`
- 角色：`backend_api`
- 状态：**DONE**（仓库级 typecheck 在最后一次运行时被其他任务的 `packages/db` 在途改动污染，见「验证命令与结果」；本模块无诊断）
- 日期：2026-11-18
- 仓库：`C:\Users\BY9700\Desktop\UI\roamlog`

## 1. 变更文件

新增（`apps/api/src/modules/places/`）：

| 文件 | 作用 |
|---|---|
| `places.settings.ts` | `PLACES_SETTINGS` 注入 token、默认值、`process.env` 解析（含非法值回退） |
| `photon-normalizer.ts` | Photon FeatureCollection → 严格 `Place`；缺字段丢弃；`provider` 恒为 `photon` |
| `photon.client.ts` | Photon 代理：AbortController 2.5s、只传 q/limit/lang/可选 bbox、4xx/5xx/超时/JSON 异常 → 类型化失败 |
| `places-cache.service.ts` | Redis 缓存：sha256 key、15min/30s TTL、读校验、故障吞掉并限频 warn |
| `places-rate-limiter.service.ts` | 用户+IP 固定窗口 30/min，Redis 故障 fail-open |
| `places-rate-limit.guard.ts` | `RateLimit-*` / `Retry-After` 头 + `429 RATE_LIMITED` Problem Details |
| `places.service.ts` | 契约校验 → 缓存 → 上游 → 归一化 → 契约 parse → 回写缓存 → 降级 |
| `places.controller.ts` | `GET /v1/places/search`，`SessionGuard + VerifiedEmailGuard + PlaceSearchRateLimitGuard` |
| `places.module.ts` | 模块装配 |

测试（`apps/api/src/modules/places/__tests__/`）：

- `photon-normalizer.spec.ts`（20）
- `photon.client.spec.ts`（13）
- `places.service.spec.ts`（13）
- `places.controller.spec.ts`（8，Nest Testing + supertest）
- `places.module.spec.ts`（3，`AppModule` DI 装配 + 设置解析）
- `place-fixtures.ts`（共享 fixture，非测试文件）

修改：`apps/api/src/app.module.ts` —— 仅两行注册（import `PlacesModule` + imports 数组一项）。见 `git diff`。

未触碰：`packages/contracts/**`、`packages/api-client/**`、`packages/db/**`、其他 `apps/api/src/modules/**`、`apps/web/**`、`apps/admin/**`、compose/deploy、lockfile、其他 `.audit` 文件。

## 2. 实现摘要

### 2.1 路由与鉴权

- `@Controller("places")` + `@Get("search")`，全局前缀 `v1` → `GET /v1/places/search`。
- 守卫栈与现有非 workspace 认证路由一致（`/me`、`/notifications`、`/exports`）：`SessionGuard, VerifiedEmailGuard, PlaceSearchRateLimitGuard`。
- 不要求 workspace/租户（建旅行前就要搜索）。
- 非法 query 经 `parseRequest(PlaceSearchQuerySchema, …)` → `400 VALIDATION_ERROR`（与现有服务层风格一致）。`PlaceSearchQuerySchema` 为 `.strict()`，`bbox` 等未定义参数同样 400。
- 响应 `PlaceSearchResponseSchema.parse()` 严格校验后才返回；契约字段 `cached` 如实填充。

### 2.2 Photon 代理

- URL：`PHOTON_URL`（默认 `https://photon.komoot.io/api`）+ `q`、`limit`、可选 `lang`、可选 `bbox`；不发送 cookie/authorization/任何用户标识（`credentials: "omit"`，仅 `accept: application/json`）。
- 2.5s 总预算：单个 `AbortController` 覆盖「首次尝试 + 可能的 lang 重试」。
- 归一化：`name/country/countrycode/coordinates` 必填，缺失即丢弃；`providerPlaceId = ${osm_type}:${osm_id}`（任一缺失则 `null`，不伪造）；`timeZone: null`（Photon 无此字段）；`type` 由 `type/osm_value/osm_key` 映射到 `city|region|country|poi|other`；最后再过一遍 `PlaceSchema.safeParse` 兜底。
- 上游 4xx/5xx/超时/网络错误/JSON 异常/非 FeatureCollection → `200 { items: [], provider: "photon", degraded: true, cached: false }`；结构化 warn 只含 `reason/status/durationMs/queryLength/limit/lang`，**不含 query 原文**。
- `zh` 不向上游转发：实测公共 Photon 仅支持 `default|de|en|fr`，`lang=zh` 返回 400 且耗时约 2.4s，会耗尽预算导致所有中文搜索降级。因此 `zh` 使用上游默认（本地 OSM 名称），`en` 正常转发；若上游仍以 400 拒绝已转发的语言，在同预算内重试一次不带 `lang`。证据见 §4.3。

### 2.3 Redis 缓存

- key：`places:search:` + `sha256(trim+lower(q) + "\0" + limit + "\0" + lang)`；不落原始 query。
- TTL：正常结果 900s；空结果与降级 30s（防击穿）。
- 读取时用契约重新校验，且只接受 `provider === "photon"`；被污染的 `local` 条目视为未命中，search 永远不会返回手动地点假数据。
- Redis `get/set` 抛错或超时（500ms）→ 记录限频 warn（10s 一条）并继续请求上游；请求不 500。
- 命中时日志 `cache: "hit"`（响应体只有契约字段 `cached: true`，不新增响应字段）。

### 2.4 限流

- 维度：`user:<userId>|ip:<ip>`，固定窗口 30 次/分钟（`PLACES_RATE_LIMIT_*` 可调）。
- Redis 可用时用 `RedisService.incrementFixedWindow`（750ms 超时）；超限返回 `429 RATE_LIMITED`，带 `Retry-After`。
- Redis 故障：**fail-open**（warn `places.rate_limit_fail_open`，允许请求），不会造成整站 429。
- 说明：共享的 `RateLimitService` 的 `RateLimitPolicy` 是封闭联合类型，且 `common/security/**` 与 `config/**` 不在本任务可写边界内，故在本模块内用同一 Redis 原语实现小型限流器，未改动共享代码。

### 2.5 手动地点

- 契约 `PlaceProviderSchema = ["photon", "local"]`。search 只返回 `provider: "photon"`；归一化、响应组装、缓存读取三处都强制这一点。
- 手动地点仍由客户端提交 Stop（`CreateStopRequest.provider = "local"`）完成，本任务未改 Stop 写入链路。
- 测试：`places.service.spec.ts`「never serves a cached local (manual) place from search」证明缓存中伪造的 local 条目不会被返回。

## 3. 验证命令与结果

### 3.1 类型检查

```bash
pnpm --filter @roamlog/api typecheck
```

- 19:40（本模块完成、fixture 类型修复后）：`tsc --noEmit` **exit 0**。
- 20:01 复核：仓库内其他任务正在改 `packages/db`（`schema.prisma` + 新增迁移 `0003_w0_trip_stop_place_metadata`），报错仅为：

```text
../../packages/db/src/factories.ts(87,3): error TS2719 ... 'originLat' ... Type 'number | null | undefined' is not assignable to type 'number | null'
```

  该文件不在本任务可写边界内，且 `git status` 显示为其他 agent 的在途改动。
- 20:10 用 TypeScript Compiler API 对 `apps/api/tsconfig.json` 全量 program 做诊断扫描，仅把上述外来文件按路径忽略，结果：

```text
diagnostics=1 ignoredForeign(packages/db/src/factories.ts)=1 relevant=0
```

  即除该外来文件外，整个 `@roamlog/api`（含 places 模块与全部测试）**零类型诊断**。

### 3.2 单元/集成测试

```bash
pnpm --filter @roamlog/api exec vitest run src/modules/places
```

最终一次运行（20:01）：

```text
✓ src/modules/places/__tests__/places.controller.spec.ts (8 tests)
✓ src/modules/places/__tests__/places.module.spec.ts (3 tests)
✓ src/modules/places/__tests__/photon.client.spec.ts (13 tests)
✓ src/modules/places/__tests__/places.service.spec.ts (13 tests)
✓ src/modules/places/__tests__/photon-normalizer.spec.ts (20 tests)

Test Files  5 passed (5)
Tests       57 passed (57)
```

覆盖点对照：

| 要求 | 测试 |
|---|---|
| 正常映射 | normalizer「maps a Photon feature onto the strict Place contract」；service 首个用例 |
| 字段缺失丢弃 | normalizer `it.each`（name/country/countrycode/坐标缺失与越界） |
| 超时降级 | client「aborts after the configured timeout」；service「degrades on a timeout」 |
| 上游 500 降级 | client「degrades on an upstream HTTP error」；service + controller「degraded 200」 |
| 非法 query 拒绝 | service「rejects invalid queries…」；controller 400 `VALIDATION_ERROR` |
| 未登录 401 | controller「rejects an anonymous request with 401」（真实 `SessionGuard` + `AuthService.resolveSession → null`） |
| 缓存命中不二次请求 | service「serves a cache hit…」；controller「serves the second identical request from cache」 |
| Redis 抛错仍 200 | service get/set 抛错用例；controller 限流 fail-open 用例 |
| 限流 429 | controller「returns 429 when the per-user window is exhausted」 |
| 响应通过契约 parse | service/controller 内 `PlaceSearchResponseSchema.parse(...)` 断言 |
| 不返回 local 假数据 | service「never serves a cached local (manual) place…」；normalizer「never emits a local place」 |
| 模块注册/DI | `places.module.spec.ts` 编译 `AppModule` 并解析 `PlacesService`/`PlacesController`/`PlaceSearchRateLimitGuard` |

### 3.3 手工外网证据（非测试依赖）

```bash
curl "https://photon.komoot.io/api?q=paris&limit=2&lang=zh"
# http=400 time=2.48s
# {"lang":[{"message":"Language is not supported. Supported are: default, de, en, fr","value":"zh"}]}
```

真实 `PhotonClient` 直连（临时脚本，运行后已删除）：

```json
{"lang":"zh","ok":true,"reason":null,"durationMs":1957,"items":["上海街道","上海市","上海市"]}
{"lang":"en","ok":true,"reason":null,"durationMs":898,"items":["Shanghai","Shanghai","Shanghai"]}
```

说明：修复前 `lang=zh` 会 400→重试→2.5s 超时；修复后中文搜索正常返回本地名称（约 1.96s，仍在 2.5s 预算内）。

## 4. CodeGraph 证据

1. `codegraph status` → `[OK] Index is up to date`（1,339 files / 19,718 nodes / 41,594 edges；收尾复核仍为 `[OK]`）。
2. `codegraph explore "PlaceSearchQuery PlaceSearchResponse places search redis rate limit"` →
   - `packages/contracts/src/api/places.ts`：`PlaceSchema`（strict）、`PlaceSearchQuerySchema`（trim/limit 1..10 default 6/lang zh|en）、`PlaceSearchResponseSchema`（`items/provider/degraded/cached`）；
   - `packages/api-client/.../places.ts`：已生成的 `searchPlaces` / `getSearchPlacesUrl`，确认路由与响应字段；
   - blast radius：仅 api-client 生成代码引用，无既有服务端实现（确认为空白）。
3. `codegraph explore "parseRequest problem details exception filter auth guard SessionGuard CurrentUser rate limiter throttle"` →
   - `apps/api/src/common/services/request-validation.ts:parseRequest`（→ `400 VALIDATION_ERROR`）；
   - `apps/api/src/common/security/rate-limit.service.ts`（`RateLimitPolicy` 封闭联合、Redis 原语、内存回退）；
   - `rate-limit-http.ts`（429 头与 Problem Details 风格）；
   - `public-share-rate-limit.guard.ts` / `media-presign-rate-limit.guard.ts`（守卫写法）；
   - `problem-details.filter.ts`（`RATE_LIMITED`/`VALIDATION_ERROR` 映射）；
   - `session.guard.ts` + `verified-email.guard.ts` + `tenant.guard.ts`（认证守卫栈）。
4. `codegraph explore "RedisService incrementFixedWindow …"` → `RedisService.incrementFixedWindow` 签名与 `set/get/delete`；`ObservabilityModule`/`RedisModule` 为 `@Global`，无需重复注册。

## 5. 已知风险

1. **上游可用性/合规**：默认使用公共 `https://photon.komoot.io/api`；审计报告建议自托管 Photon。公共实例有速率限制且不保证 SLA，`PHOTON_URL` 已可覆盖，但 compose/env 未配置（不在可写范围）。
2. **中文语言能力**：公共 Photon 不支持 `lang=zh`，中文搜索返回 OSM 本地名称（通常为中文，但非保证）；若后续自托管支持 zh，需要扩展 `FORWARDED_UPSTREAM_LANGS`。
3. **延迟**：实测上海查询 0.9–2.0s，接近 2.5s 预算；慢查询会降级为空列表（契约允许），依赖 30s 空结果缓存避免击穿。
4. **配置未纳入 schema**：`PHOTON_URL`、`PHOTON_TIMEOUT_MS`、`PLACES_CACHE_TTL_SECONDS`、`PLACES_EMPTY_CACHE_TTL_SECONDS`、`PLACES_RATE_LIMIT_MAX` 等直接读 `process.env`，`apps/api/src/config/environment.ts` 未注册（文件边界外），建议 config owner 后续补入校验。
5. **限流实现位置**：未扩展共享 `RateLimitService`（封闭 policy 联合 + 边界限制），本模块独立实现，行为一致但存在两份相似代码。
6. **fail-open 语义**：Redis 故障时限流不生效（按任务要求），高流量时可能放大上游压力。
7. **降级响应缓存**：按任务要求降级/空结果缓存 30s，上游持续故障时每个不同 query 每 30s 仍会打一次上游。
8. **`providerPlaceId`**：OSM id 缺失时为 `null`（契约允许）；极少数 Photon 结果可能因此无法去重。
9. **`timeZone`**：Photon 不返回时区，search 恒为 `null`，不按坐标臆测。

## 6. 未覆盖项

- 未跑真实 PG/Redis 的 e2e（`apps/api/test/places*.e2e-spec.ts` 未新增）：本机无完整 compose 栈，按任务允许跳过。
- 未启动真实 API 进程做 curl 冒烟（需要 PG+Redis+Better Auth 环境）；以 `AppModule` DI 编译测试 + 真实 Photon 客户端直连代替。
- 未接 Web `PlaceCombobox`（`apps/web` 禁止修改）；前端仍需改为调用 `useSearchPlaces` 并在 `degraded` 时展示「简化地点库」。
- 未改 OpenAPI/生成客户端（契约已存在，禁止修改）。
- 未验证自托管 Photon 的 `zh` 行为（无实例）。

## 7. 建议的下一步

1. `w0-db`/config owner 将 `PHOTON_URL` 等变量加入 `environment.ts` 与部署环境；生产建议自托管 Photon 并设置 `PHOTON_URL`。
2. Web 任务接入 `useSearchPlaces`，处理 `degraded`（提示简化地点库）与 429（退避重试），选中后写 Stop 的 `provider/providerPlaceId/timeZone`。
3. QA 在 staging 增加 e2e：登录 → 搜索 → 选中 → 保存 Stop；并验证 401/400/429/降级四条分支。
4. 若需要多语言结果，给 Photon 索引配置 zh 语言并放开 `FORWARDED_UPSTREAM_LANGS`。
