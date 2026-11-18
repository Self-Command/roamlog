# CONTRACTS_LINT_FIX — IANA 时区正则转义修复报告

状态: DONE（授权改动已完成并证明等价；`contracts test` 与全仓 `lint` 的剩余失败均为**其他 Agent 在途改动**，附证据与 owner）
任务: CONTRACTS_LINT_FIX
时间: 2026-11-18 22:36

---

## 1. 变更（仅 1 行、2 处转义）

`packages/contracts/src/entities/trip.ts:13`

```diff
-  .regex(/^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+)*$/)
+  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/)
```

- 两个字符类里的 `\-` 改为类末尾的 `-`（类内末尾的 `-` 是字面量，语义不变）。
- `\/` 保持不变（js 正则字面量里的 `/` 仍需要转义）。
- 未改其它任何文件；未运行 `contracts:generate`。

**为什么 `git diff` 里看不到 `-` 行**：`IanaTimeZoneSchema` 这一整段在工作区是**其他 Agent 新增的未提交代码**，
`git show HEAD:packages/contracts/src/entities/trip.ts` 里根本没有这条 regex（HEAD 文件只有 `TripSchema`）。
所以 git 把该行显示为新增而不是修改。我的单行改动用字节级前后对比留证：

```
改前（od -c）： . r e g e x ( / ^ [ A - Z a - z ] [ A - Z a - z 0 - 9 _ + \ - ] * ...
改后（od -c）： . r e g e x ( / ^ [ A - Z a - z ] [ A - Z a - z 0 - 9 _ + - ] * ...
```

（`sed -i '13s/\[A-Za-z0-9_+\\-\]/[A-Za-z0-9_+-]/g'` 只作用于第 13 行。）

---

## 2. 语义等价证明

### 2.1 schema 级：`IanaTimeZoneSchema.safeParse` 改前 / 改后

| # | 样本 | 长度 | 改前 | 改后 |
| --- | --- | --- | --- | --- |
| 1 | `Asia/Shanghai` | 13 | PASS | PASS |
| 2 | `UTC` | 3 | PASS | PASS |
| 3 | `America/Argentina/Buenos_Aires` | 30 | PASS | PASS |
| 4 | `Etc/GMT-5` | 9 | PASS | PASS |
| 5 | `Etc/GMT+8` | 9 | PASS | PASS |
| 6 | `Pacific/Kiritimati` | 18 | PASS | PASS |
| 7 | `a-b` | 3 | PASS | PASS |
| 8 | `1abc` | 4 | FAIL | FAIL |
| 9 | `Asia/` | 5 | FAIL | FAIL |
| 10 | `Asia//Foo` | 9 | FAIL | FAIL |
| 11 | 65 字符（`A` + 64×`a`） | 65 | FAIL | FAIL |

**PASS 数：改前 7 / 11，改后 7 / 11。**

改后完整 JSON（与改前输出逐字节一致）：

```
JSON [["Asia/Shanghai",true],["UTC",true],["America/Argentina/Buenos_Aires",true],["Etc/GMT-5",true],["Etc/GMT+8",true],["Pacific/Kiritimati",true],["a-b",true],["1abc",false],["Asia/",false],["Asia//Foo",false],["Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",false]]
```

### 2.2 regex 级穷举对照

两个正则字面量在同一进程内对 531 个语料逐项比较（11 个样本 + ASCII 0x00–0x7F 的四种位置组合
`c`、`x<c>y`、`Etc/GMT<c>`、`Asia/<c>Foo` + 长度边界 64/65 + `a//b`、`a/`、`-a`、`_a`、`+a`、`a/b/c`）：

```
REGEX_EQUIV_MISMATCHES 0 / CORPUS 531
probe "Etc/GMT-5" before true after true
probe "Etc/GMT+8" before true after true
probe "a-b" before true after true
probe "A-Z" before true after true
probe "Asia/Shanghai" before true after true
```

结论：字符类内容集合完全一致（`A-Za-z0-9` + `_` + `+` + `-`），无任何行为差异。

---

## 3. 验证命令与结果

### 3.1 `pnpm --filter @roamlog/contracts lint` → exit 0 ✅

```
$ pnpm --filter @roamlog/contracts lint
$ eslint .
LINT_EXIT=0
```

单文件复核：

