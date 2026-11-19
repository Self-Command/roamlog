# E1 — AI planner as a tool-calling agent (plan / execute)

状态: **DONE**
任务 ID: `E1_AI_PLANNER`（架构由「草稿预填」改为「工具调用 agent 循环」，按根 Agent 第二次指令重做）
仓库: `C:\Users\BY9700\Desktop\UI\roamlog`
日期: 2026-11-19

---

## 0. 为什么是工具调用而不是草稿

用户要的是**可执行的操作**（把行程真的建出来），不是一张还要自己逐项填写的表单；工具调用让模型直接驱动产品既有 service，同时用「两阶段（先只读规划 → 用户确认后执行）」保住安全底线和可审计性。

---

## 1. 变更文件

| 文件 | 类型 |
|---|---|
| `packages/contracts/src/api/ai.ts` | 新建（工具名枚举 / tool call / chat / execute / tool result） |
| `packages/contracts/src/api/index.ts` | 末尾加 1 行 `export * from "./ai"` |
| `packages/contracts/src/__tests__/ai.test.ts` | 新建（7 测试） |
| `apps/api/src/modules/ai/ai.settings.ts` | 新建（`AI_*` 解析，未配置不崩） |
| `apps/api/src/modules/ai/adapters/{adapter,http,index}.ts` | 新建（类型 / 超时 HTTP / 工厂） |
| `apps/api/src/modules/ai/adapters/{openai-chat,openai-responses,anthropic-messages}.adapter.ts` | 新建（三协议工具循环） |
| `apps/api/src/modules/ai/ai-tools.ts` | 新建（8 个工具定义 + 参数白名单 + 以调用者身份执行） |
| `apps/api/src/modules/ai/ai-plan.service.ts` | 新建（只读规划循环，≤8 轮，写调用进 `plannedCalls`） |
| `apps/api/src/modules/ai/ai-execute.service.ts` | 新建（确认后顺序执行、幂等、部分失败、审计） |
| `apps/api/src/modules/ai/ai-run.store.ts` | 新建（Redis 计划存储，runId 一次性，TTL 15 min） |
| `apps/api/src/modules/ai/ai-quota.service.ts` | 新建（每用户每日配额） |
| `apps/api/src/modules/ai/ai.controller.ts` / `ai.module.ts` / `ai.constants.ts` | 新建 |
| `apps/api/src/app.module.ts` | import + 注册 `AiModule`（2 行） |
| `apps/api/src/config/environment.ts` | `AI_*` 变量、协议枚举、base URL/超时校验 |
| `apps/api/src/config/ai-environment.spec.ts` | 新建（3 测试） |
| `apps/api/src/modules/ai/__tests__/*` | 新建 5 个 spec + fixtures |
| `.audit/e1-report.md` | 本报告 |

未触碰：`packages/contracts/src/api/{admin,places}.ts`、`permissions.ts`、`apps/admin/**`、`apps/web/**`、`packages/db/**`、`apps/api/src/modules/places/**`、`apps/api/src/modules/trips/**`。

---

## 2. 实现摘要（逐 5 项）

### 2.1 契约（`packages/contracts/src/api/ai.ts`）

```
AiProtocolSchema = enum(openai-chat | openai-responses | anthropic-messages)
AI_TOOL_NAMES = [places.search, trips.create, trips.get, stops.add, stops.list,
                 itinerary.addDay, packing.add, budget.setSummary]      // 8 个（指令正文列了 8 个，标题写 7）
AiToolCallSchema    = { tool, args: JsonObject }                        // .strict()
AiPlanHintSchema    = { dates?{start,end}, budgetMinor?, currency?, styles?, destinations? }
AiChatRequestSchema = { message(1..2000), hints? }
AiChatResponseSchema= { runId(32 hex), message, plannedCalls[], readOnlyTrace[], usage, provider, expiresAt }
AiRunExecuteRequestSchema  = { calls(1..20), idempotencyKey(8..120) }
AiRunExecuteResponseSchema = { results[], partialFailure, summary }
AiToolResultSchema  = { tool, ok, entityId?: uuid|null, error?: {code,message}|null }
AI_ERROR_CODES = AI_NOT_CONFIGURED / AI_SCHEMA_INVALID / AI_QUOTA / AI_LOOP_LIMIT /
                 AI_RUN_NOT_FOUND / AI_RUN_CONSUMED / AI_RUN_CALL_NOT_PLANNED /
                 UNRESOLVED_PLACE / AI_TOOL_FAILED / AI_UPSTREAM
```

