# AI_SETTINGS_WIRED — `ai.*` 接线 + 禁止过去日期

状态: **DONE**
任务 ID: `AI_SETTINGS_WIRED`（backend_api + admin 标签）
仓库: `C:\Users\BY9700\Desktop\UI\roamlog` · 日期 2026-11-19

---

## 1. 变更文件

### Commit 1 — api（含 1 处 additive 契约）

```
apps/api/src/modules/ai/ai.settings.ts          # AiSettingsResolver + 四键合并 + 优先级/回落/节流 warn
apps/api/src/modules/ai/ai-dates.ts             # 新增：今天/时区/日期比较/容忍 1 天
apps/api/src/modules/ai/ai-plan.service.ts      # 每请求解析设置 + 选 adapter + prompt 注入今天 + PAST_DATE 门禁
apps/api/src/modules/ai/ai-quota.service.ts     # 每日上限改读 resolver（ai.dailyQuota）
apps/api/src/modules/ai/ai.module.ts            # SettingsModule + AI_SETTINGS_SOURCE / AI_ADAPTER_FACTORY / AI_CLOCK
apps/api/src/modules/ai/adapters/index.ts       # 每请求 adapter 工厂（不再单例快照）
apps/api/src/modules/ai/__tests__/ai-dates.spec.ts        (new, 5)
apps/api/src/modules/ai/__tests__/ai-settings.spec.ts     (new, 9)
apps/api/src/modules/ai/__tests__/ai-quota.service.spec.ts(new, 4)
apps/api/src/modules/ai/__tests__/ai-plan.service.spec.ts (+7 → 18)
apps/api/src/modules/ai/__tests__/ai.controller.spec.ts   (DI 更新，仍 6)
apps/api/src/modules/ai/__tests__/ai-fixtures.ts          (fixedClock / FIXED_NOW)
apps/api/src/modules/ai/__tests__/adapters.integration.spec.ts (构造器更新)
packages/contracts/src/api/ai.ts                # additive: 可选 warnings[]（见 §5）
```

### Commit 2 — admin

```
apps/admin/lib/admin-settings.ts                              # ai → backend
apps/admin/components/settings/settings-consumption.ts        # ai 四键字段级 backend
apps/admin/components/settings/admin-settings.test.ts         # +2 断言（ai backend / 无“不生效”）
apps/admin/components/settings/settings-console.test.tsx      # +1 ai 组渲染测试（29 tests）
```

> **并行提交冲突（须知悉）**：上面 4 个 admin 文件里，前 3 个被并行 Agent 的 `git add -A` 扫进了它自己的提交 `a83c06c feat(limits): drive the search rate limit from the admin settings`（该提交 `--stat` 明确含这 3 个文件、58 insertions，`git show a83c06c:...` 可验证 ai 标签已在其中）；本任务第 2 个提交 `fa554df` 因此只含 `settings-console.test.tsx`。内容正确、历史归属错位，无重复改动。

未触碰：`settings.service.ts`、`settings.registry.ts`、`modules/{reports,storage,email,health,metrics}/**`、`bootstrap/**`、`apps/web/**`、`packages/**` 的其他文件。**唯一例外**是 `packages/contracts/src/api/ai.ts`：任务 B 明确要求给 `AiChatResponse` 增加可选 `warnings`，该类型只存在于该文件（见 §5）。

---

## 2. 实现摘要

### A. `ai.*` 真正驱动 AI 模块

- 新增 `AiSettingsResolver`（仿 `PlacesSettingsResolver`）：每请求 `SettingsService.getGroup("ai")`；**envLocked → env，其余 DB > env > 代码默认**；DB 异常/空值/非法值回落 env → 默认，`ai.settings_fallback_env` / `ai.setting_value_ignored` 10s 节流，构造器不读 DB，不阻塞启动。
- 键映射：`ai.defaultProvider → protocol`（仅接受 `openai-chat|openai-responses|anthropic-messages`，其它值忽略并 warn）、`ai.timeoutMs → timeoutMs`、`ai.maxOutputTokens → maxOutputTokens`、`ai.dailyQuota → AiQuotaService 的每日上限`。
- 行为接线：`AiPlanService` 每请求 `resolve()` → `AI_ADAPTER_FACTORY(settings)` 建 adapter → `step({timeoutMs, maxTokens})`；`AiQuotaService.consume()` 每请求解析 `dailyQuota`。模块不再有启动期 `AiSettings`/`AiAdapter` 单例。
- **不静默换 provider**：选中的 protocol 若没有可用上游（`configured=false` 或工厂返回 undefined）→ 明确 `503 AI_NOT_CONFIGURED`，并 warn `ai.not_configured`（带 protocol）。

### B. 禁止过去日期（两层）

1. **提示层**：`systemPrompt(today, tz)` 每请求渲染，注入
   `Today is {today} ({tz}). Every date you propose must be on or after {today}; never propose a past date.`
   与「用户没给年份/给了过去年份 → 取最近的未来日期并说明」。