```
$ pnpm --filter @roamlog/contracts exec eslint src/entities/trip.ts
ESLINT_FILE_EXIT=0
$ grep -rn "no-useless-escape" packages/contracts/src packages/contracts/scripts
(0 occurrences)
```

### 3.2 `pnpm --filter @roamlog/contracts test` → 2 failed / 50 passed ❌（外部在途改动，非本行）

```
FAIL src/__tests__/openapi.test.ts > OpenAPI document > covers the expected application surface
AssertionError: expected [ '/v1/auth/{path}', '/v1/me', …(92) ] to have a length of 92 but got 94

FAIL src/__tests__/admin.test.ts > Admin operations contracts > includes migration, build, worker, and dependency health metadata
  "message": "Invalid option: expected one of \"consumer-clients\"|\"activity-derived\"|\"unavailable\""
  "expected": "number", "message": "Invalid input: expected number, received undefined"
  "message": "Invalid option: expected one of \"completed\"|\"failed\""
```

**归属证据（这两条与正则无关，且早于我的改动）：**

| 证据 | 内容 |
| --- | --- |
| 多出的 2 条 path | `/v1/media/{mediaId}`（`scripts/openapi/paths-media.ts` 新增，mtime 17:15）与 `/v1/places/search`（新文件 `src/api/places.ts`，mtime 16:19）→ 92 + 2 = 94 |
| 测试文件 mtime | `openapi.test.ts` 17:13:25、`admin.test.ts` 21:13:25，**均早于**我对 trip.ts 的 22:29 改动 |
| schema 文件 mtime | `src/api/admin.ts` 22:17:20（改动 205 行，早于我的改动） |
| 断言内容 | 只涉及路径计数与 `AdminSystem`/`AdminMetrics` 字段，`grep -n "Iana\|pattern\|TimeZone"` 在两个失败测试文件中 **0 命中** |
| 逻辑上 | 我的改动只影响字符串正则的字符类，不可能增删 OpenAPI path 或 AdminSystem 字段 |

→ 这两条需要 API/ADMIN 契约 owner 更新测试期望，不属于本次授权的「只改这一行」。

### 3.3 `pnpm --filter @roamlog/contracts typecheck` → exit 0 ✅

```
$ pnpm --filter @roamlog/contracts typecheck
$ tsc --noEmit
TSC_EXIT=0
```

### 3.4 `pnpm lint`（全仓）→ exit 1 ❌（5 条 error 全在 apps/web 的他人文件）

```
@roamlog/worker:lint: ✖ 19 problems (0 errors, 19 warnings)
@roamlog/web:lint:    ✖ 5 problems (5 errors, 0 warnings)
Failed: @roamlog/web#lint
```

5 条 error 明细（均不在我的改动范围，且这些文件都是 untracked 的其他 Agent 新文件）：

| # | 文件:行 | 规则 | 归属 |
| --- | --- | --- | --- |
| 1 | `apps/web/components/app-shell/topbar-members.tsx:62` | `Definition for rule '@next/next/no-img-element' was not found` | WEB_SHELL/TOPBAR 在途（untracked） |
| 2 | `apps/web/components/trip-workspace/photos-tab.tsx:35` | 同上（该规则未在 eslint 配置中注册，disable 注释反而报错） | WEB_TRIP_WORKSPACE（untracked，22:22） |
| 3 | `apps/web/components/trip-workspace/money.ts:19` | `no-useless-assignment` | WEB_TRIP_WORKSPACE（untracked，22:23） |
| 4 | `apps/web/components/trips/edit-trip-page.tsx:26` | `@typescript-eslint/no-unused-vars`：`reloadPending` | WEB_TRIP_WORKSPACE/TRIP_FORM（untracked，22:25） |
| 5 | `apps/web/components/trips/trip-form/currencies.ts:86` | `no-useless-assignment` | WEB_TRIP_FORM（untracked，21:30） |

- worker 的 19 条是 warnings、0 errors，不阻断（`pnpm lint` 失败只因 web 的 5 条 error）。
- 我的文件（`packages/contracts/src/entities/trip.ts`，以及上一任务 `providers.tsx`/`legacy-mock`/`__tests__`）在全仓 lint 输出中 **0 命中**。
- 其余包 lint 全部成功（`Tasks: 9 successful`，仅 web 失败）。

---

## 4. `openapi.json` 漂移：已由外部重新生成，当前 fresh ✅