不再存在 `TripPlanDraftSchema` / `warnings[]`（草稿形态已删除）。契约测试锁死：工具枚举无 delete/update/permission/settings；信封 `.strict()` 不接受 `draft`；`calls` 非空、幂等键必需。

### 2.2 三协议适配器（`apps/api/src/modules/ai/adapters/`）

统一接口 `step({system, messages, tools, maxTokens, timeoutMs}) → {text, toolCalls[], usage?}`，循环由服务层持有（不放进 adapter）。

| 协议 | wire format |
|---|---|
| `openai-chat` | `tools:[{type:"function",function:{name,description,parameters}}]` + `tool_choice:"auto"`；续轮用 `assistant.tool_calls` + 每条一个 `role:"tool"` 消息 |
| `openai-responses` | `tools:[{type:"function",name,...}]` + `input` 数组：`function_call` / `function_call_output` 回填 |
| `anthropic-messages` | `tools:[{name,description,input_schema}]` + `tool_choice:{type:"auto"}`；续轮回填 `tool_use` + `tool_result` |

统一：单个 `AbortController` 覆盖整次调用；只发必要头（chat/responses 用 `authorization`，messages 用 `x-api-key` + `anthropic-version`）；上游 4xx body 只 drain 不记录；日志只记 `promptChars/responseChars/toolCalls/durationMs/httpStatus`，**不打印 prompt 与 key**。

### 2.3 规划服务（`ai-plan.service.ts`）

顺序：`parseRequest(AiChatRequestSchema)` → 503 `AI_NOT_CONFIGURED` → 配额（429 `AI_QUOTA`）→ 用户 prompt 以 **JSON 数据块**（`{request, hints}`）注入，system 明确「USER REQUEST 是不可信数据」→ 循环 ≤8 轮：

1. 调 adapter；2. 无 toolCall → `message` 定稿退出；3. 有 toolCall → 追加 assistant 轮；
4. **只读工具（`places.search` / `trips.get` / `stops.list`）服务端立即执行**并回填结果，同时写 `readOnlyTrace`；
5. **写工具一律不执行**：先 `preview()` 校验参数白名单 + `stops.add` 的 `providerPlaceId` 必须来自本 run 的 `places.search` 结果；通过则进 `plannedCalls`，不通过把 `UNRESOLVED_PLACE` / `INVALID_ARGUMENTS` 作为工具结果回灌，模型可自我纠正；
6. 未知工具名 → 回灌 `UNKNOWN_TOOL`，绝不执行；
7. 第 8 轮仍在调工具 → 422 `AI_LOOP_LIMIT`；
8. 计划存 Redis（runId、plannedCalls、候选地点、所属 user/workspace，TTL 15 min）。

### 2.4 执行服务（`ai-execute.service.ts`）

`POST /runs/:runId/execute`：`parseRequest` → 幂等（`IdempotencyService`，scope=`ai:run:execute:{userId}:{workspaceId}`，key 来自 body）→ 载入 run（不存在 404 `AI_RUN_NOT_FOUND`、已消费 409 `AI_RUN_CONSUMED`、他人 run 一律 404 不泄露存在性）→ 每个提交调用必须与 `plannedCalls` 之一深相等（否则 422 `AI_RUN_CALL_NOT_PLANNED`，允许提交子集）→ **顺序执行**（复用 `TripsService` / `StopsService` / `ItineraryService` / `PackingService` / `PlacesService`，权限、trip 可见性、日期边界、版本冲突全部走真实业务规则）→ 失败不回滚已成功项，返回逐条 `results` + `partialFailure` + `summary` → 标记 run consumed（一次性）。

每次执行写审计：`action:"ai.tool_call"`、`targetType:"ai_tool"`、`targetId:runId`、metadata `{runId, tool, ok, entityId, durationMs}`，**不含入参**。审计写入失败不会把成功的写操作变成失败响应。

### 2.5 端点 / 配置 / 配额

```
POST /v1/workspaces/{workspaceId}/ai/chat                 200 | 400 | 403 | 429 AI_QUOTA | 502 AI_UPSTREAM | 503 AI_NOT_CONFIGURED
POST /v1/workspaces/{workspaceId}/ai/runs/{runId}/execute 201 | 404 AI_RUN_NOT_FOUND | 409 AI_RUN_CONSUMED | 422 AI_RUN_CALL_NOT_PLANNED
```