2. **校验层**（不依赖模型）：`trips.create.startDate/endDate`、`stops.add.startDate/endDate`、`itinerary.addDay.date` 早于`今天 - 1 天`（时区容忍）→ 首次回灌 `INVALID_ARGUMENTS` 并**只重试 1 轮**；重试后仍过去 → 调用**不进入 plannedCalls**，返回 `warnings:[{code:"PAST_DATE", message:"计划日期早于今天，已忽略该调用", subject:"trips.create"}]`；若该轮只剩被拒调用则提前收敛（不再烧模型轮次），message 给出可读兜底。
- 日期比较全部是 `YYYY-MM-DD` 字符串比较 + `shiftDateOnly`，不做 UTC/本地偏移运算。

### C. 标签

- `SETTINGS_CONSUMPTION.ai = { status: "backend", label: "后端已消费（AiModule 运行期读取）" }`。
- `SETTING_FIELD_CONSUMPTION` 增加 `ai.defaultProvider/timeoutMs/maxOutputTokens/dailyQuota` 四键 = `backend`（字段级逐键，非笼统组标签）。`mail/storage/limits` 仍 `unwired`。

---

## 3. 验证命令与结果（原始输出，已脱敏）

### 3.1 `pnpm --filter @roamlog/api typecheck`

被并行文件污染（media / reports / share-links / trips presenters），本任务范围 0 错误：

```
$ pnpm --filter @roamlog/api typecheck
src/modules/media/media.presenter.ts(81,22): error TS2551 ...
src/modules/reports/__tests__/admin-reports.service.spec.ts(201,12): error TS18046 ...
src/modules/share-links/share-links.service.ts(292,17): error TS2304 ...
src/modules/trips/content-presenters.ts(108,25): error TS2339 ...

$ pnpm --filter @roamlog/api exec tsc --noEmit 2>&1 | grep -c "modules/ai"
0
```

### 3.2 `pnpm --filter @roamlog/api exec vitest run src/modules/ai src/modules/settings`

```
 ✓ src/modules/settings/__tests__/admin-settings.controller.spec.ts (12 tests) 423ms
 ✓ src/modules/ai/__tests__/ai.controller.spec.ts (6 tests) 311ms
 ✓ src/modules/ai/__tests__/ai-execute.service.spec.ts (8 tests) 25ms
 ✓ src/modules/ai/__tests__/ai-plan.service.spec.ts (18 tests) 62ms
 ✓ src/modules/ai/__tests__/ai-dates.spec.ts (5 tests) 36ms
 ✓ src/modules/ai/__tests__/ai-stops-add.spec.ts (2 tests) 20ms
 ✓ src/modules/ai/__tests__/ai-quota.service.spec.ts (4 tests) 31ms
 ✓ src/modules/ai/__tests__/ai-settings.spec.ts (9 tests) 14ms
 ✓ src/modules/ai/__tests__/golden.spec.ts (3 tests) 7ms
 ✓ src/modules/ai/__tests__/adapters.integration.spec.ts (7 tests | 6 skipped) 5ms
 Test Files  15 passed (15)
      Tests  133 passed | 6 skipped (139)
```
（6 skipped = 需要 `AI_BASE_URL` 的真实网关用例，按环境变量正确 skip。）

### 3.3 Admin

```
$ pnpm --filter @roamlog/admin typecheck
$ tsc --noEmit            # exit 0

$ pnpm --filter @roamlog/admin exec vitest run components/settings
 ✓ components/settings/admin-settings.test.ts (11 tests) 16ms
 ✓ components/settings/settings-console.test.tsx (18 tests) 1838ms
 Test Files  2 passed (2)
      Tests  29 passed (29)
```

### 3.4 真实 API（4225，本地 PG 55444 + redis stub 46380 + magpie 3425）

独立 API：`API_PORT=4225`、`ROAMLOG_ENV_FILE` 指向临时 env（`REDIS_URL=redis://127.0.0.1:46380`、`REDIS_PREFIX=ai-wired-probe`）、`AI_BASE_URL=http://127.0.0.1:3425/v1`、key 只从 `MAGPIE_GATEWAY_KEY` 读（本机为空，未写入任何文件）。临时 super_admin 账号仅存在于本地 DB。

**quota（`PATCH ai.dailyQuota=1` 后两次 chat）**

```
GET /v1/admin/settings/ai.dailyQuota -> 200 {"value":1}
POST /ai/chat -> 201 in 20.649189s
POST /ai/chat -> 429 in 0.042588s
{"type":"https://roamlog.app/errors/ai-quota",...,"code":"AI_QUOTA"}
redis: GET ai-wired-probe:ai:quota:<uid>:2026-11-19 => "2"
PATCH ai.dailyQuota=20 -> 200 {"value":20}
```

**提示层（magpie 真模型，prompt 要求 2020）**：模型主动把日期顺延到最近的未来同月日，并明确写到服务端会拒绝过去日期：

