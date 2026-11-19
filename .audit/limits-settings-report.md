# LIMITS_SETTINGS_WIRED — 限流器接线（`limits.searchPerMinute` 生效；`limits.uploadPerMinute` 诚实标注未接线）

- 任务 ID：`LIMITS_SETTINGS_WIRED`
- 角色：backend_api + admin_frontend
- 状态：**DONE（部分键生效，已按字段级诚实标注）**
  - `limits.searchPerMinute`：**真生效**（places 搜索限流，真实 API 联调已验证 429/恢复）
  - `limits.uploadPerMinute`：**未生效**（resolver 会读取并校验，但 presign 限流不在本任务可写文件边界内，未接线；不标 backend）
- 日期：2026-11-19（Asia/Shanghai）
- 范围：`apps/api/src/modules/settings/limits-settings.consumer.ts`（新建）、`apps/api/src/modules/places/**`（限流点）、`apps/admin/lib/admin-settings.ts`、`apps/admin/components/settings/settings-consumption.ts`、对应测试、本报告。

---

## 1. 变更文件

### Commit 1 — api

```
apps/api/src/modules/settings/limits-settings.consumer.ts          (new)
apps/api/src/modules/settings/__tests__/limits-settings.consumer.spec.ts (new)
apps/api/src/modules/places/places-rate-limiter.service.ts          (限流器真正读取 limits)
apps/api/src/modules/places/places.module.ts                       (注册 resolver + LIMITS_SETTINGS)
apps/api/src/modules/places/__tests__/places.controller.spec.ts    (注入 limits source + 新增用例)
.audit/limits-settings-report.md
```

> 说明：30/min 的硬编码实际位于 `places-rate-limiter.service.ts`（`places-rate-limit.guard.ts` 只做 HTTP 映射），因此接线点在 limiter 而非 guard；guard 文件本次**未改**（行为不变）。二者同属任务允许的 places 限流点。

### Commit 2 — admin

```
apps/admin/lib/admin-settings.ts
apps/admin/components/settings/settings-consumption.ts
apps/admin/components/settings/admin-settings.test.ts
```

未触碰：`settings.service.ts`、`settings.registry.ts`、`packages/**`、`apps/web/**`、`apps/api/src/modules/{reports,email,media,ai,health,metrics}/**`、`apps/api/src/bootstrap/**`、`common/security/**`。

> `apps/admin/components/settings/settings-console.test.tsx` 在工作区显示为 modified，是并行 Agent 的 AI 设置改动，**未纳入本次 commit**。

---

## 2. 实现摘要

### 2.1 `LimitsSettingsResolver`（`settings/limits-settings.consumer.ts`）

```ts
export interface LimitsRuntime { searchPerMinute: number; uploadPerMinute: number }
export async resolve(): Promise<LimitsRuntime>
```

- 优先级：`envLocked`（registry / 行标记）→ env；否则 **DB > env > 默认**。
- 默认值沿用现有代码常量：搜索 30（= registry 默认）、上传 20（= 现有 `MEDIA_PRESIGN_RATE_LIMIT_MAX` 默认）。
- env 回落：`PLACES_RATE_LIMIT_MAX` / `MEDIA_PRESIGN_RATE_LIMIT_MAX`（保留各自既有 1..100000 边界，避免把生产 env 1000 误降为 30）。
- **裸行判定**：用 `SettingsService.listAdminSettings()` 的 `updatedAt === null` 判断“DB 行是否存在”。不用 `getGroup("limits")`，因为它会把 registry 默认值混入结果，导致“没有行时 env 永远输给默认值”（storage consumer 的同样做法）。
- 非法 DB 值（<=0、非整数、>600、非 number、null）→ 逐键回落 env/默认，`warn limits.setting_value_ignored`，10s 节流，**不抛**。
- DB 不可用 → 回落 env/默认，`warn limits.settings_unavailable`，10s 节流，**不阻塞启动**（构造函数不读 DB，仅请求时读）。
- 每请求解析，**不新增缓存**（任务要求：改配置不能等缓存过期）；`listAdminSettings()` 单条索引查询，权限/频率可接受。
- DI token `LIMITS_SETTINGS`；`useExisting` 注册于 `PlacesModule`（与 mail/storage consumer 的注册方式一致，settings.module 只读）。

### 2.2 接进限流

- `PlacesRateLimiter.consume()`：`limit = (await limits.resolve()).searchPerMinute`，window 仍为 `places.rateLimitWindowSeconds`（默认 60s）。
- 语义保持：Redis `incrementFixedWindow`、超限 429 `RATE_LIMITED` + `Retry-After` + `RateLimit-*` 头、Redis 故障 **fail-open**（R1 行为不变）。
- 改回 30 后下一请求即恢复（无本地缓存，Redis 计数 3 <= 30）。
- **上传/presign**：现有 presign 限流点在 `apps/api/src/common/security/media-presign-rate-limit.guard.ts` + `RateLimitService("mediaPresign")`，不在本任务允许的文件边界（`apps/api/src/modules/media/*rate-limit*` 不存在该文件）。且 `SecurityModule` 反向依赖 `AuthModule` → `AccessControlModule` → `SettingsModule`，直接 import SettingsModule 会形成模块环。**故未接线，不新造限流点，不假装生效**。