- 我**未**运行 `contracts:generate`。
- 22:31:22（我的改动之后）`packages/contracts/openapi.json` 被外部（root/其他 Agent）重新生成：
  - `pattern` 已采用新形式：`A-Za-z0-9_+-` **13 处**，旧的 `A-Za-z0-9_+\-` **0 处**；
  - 路径数 94、schema 数 203。
- `pnpm --filter @roamlog/contracts contracts:check` 当前：

```
$ tsx scripts/check-openapi.ts
OpenAPI contract is fresh: 94 paths, 203 schemas.
CHECK_EXIT=0
```

→ 我的正则改动已被包含在生成物中且无残留漂移。若在重新生成前检查，会看到 13 个 `pattern` 字符串（26 处字符类）差异，
例如 `IanaTimeZone.pattern`、`CreateTripRequest.timeZone.pattern`、`Place.timeZone.pattern` 等；与生成物实测一致。

---

## 5. 重要事实：「冻结契约文件」前提不成立

`packages/contracts` 当前处于多人并行编辑状态，不是冻结的：

```
$ git status --short packages/contracts | wc -l   # 18
 M openapi.json, scripts/generate-openapi.ts, scripts/openapi/{paths-admin,paths-media,schemas}.ts
 M src/__tests__/{entities,openapi}.test.ts
 M src/api/{admin,index,media,share-links,stops,trips}.ts
 M src/entities/{audit-log,stop,trip}.ts
?? scripts/openapi/paths-places.ts, src/api/places.ts
```

`src/entities/trip.ts` 相对 HEAD 有 123 行改动（含 `IanaTimeZoneSchema` 本身），其中我的只有第 13 行。
本节两处失败（§3.2、§3.4）都源自这些在途改动，请 root 统一处理，不要归因到本次正则修复。

---

## 6. CodeGraph 证据

- `codegraph status` → `[OK] Index is up to date`（期间一次 `sync` 因其他进程持锁失败，重试后 `[OK]`）。
- 查询：

```
codegraph explore "IanaTimeZoneSchema timeZone trip.ts createOpenApiDocument"
```

关键结果：`IanaTimeZoneSchema`（`packages/contracts/src/entities/trip.ts:9`）—
11 callers，分布在 `src/entities/stop.ts`、`src/api/trips.ts`、`src/api/stops.ts`、`src/api/places.ts` 等；
测试经 `packages/contracts/src/__tests__/entities.test.ts`、`packages/api-mocks/src/__tests__/fixtures.test.ts` 覆盖。
这解释了 OpenAPI 生成物里 13 处 `pattern` 的来源（trip / stop / place 与请求体复用同一 schema）。

---

## 7. 风险 / 未覆盖 / 下一步

**风险**

1. 契约包正被并行改写，`trip.ts` 若被 owner 整体重写，我的第 13 行可能被覆盖；提交前建议再跑
   `pnpm --filter @roamlog/contracts exec eslint src/entities/trip.ts` 复核。
2. `contracts:check` 现通过，但依赖 22:31 那次外部重新生成；若之后又有新契约改动，需再次生成。

**未覆盖**

- 未跑 `contracts:generate`（按指示）。
- 未修 §3.2 的两个测试与 §3.4 的 5 条 web lint error（均不在授权范围）。
- 未跑 API/E2E 端到端（本任务只涉及字符类转义，`safeParse` + 穷举对照已覆盖语义）。

**建议下一步（按 owner 分派）**

1. API/ADMIN 契约 owner：更新 `openapi.test.ts` 的 path 计数（92 → 94，或改为断言关键 path 集合）与
   `admin.test.ts` 的 `AdminSystemSchema` 期望样本，使 `contracts test` 归零。
2. WEB_TRIP_WORKSPACE / WEB_TRIP_FORM：修 §3.4 的 4 条 web error（`money.ts:19`、`edit-trip-page.tsx:26`、
   `currencies.ts:86`）；`topbar-members.tsx:62`、`photos-tab.tsx:35` 的 `@next/next/no-img-element`
   报错建议删掉 disable 注释（该规则未在 eslint 配置注册），或由 root 在 `eslint.config.mjs` 注册 next 插件——
   二选一，不要两处都改。
3. root：上述清零后复跑 `pnpm lint`，预期只剩 worker 19 warnings，exit 0。