```
plannedCalls=[{"tool":"trips.create","args":{"title":"京都七日 · 2027 春",
 "startDate":"2027-04-05","endDate":"2027-04-11",...}}]
message=「…2020-04-05 至 2020-04-11 已经过去了，服务端会直接拒绝任何过去日期的行程…取了同一个日历区间最近的一次未来日期：2027-04-05 至 2027-04-11」
```

**校验层 E2E（4226，同一真实 API，只把 `AI_BASE_URL` 换成始终返回 2020 日期的本地 OpenAI 兼容桩，以排除模型自觉）**

```
POST /ai/chat -> 201 in 0.183s
plannedCalls: []
warnings: [{"code":"PAST_DATE","message":"计划日期早于今天，已忽略该调用","subject":"trips.create"}]
message: "No action was queued: the requested dates are earlier than today (2026-11-19). Ask for dates on or after 2026-11-19."
DB before/after: Kyoto trips = 0 / 0
```

（桩模型第 1 轮返回 2020-04-05、第 2 轮返回 2020-05-01 → 恰好「重试 1 次」后仍被拒；单测另行断言 adapter 只被调用 2 次。）

验证后 4225/4226、桩模型均已停止；`ai.dailyQuota` 已恢复 20。

---

## 4. CodeGraph 证据

```
$ cd roamlog && codegraph status
Files: 1,688  Nodes: 26,376  Edges: 59,860

codegraph_explore "AiPlanService AiQuotaService AI_SETTINGS ai.settings adapters adapterFor"
Found 76 symbols across 8 files.
- AI_SETTINGS (ai.settings.ts:10) — 4 callers: ai-plan.service.ts, ai-quota.service.ts, ai.module.ts
- adapterFor (adapters/index.ts:22) — tests: adapters.integration.spec.ts
- AiPlanService (ai-plan.service.ts:46) — 9 callers in ai.controller.ts, ai.module.ts; 3 spec files
- implements: AnthropicMessagesAdapter / OpenAiResponsesAdapter / OpenAiChatAdapter → AiProtocolAdapter
- calls: chat → step, runLoop → step, consume → resolve
```
结论：`AI_SETTINGS` 只有 4 个消费者（plan/quota/module/tests），全部改为按请求解析；没有遗漏的运行期读取点。

---

## 5. 是否需要重生成契约：**是**

- 原因：`AiChatResponse` 新增**可选** `warnings: [{code, message, subject}]`（`packages/contracts/src/api/ai.ts`，`.strict()` 下 additive）。`packages/api-client` 的生成代码与 `packages/contracts/openapi.json` 尚未重生成，需要契约 owner 跑 `contracts:generate` 并通知 web/admin 消费方（web 目前用 strict schema 复检响应，但不带该字段时仍合法）。
- 未重生成的原因：`packages/**` 是并行边界，`openapi.json`/api-client 属契约 owner。

---

## 6. 已知风险

1. **每次请求解析 + 生产 adapter**：依赖 `SettingsService` 的 5s 进程缓存；切 protocol 立即生效，但每次请求都会新建 adapter 对象（无状态，可忽略）。
2. **baseUrl/apiKey/model 仍只来自 env**：registry 没有对应键；若某 provider 需要不同的网关地址，当前单 `AI_BASE_URL` 无法表达——选中不可用协议时按要求 503，不静默换源。
3. **`ai.defaultProvider` 语义收窄为协议枚举**：registry 说 “provider id”，但运行时只能驱动三种协议；存 `gemini`/`openai` 会被忽略并 warn。若产品要真正的多厂商 provider id，需要新增 provider 注册表（超出本任务）。
4. **过去日期容忍 1 天**：昨天仍可入计划（时区容忍）；严格“≥ 今天”需要产品确认是否接受跨时区误拒。
5. **契约未重生成**：生成客户端暂时看不到 `warnings`（运行时仍安全，因为字段可选）。合并后需重生成。
6. **并行污染**：`apps/api` 全量 typecheck 当前红（media/reports/share-links/trips），与本任务无关；`packages/contracts` 期间一度被 media 改动打断测试（已恢复）。

## 7. 未覆盖项

- `ai.dailyQuota` 的真实 E2E 只验证了“1 → 第二次 429”和“改回 20”；未验证跨 UTC 午夜重置（单测覆盖 retryAfterSeconds/固定窗口）。
- 真实模型下 `ai.defaultProvider` 切换三种协议的 live E2E 未逐一跑（单测断言工厂收到解析后的 protocol；E1 已对三协议做过真实网关回归）。
- Web 端尚未展示 `warnings`（字段可选，当前不会破坏；建议下个 wave 在计划面板加“已忽略”提示）。

## 8. 建议下一步

1. 契约 owner 重生成 OpenAPI/api-client，并把 `warnings` 写进规范。
2. Web 计划面板渲染 `warnings`（例如“有 1 条调用因日期过早被忽略”）。
3. 评估是否把 `AI_BASE_URL/API_KEY/MODEL` 也纳入 settings（需新键 + secret 加密），以支持真正的多 provider。