### 2.3 Admin 诚实标注（字段级）

| 键 | 状态 | 文案 |
| --- | --- | --- |
| `limits.searchPerMinute` | `backend` | 后端已消费（Places 搜索限流，按请求解析） |
| `limits.uploadPerMinute` | `unwired` | 未接入（presign 限流仍读环境变量） |
| `limits`（组） | **`unwired`**（黄） | 部分接入（搜索限流已生效；上传限流未接入，仍读环境变量） |

组徽章保持黄色：两个键未同时生效前**绝不**标 `backend`；新增测试断言 `SETTINGS_CONSUMPTION.limits.status !== "backend"`。

---

## 3. 验证命令与原始输出

### 3.1 `pnpm --filter @roamlog/api typecheck` — 被并行文件污染；本任务 0 错误

```
$ pnpm --filter @roamlog/api exec tsc --noEmit
src/modules/media/media.presenter.ts(81,22): error TS2551: Property 'location' does not exist on type 'MediaRecord'...
src/modules/media/media.presenter.ts(89,11): error TS2322 ...
src/modules/reports/__tests__/admin-reports.service.spec.ts(201,12): error TS18046 ...
src/modules/share-links/share-links.service.ts(292,17): error TS2304: Cannot find name 'motionSource'.
src/modules/trips/content-presenters.ts(108,25): error TS2339 ...
$ ... | grep -E "modules/(places|settings/limits)"
[modules/places+modules/settings/limits TS errors: 0]
```

（media/reports/share-links/trips 均为并行 Agent 正在改的文件，非本次变更。）

### 3.2 `pnpm --filter @roamlog/api exec vitest run src/modules/places src/modules/settings src/modules/media`

本任务两个套件全绿；唯一失败来自并行 Agent 的 `media-url.service.spec.ts`（`motionUrl` 字段未同步）：

```
 ✓ src/modules/settings/__tests__/limits-settings.consumer.spec.ts (11 tests)
 ✓ src/modules/places/__tests__/places.controller.spec.ts (10 tests)
 ✓ src/modules/places/__tests__/places.module.spec.ts (3 tests)
 ✓ src/modules/places/__tests__/places.settings.spec.ts (6 tests)
 ✓ src/modules/settings/__tests__/settings.service.spec.ts (24 tests)
 ✓ src/modules/settings/__tests__/admin-settings.controller.spec.ts (12 tests)
 ... 18 passed
 FAIL src/modules/media/__tests__/media-url.service.spec.ts (3 tests, motionUrl)
 Test Files  1 failed | 18 passed (19)
      Tests  3 failed | 232 passed (235)
```

新增/更新用例覆盖：
- resolver：DB 覆盖 env；无 DB 行时 env 胜；envLocked 时 env 胜；非法值（0/-1/601/2.5/string/null）逐键回落 + 节流 warn；DB 抛错回落 env/默认且不抛；坏 search 行不影响好 upload 行。
- 限流（真实 guard + stub redis + HTTP）：`searchPerMinute=2` 时第 3 次 429（`Retry-After`、`RateLimit-Limit: 2`）；改回 30 后立即 200；Redis 故障仍 fail-open。

### 3.3 Admin

```
$ pnpm --filter @roamlog/admin typecheck
$ tsc --noEmit          [exit code: 0]

 ✓ components/settings/admin-settings.test.ts (11 tests)
 ✓ components/settings/settings-console.test.tsx (18 tests)
 ✓ lib/admin-paths.test.ts (3 tests)
 ✓ lib/admin-data-source.test.ts (5 tests)
 Test Files  4 passed (4)
      Tests  37 passed (37)
```

### 3.4 真实联调（自起 4240 + PG 55444/public + redis stub 46399）

启动：`API_PORT=4240 ... tsx src/main.ts`；`/v1/health` 200。登录用本地 `authz-super@roamlog.test`（super_admin，`ADMIN_2FA_ENFORCED=false`）。

**步骤 A：PATCH `limits.searchPerMinute=2`**

```
PATCH /v1/admin/settings {"updates":[{"key":"limits.searchPerMinute","value":2}]}
HTTP 200
{"updated":[{"key":"limits.searchPerMinute","secret":false,"updatedAt":"2026-11-19T07:22:57.358Z"}],"version":1,...}

GET /v1/admin/settings
[{"key":"limits.searchPerMinute","value":2,"updatedAt":"..."},
 {"key":"limits.uploadPerMinute","value":10,"updatedAt":null}]
```

**步骤 B：连续 3 次 `GET /v1/places/search?q=kyoto`**