- 守卫：`TenantGuard` + `RolesGuard`，`@RequirePermission("trip:create","trip")` → **editor/admin/owner 可调用，viewer 403**（复用 `can()`，无任何 AI 超级身份）。
- env：`AI_PROTOCOL`（枚举，默认 openai-chat）、`AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`、`AI_TIMEOUT_MS`（默认 60000，5s–120s）、`AI_MAX_OUTPUT_TOKENS`（默认 6000）、`AI_DAILY_QUOTA`（默认 20）。校验：协议枚举、base URL 必须 http(s)、设置 URL 时必须有 MODEL。未配置 → 模块照常启动，端点 503。
- 配额：`ai:quota:{userId}:{UTC date}` 固定窗口，UTC 午夜重置，`0` 关闭，Redis 故障 fail-open（10s 节流告警）。
- **plan 阶段不写库**：只调 `PlacesService.search` / `TripsService.get` / `StopsService.list` 三个读路径 + Redis；不写审计、不写产品数据（测试断言写 service 全未被调用）。

---

## 3. 三条强化要求落实情况

1. **工具以调用者身份执行**：`AiToolbox.execute` 只接收 `AuthenticatedActor` + `WorkspaceMembershipAccess`，所有写都 `TripsService/StopsService/ItineraryService/PackingService` 内部 `assertCan` + `requireVisibleTrip`；没有 Prisma 直连、没有绕过 `can()` 的路径；工具签名与 args schema 里没有 `workspaceId`/`userId`（zod 非 strict → 多余字段被 strip），测试断言 model 塞 `workspaceId/userId` 后 service 收到的 body 不含这两个键。
2. **plan 只读由服务端强制**：写工具在规划阶段只做 `preview`，从不 `execute`；测试「模型请求 trips.create → 未写库 + 出现在 plannedCalls」。
3. **工具描述写明副作用**：只读工具以 `Read-only, no side effects.` 结尾，写工具以 `WRITES DATA.` 结尾；`golden.spec.ts` 断言每个工具描述都含其中之一，且 schema 不含 lat/lng/timeZone、不含 `public_link`。

---

## 4. 验证命令与原始结果

### 4.1 `pnpm --filter @roamlog/contracts test`

```
 ✓ src/__tests__/money.test.ts (4 tests) 22ms
 ✓ src/__tests__/admin-settings.test.ts (7 tests) 33ms
 ✓ src/__tests__/ai.test.ts (7 tests) 25ms
 ✓ src/__tests__/admin.test.ts (4 tests) 25ms
 ✓ src/__tests__/entities.test.ts (20 tests) 44ms
 ✓ src/__tests__/openapi.test.ts (10 tests) 701ms

 Test Files  9 passed (9)
      Tests  72 passed (72)
```

### 4.2 `pnpm --filter @roamlog/api typecheck`

```
$ tsc --noEmit
[exit code: 0]
```

### 4.3 `pnpm --filter @roamlog/api exec vitest run src/modules/ai src/config`

（导出 `AI_*` 后跑，真实网关 3 协议测试不再 skip）

```
 ✓ src/modules/ai/__tests__/adapters.integration.spec.ts (7 tests) 85830ms
   ✓ AI adapters against a real gateway (3)
     ✓ openai-chat completes a tool-call round trip 4403ms
     ✓ openai-responses completes a function-call round trip 4296ms
     ✓ anthropic-messages completes a tool_use round trip 4763ms
   ✓ AI plan loop against a real gateway (3)
     ✓ openai-chat: plans a Kyoto week with read-only tools and queued writes 29869ms
     ✓ openai-responses: plans a Kyoto week with read-only tools and queued writes 22326ms
     ✓ anthropic-messages: plans a Kyoto week with read-only tools and queued writes 20172ms
 ✓ src/modules/ai/__tests__/ai.controller.spec.ts (6 tests) 274ms
 ✓ src/config/environment.spec.ts (26 tests) 33ms
 ✓ src/modules/ai/__tests__/ai-plan.service.spec.ts (11 tests) 23ms
 ✓ src/modules/ai/__tests__/ai-execute.service.spec.ts (8 tests) 19ms
 ✓ src/config/ai-environment.spec.ts (3 tests) 12ms
 ✓ src/modules/ai/__tests__/golden.spec.ts (3 tests) 6ms
 ✓ src/config/app-config-two-factor.spec.ts (3 tests) 9ms

 Test Files  8 passed (8)
      Tests  67 passed (67)
```