```
--- request 1 --- HTTP/1.1 200 OK   RateLimit-Limit: 2  RateLimit-Remaining: 1  RateLimit-Reset: 60
{"items":[{"provider":"photon",... "name":"京都市",...}
--- request 2 --- HTTP/1.1 200 OK   RateLimit-Limit: 2  RateLimit-Remaining: 0  RateLimit-Reset: 59
--- request 3 --- HTTP/1.1 429 Too Many Requests
RateLimit-Limit: 2  RateLimit-Remaining: 0  RateLimit-Reset: 58  Retry-After: 58
{"type":"...","status":429,"code":"RATE_LIMITED","detail":"Too many requests. Retry after the indicated delay.","instance":"/v1/places/search",...}
```

**步骤 C：改回 30 → 再 3 次全 200（下一请求立即恢复）**

```
PATCH {"limits.searchPerMinute":30} → HTTP 200 version 2
request 1: HTTP 200 RateLimit-Limit: 30
request 2: HTTP 200 RateLimit-Limit: 30
request 3: HTTP 200 RateLimit-Limit: 30
```

验证后已删除测试创建的 `limits.*` 行（`updatedAt: null` 恢复），4240/46399 已停止，未动 4000/3001。

---

## 4. CodeGraph 证据

```
$ cd roamlog && codegraph status
[OK] Index is up to date

$ codegraph explore "LimitsSettingsResolver PlacesRateLimiter limits.searchPerMinute"
Found 73 symbols across 3 files.
- PlacesRateLimiter (places-rate-limiter.service.ts:37) — 4 callers: places-rate-limit.guard.ts,
  places.module.ts; tests: places.controller.spec.ts
- LimitsSettingsResolver (settings/limits-settings.consumer.ts:216) — 3 callers in places.module.ts;
  tests: limits-settings.consumer.spec.ts
- implements: LimitsSettingsResolver → LimitsSettingsSource
- calls: consume → resolve (places settings), consume → resolve (limits), consume → incrementFixedWindow
```

结论：限流器只有 `PlaceSearchRateLimitGuard` 一个调用方，接线点无遗漏；`LIMITS_SETTINGS` 仅由 `PlacesModule` 注册。

---

## 5. 逐键真实生效表

| 键 | 解析 | 运行时消费 | 结论 |
| --- | --- | --- | --- |
| `limits.searchPerMinute` | ✅ 每请求 DB/env/default | ✅ `PlacesRateLimiter` 决定每窗口上限（429/Retry-After） | **backend / 真生效** |
| `limits.uploadPerMinute` | ✅ 读取+校验+warn | ❌ presign 仍用 `MEDIA_PRESIGN_RATE_LIMIT_MAX`（`common/security`，边界外） | **unwired / 未生效** |

---

## 6. 已知风险

1. `limits.searchPerMinute` 的“每分钟”依赖 `PLACES_RATE_LIMIT_WINDOW_SECONDS`（默认 60s）；若运维把窗口改为非 60s，该键语义变为“每窗口”，报告已注明，未强行覆盖 env 窗口。
2. resolver 每请求执行一次 `listAdminSettings()`（单条 `findMany`）；搜索路径已有会话等 DB 访问，未新增缓存是为满足“保存后下一请求立即生效”。
3. `limits.uploadPerMinute` 的默认值存在口径差异：registry `DEFAULT_SETTINGS` 为 10，presign env 默认 20；因未接线，当前无运行时影响；接线前需统一（建议改 `DEFAULT_SETTINGS` 或 presign env 默认，均不在本任务可写文件）。
4. `envLocked` 的 `limits.*` 目前 registry 未锁定；resolver 支持锁定，但 env 变量名映射为 `PLACES_RATE_LIMIT_MAX` / `MEDIA_PRESIGN_RATE_LIMIT_MAX`。
5. 联调期间修改了本地 `authz-super@roamlog.test` 的密码哈希（仅本地 PG，未写仓库）。
6. API 全量 typecheck 仍被并行 Agent 的 media/reports/share-links/trips 文件染红；合并前需各自负责人修复。

## 7. 未覆盖项

- `limits.uploadPerMinute` 的真实 presign 429 联调（未接线，无对应行为）。
- 非 60s 窗口下的语义联调。
- 多 API 实例下的行为：每实例每请求读 DB，PATCH 后无需 pub/sub 也立即生效（天然一致，未做多实例实测）。

## 8. 建议下一步

1. 单独任务接线 presign：把 `MediaPresignRateLimitGuard`/`RateLimitService("mediaPresign")` 改为读取 `LimitsSettingsConsumer.uploadPerMinute`，同时解决 `SecurityModule` → `SettingsModule` 的模块环（提取独立 `LimitsModule` 或 forwardRef），接线完成后把 `limits` 组与 `uploadPerMinute` 改为 `backend`。
2. 统一 `DEFAULT_SETTINGS["limits.uploadPerMinute"]`（10）与 `MEDIA_PRESIGN_RATE_LIMIT_MAX` 默认（20）。
3. 若要严格“每分钟”语义，可在接线时把 window 固定 60s 或把键改名为 `searchPerWindow`，避免 env 窗口造成歧义。