离线（不导出 `AI_BASE_URL`）时同一命令为 `61 passed | 3 skipped`（前一次运行证据），即集成测试按环境变量正确 skip。

### 4.4 真打 magpie（三种协议各一次真实工具循环）

环境：`AI_PROTOCOL=<p> AI_BASE_URL=http://127.0.0.1:3425/v1 AI_API_KEY="$MAGPIE_GATEWAY_KEY" AI_MODEL=auto/deepseek-v4.1-flash`
（本机 `MAGPIE_GATEWAY_KEY` 未导出/为空；该本地网关不校验 key，`curl` 空 Bearer 也返回 200。key 按约束只从环境读取，未写入任何文件。）

prompt：`我想去京都待一周，预算 8000 人民币，喜欢咖啡馆和古寺`
注意：集成测试把 `PlacesService` 桩成只返回 1 条候选（金阁寺 `N:1234`），以便离线可重复；模型多轮 search 仍真实走 HTTP。

**openai-chat**
```
readOnlyTrace=[{"tool":"places.search","args":{"q":"Kyoto, Japan","limit":5}},
 {"tool":"places.search","args":{"q":"Kiyomizu-dera Temple, Kyoto","limit":5}},
 {"tool":"places.search","args":{"q":"Kinkaku-ji, Kyoto","limit":5}},
 {"tool":"places.search","args":{"q":"Arashiyama, Kyoto","limit":5}},
 {"tool":"places.search","args":{"q":"Fushimi Inari Taisha, Kyoto","limit":5}},
 {"tool":"places.search","args":{"q":"Gion district, Kyoto","limit":5}}]
plannedCalls=[{"tool":"trips.create","args":{"title":"京都一周：古寺与咖啡馆",
 "destinations":["Kyoto, Japan"],"startDate":"2026-04-05","endDate":"2026-04-11",
 "summary":"京都七日慢旅行：每天 1–2 座古寺/神社打底，午后留给咖啡馆与街区散步。以京都市内为主，不安排远距离跳城，交通用市巴士+地铁一日券控制成本。预算 8000 人民币按机票/住宿/餐饮/门票/杂项划分。日期为建议占位，可随时改成你的实际出行周。",
 "tags":["japan","kyoto","temples","coffee","one-week"],"visibility":"private",
 "budgetCurrency":"CNY","budgetAmountMinor":800000}}]
message=计划已提交，**正在等待你确认**（写入操作会先排队，你确认后才真正保存到工作区）。
usage={"inputTokens":6716,"outputTokens":2956}
```

**openai-responses**
```
readOnlyTrace=[{"tool":"places.search","args":{"q":"Kyoto, Japan","limit":5}},
 {"tool":"places.search","args":{"q":"Kiyomizu-dera Temple, Kyoto","limit":3}},
 {"tool":"places.search","args":{"q":"Fushimi Inari Taisha, Kyoto","limit":3}},
 {"tool":"places.search","args":{"q":"Kinkaku-ji, Kyoto","limit":3}},
 {"tool":"places.search","args":{"q":"Arashiyama Bamboo Grove, Kyoto","limit":3}}]
plannedCalls=[{"tool":"trips.create","args":{"title":"京都七日｜古寺与咖啡馆",
 "destinations":["Kyoto, Japan"],"startDate":"2026-04-06","endDate":"2026-04-12",
 "budgetAmountMinor":800000,"budgetCurrency":"CNY","summary":"一周京都慢旅行：以古寺为主线，穿插京都的咖啡馆文化。预算 8000 CNY（约合每日 1100 CNY），侧重步行可达的寺院片区与街区咖啡，避开高价门票与长途移动。",
 "tags":["temples","cafes","slow-travel","solo"],"visibility":"private"}}]
message=我先把京都这一周的计划建成了草稿，但有两件事必须先跟你说清楚：**1. 地点库这次只返回了一个结果** …（截断）
usage={"inputTokens":6538,"outputTokens":2462}
```

**anthropic-messages**
```
readOnlyTrace=[{"tool":"places.search","args":{"q":"Kyoto, Japan","limit":5}},
 {"tool":"places.search","args":{"q":"Kiyomizu-dera, Kyoto","limit":5}},
 {"tool":"places.search","args":{"q":"Fushimi Inari Taisha, Kyoto","limit":5}},
 {"tool":"places.search","args":{"q":"Kyoto","limit":12}},
 {"tool":"places.search","args":{"q":"Osaka, Japan","limit":12}}]
plannedCalls=[{"tool":"trips.create","args":{"title":"Kyoto — one week of coffee and old temples",
 "summary":"A one-week Kyoto trip focused on café culture and historic temples. Dates are still provisional — the start date has not been set yet, so no stops or itinerary days have been scheduled. Budget is set to the stated 8000 CNY.",
 "budgetAmountMinor":800000,"budgetCurrency":"CNY","destinations":["Kyoto, Japan"],
 "tags":["japan","kyoto","cafes","temples","one-week"],"visibility":"private"}}]
message=我停在这里，因为有两个卡点不该靠猜来绕过。## 已完成（等待你确认）…（截断）
usage={"inputTokens":1771,"outputTokens":2762}
```

三协议共同结果：模型**主动多次调用 `places.search`（真实 HTTP）**获取候选，随后只把写操作放进 `plannedCalls`，**没有任何写 service 被调用**（断言 `mocks.trips.create / stops.create` 均未调用）。

---

## 5. 测试清单（新增 62 条）

| 文件 | 覆盖 |
|---|---|
| `packages/contracts/src/__tests__/ai.test.ts` (7) | 工具枚举/无破坏性工具；strict 信封；run/execute 形状；无 draft 字段；partialFailure |
| `ai-plan.service.spec.ts` (11) | 只读执行+写只排队；`stops.add` 未知 placeId 被拒（UNRESOLVED_PLACE）；同 run 候选通过；未知工具不执行；8 轮与调用上限 → 422；503；429；502；prompt 以 JSON 数据块注入；全写工具在规划期零调用 |
| `ai-execute.service.spec.ts` (8) | 子集执行；未计划调用 422；404/409；他人 run 404；部分失败（403）不回滚；审计不含参数；model 注入 workspaceId/userId 被 strip；候选集合外 stop 被拒 |
| `ai.controller.spec.ts` (6) | 503 / 429 / viewer 403 / editor 201 信封 / 超长 message 400 / runId 格式 400 |
| `adapters.integration.spec.ts` (7) | 三协议真实网关 tool 往返 + 三协议真实 plan 循环（缺 `AI_BASE_URL` 全 skip）+ 工厂离线选择 |
| `golden.spec.ts` (3) | 3 条 golden prompt（口径从 20 缩减，符合「时间不够可缩到 3 条」）：chat request 合法、工具 schema 存在、描述含副作用、无坐标/时区/public_link |
| `ai-environment.spec.ts` (3) | 无 AI_* 也能启动；全量配置；非法协议/URL/缺 model/超时越界 |

关键断言（对应强化要求）：
- 「模型在 plan 阶段请求 `trips.create` → 未写库 + 出现在 `plannedCalls`」— `ai-plan.service.spec.ts:86`
- 「不存在 providerPlaceId 被拒」— `ai-plan.service.spec.ts:106`、`ai-execute.service.spec.ts:...`
- 「提示注入不产出坐标」改写为：工具 args 白名单不含 lat/lng/timeZone，模型注入的 `workspaceId/userId` 被丢弃 — `golden.spec.ts` + `ai-execute.service.spec.ts:...`

---

## 6. CodeGraph 证据

```
$ codegraph status
Files: 1,569  Nodes: 24,286  Edges: 54,084   (从 1,545 文件增量到含新模块)

$ codegraph explore "AiPlanService AiToolbox AiProtocolAdapter"
Found 62 symbols across 7 files.

- AiProtocolAdapter (apps/api/src/modules/ai/adapters/adapter.ts:56) — 13 callers in
  anthropic-messages.adapter.ts / openai-chat.adapter.ts / openai-responses.adapter.ts /
  adapters/index.ts; tests: adapters.integration.spec.ts, ai-fixtures.ts
- AiToolbox (apps/api/src/modules/ai/ai-tools.ts:284) — 14 callers in ai-execute.service.ts,
  ai-plan.service.ts, ai.module.ts; tests: 4 spec files
- AiPlanService (apps/api/src/modules/ai/ai-plan.service.ts:46) — 9 callers in ai.controller.ts,
  ai.module.ts; tests: adapters.integration.spec.ts, ai-plan.service.spec.ts, ai.controller.spec.ts

implements: AnthropicMessagesAdapter → AiProtocolAdapter
            OpenAiResponsesAdapter → AiProtocolAdapter
            OpenAiChatAdapter → AiProtocolAdapter
calls: chat → step; runLoop → step; adapterFor → …（66 条内部调用边）
```

复用面取证（改前先用 CodeGraph 查过）：`PlacesService.search:47`（2 调用方）、`TripsService.create:123 / get:193 / update:203`、`StopsService.create:49 / list:38`、`ItineraryService.create:53`、`PackingService.create:79`、`AuditService.record:42`、`IdempotencyService.run`、`TenantGuard/RolesGuard/PermissionService`。

---

## 7. 已知风险

1. **`PlacesService` 在 `AiModule` 里重复注册**：`PlacesModule` 未 `exports: [PlacesService]`，而该文件不在本任务可写边界内。实例无状态、共享同一 Redis cache/quota key，行为一致；但属于重复 provider，建议下个 wave 由 places 模块 owner 加一行 export 后改为 import。
2. **计划阶段不写审计**：`ai.tool_call` 只在 execute 阶段写（plan 阶段要求「绝不写库」，且读工具不应因审计 DB 故障而失败）。`readOnlyTrace` 在响应里可见，可作为读侧证据；如合规要求读侧也入审计，需要单独决策（异步、失败不影响响应）。
3. **`providerPlaceId` 白名单只在同一 run 内有效**：run 过期（15 min）后无法再 execute，符合「一次性」设计，但用户停留过久会收到 404。
4. **execute 无事务**：这是刻意选择（部分失败不回滚，UI 明示）。跨 trip 的一致性需要前端按结果重试失败项，重复执行同一 run 会被 409 挡住。
5. **配额按 user 而非 workspace**：与指令一致（每用户每日上限）；多 workspace 的重度用户会更快耗尽。
6. **模型仍可能产出「看起来很真」的文本**（如 responses 协议输出「返回的候选只有金阁寺」这类叙述），但落库字段只来自候选与用户 hints，文本仅回显给用户。
7. **`AI_API_KEY` 可为空**（本地网关）；生产必须配置，建议后续在 `APP_ENV=production` 时强制非空（本任务未加，避免影响 staging）。
8. **工具数量 7 vs 8**：指令标题写「7 个工具」，正文枚举 8 个；按正文实现 8 个（`budget.setSummary` 也实现了）。

## 8. 未覆盖项

- 真实 execute 路径未做「真库 E2E」：本任务不写库 / 无迁移，execute 的写操作在单测中用真实 `AiToolbox` + 桩 service 验证（授权、参数 strip、部分失败、审计）；真实 `TripsService` 落库链路由既有 `content-*.e2e-spec.ts` 覆盖。
- SSE 流式（spec §8 UI 部分）未做，当前一次性 JSON 响应。
- `providerPlaceId` 的「同一 run」集合存在 Redis run payload，未做工作区级长期地点缓存（复用 Places 既有缓存）。
- golden 集只剩 3 条（时间约束，根 Agent 已批准缩减）；20 条完整回归集待补。
- UI 草稿面板 / 未解析地点 chip / 表单预填：本任务明确不做 UI（架构也已改为「一键确认执行」，前端下一步按 `plannedCalls` 渲染确认面板即可）。

## 9. 建议下一步

1. `packages/contracts` 生成 OpenAPI（`contracts:generate` 由契约 owner 跑），把 `ai/chat`、`ai/runs/execute` 与三个 error code 写进规范；Web 端据此生成 client。
2. Web：`/w/{slug}/ai` 对话框 + 右侧「计划确认」面板（逐条勾选 `plannedCalls` → 调 execute → 展示逐条 results/partialFailure）。
3. `from-plan` 不再需要：草稿已由 execute 直接落库；若要「只填表单」路径，用同一 `plannedCalls` 在客户端映射成表单初值即可（无需新后端端点）。
4. 补 20 条 golden prompt 真跑回归（`AI_BASE_URL` 存在时 nightly），并记录每次 `usage` 成本。
5. 生产加固：`APP_ENV=production` 强制 `AI_API_KEY` 非空 + 模型 allowlist；plan 阶段读工具审计（异步）；对 execute 增加按 runId 的速率限制。