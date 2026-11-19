# E2 — Web AI 旅行助手（plan → 逐条确认 → execute）

状态: **DONE**（定向与仓库级验证全部通过：typecheck / 全量 test / lint / build 均为 exit 0，真实 plan 联调通过）
任务 ID: `E2_AI_CHAT_UI`
仓库: `C:\Users\BY9700\Desktop\UI\roamlog`
日期: 2026-11-19

---

## 0. 这个页面是什么

`/w/{slug}/ai` 是**真实**的两阶段 AI 助手，不是演示聊天框：

1. 用户发一句话 → `POST /v1/workspaces/{id}/ai/chat`。服务端只跑只读工具（`places.search` 等），返回 `{ runId, message, plannedCalls, readOnlyTrace }`。**此阶段不写库。**
2. 页面把 `plannedCalls` 逐条渲染成可勾选的操作（默认全选），显示「将写入数据」徽标和人类可读摘要。
3. 用户点「执行选中的 N 项操作」→ 二次确认 Dialog → 只有确认后才调用 `POST .../ai/runs/{runId}/execute`，把子集 + 同一 `idempotencyKey` 发给服务端。
4. 逐条展示成功/失败；`partialFailure` 顶部提示「部分成功，请检查」。

页面在任何 plan 阶段都不会显示「已创建 / 已保存」；计划面板的「执行」是计划生成后唯一的白色 primary。

---

## 1. 变更文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `apps/web/lib/api/ai.ts` | 新建 | `createAiPlan` / `executeAiRun` / `AiRequestError` / 错误分类 / `createAiIdempotencyKey` |
| `apps/web/lib/api/ai.test.ts` | 新建 | 16 条数据层测试（路径、请求体、契约校验、6 类错误码、网络失败、幂等键） |
| `apps/web/components/ai/copy.ts` | 新建 | 工具名 → 人类动作、参数摘要、trace 摘要、错误码文案、后台链接 |
| `apps/web/components/ai/ai-console.tsx` | 新建 | 聊天流、输入、状态机、确认 Dialog、`aria-live` |
| `apps/web/components/ai/plan-panel.tsx` | 新建 | 右侧计划面板、复选框、写入徽标、执行结果、独立滚动 |
| `apps/web/components/ai/ai-assistant.tsx` | 新建 | `useWorkspaceBySlug` 解析 workspace + 角色门禁外壳 |
| `apps/web/components/ai/ai-console.test.tsx` | 新建 | 17 条 UI 测试（plan 只读、取消勾选、结果、partialFailure、错误码、Dialog、幂等重试、单一 primary） |
| `apps/web/app/(app)/w/[workspaceSlug]/ai/page.tsx` | 新建 | 路由入口（server component + metadata「AI 助手」） |
| `apps/web/components/app-shell/app-shell-nav.ts` | 修改 | `Sparkles` + 「AI 助手」放入 WORKSPACE 组末尾；面包屑加 `ai: "AI 助手"` |
| `.audit/e2-report.md` | 新建 | 本报告 |

未触碰：`apps/api/**`、`packages/db/**`、`packages/contracts/**`、`apps/web/components/{trip-workspace,trips/trip-form,media}/**`、`apps/web/lib/{settings,image}/**`、其他页面/组件/测试。

---

## 2. 实现摘要（对应 5 项要求）

### 2.1 数据层 `lib/api/ai.ts`

```ts
createAiPlan(workspaceId, { message, hints? }): Promise<AiChatResponse>
executeAiRun(workspaceId, runId, { calls, idempotencyKey }): Promise<AiRunExecuteResponse>
```

- 相对路径 `/v1/...`（走 `next.config.ts` 的 rewrite），`credentials: "include"`，响应必须通过
  `AiChatResponseSchema` / `AiRunExecuteResponseSchema` 复检，否则 `INVALID_RESPONSE`。
- 错误分类 `AiFailureKind`：`not_configured` / `quota` / `loop_limit` / `upstream` /
  `schema_invalid` / `run_not_found` / `run_consumed` / `call_not_planned` / `forbidden` /
  `unauthorized` / `invalid_request` / `invalid_response` / `network` / `unknown`。
  优先按 problem `code`，其次按 HTTP status（`429/502/503/401/403/404`），网络异常 → `network`。
  覆盖任务要求的 6 个码：`AI_NOT_CONFIGURED`(503)、`AI_QUOTA`(429)、`AI_LOOP_LIMIT`(422)、
  `AI_RUN_CONSUMED`(409)、`AI_RUN_CALL_NOT_PLANNED`(422)、`AI_UPSTREAM`(502)。
- `createAiIdempotencyKey()` 用 `crypto.randomUUID()`，无 `randomUUID` 时退回
  `crypto.getRandomValues` / 32 位 hex，满足契约 8–120 字符。
- 同一计划只在 plan 成功时生成一次 key；重试执行复用同一个 state key（有单测断言）。

### 2.2 页面 `/w/{slug}/ai`

- **输入**：多行 `Textarea` + 发送按钮，placeholder 为真实示例「想去京都一周，预算 8000，喜欢古寺和咖啡馆」；首屏另有 3 条可点击的示例提示（只填入输入框，不自动发送）。
- **提交后**：显示用户消息和助手回复（模型 markdown 经轻量渲染：标题/列表/编号/小表格，不用 `dangerouslySetInnerHTML`）；`readOnlyTrace` 折叠为「已搜索：Kyoto / Kiyomizu-dera …（共 N 次查询）」，展开后逐条显示查询词；右侧渲染 `plannedCalls`。
- **计划面板**：工具名映射为动作（`trips.create` → 创建旅行、`stops.add` → 添加行程节点、`itinerary.addDay` → 添加一天日程、`packing.add` → 添加装备、`budget.setSummary` → 设置旅行预算）；摘要只显示标题/日期/目的地/预算/条目数，不渲染原始参数对象；复选框默认全选；写工具显示「将写入数据」徽标（只读工具显示「只读」）。
- **确认执行**：按钮「执行选中的 N 项操作」→ Dialog 列出勾选操作的人类摘要 + 「不会自动撤销」→ 确认后才调 execute；计划阶段不存在任何 execute 路径（单测断言）。
- **执行结果**：顶部成功/失败/`partialFailure` 横幅；逐条「已保存 / 未保存」+ 失败原因的人类文案（错误码不裸奔）；`trips.create` 成功且有 `entityId` 时给 `/w/{slug}/trips/{id}` 链接。
- **空/错/加载**：未开始显示真实空状态；plan 中显示 skeleton + 「正在搜索地点…」；`AI_NOT_CONFIGURED` 显示「AI 尚未配置」+「打开后台系统设置」链接；quota / loop_limit / upstream / network / 过期 / 已消费 / 未计划调用各有明确中文文案，且都说明是否写入了内容。
- **权限**：viewer 不渲染可用输入（disabled + 说明），服务端 403 仍是最终权威。
- **不写库**：plan 阶段 UI 文案是「待确认」「将写入数据」「还没有计划」，不存在「已创建」；结果区是唯一出现「已保存」的地方，并且只在 execute 响应后渲染。

### 2.3 视觉与可达性

- 真黑画布（`bg-canvas`）、衬线页面标题 48px（`titleSize="trip"`）、mono eyebrow/meta、hairline 分隔、`rounded-card` 容器；页面首屏是真实可操作的对话/计划面板。
- **每屏最多一个白色 primary**：无计划时「发送」为 `primary`、「执行」不存在；有计划后「发送」降为 ghost/disabled，「执行」为唯一 primary；Dialog 打开时 confirm 是唯一可见 primary。
- **键盘**：Enter 发送、Shift+Enter 换行（并检查 `isComposing`，中文输入法确认不会误发送）；Radix Checkbox 可 Tab；Radix Dialog 自带焦点陷阱与 Esc/关闭按钮。
- **aria-live**：`role="status" aria-live="polite"` 播报「计划已生成，共 N 项操作待确认。」/「执行完成，N 项操作已保存。」；错误也会播报。
- **reduced motion**：只有装饰性 skeleton/spinner/chevron transition，无 JS 动画、无状态依赖动画；全局 `prefers-reduced-motion` CSS 生效。
- **响应式**：1440 左对话 + 右侧 420px 计划面板；820 与 390 上下堆叠；三档实测 `scrollWidth === clientWidth`（见 §3）。计划面板 `lg:sticky lg:top-24 lg:max-h-[calc(100dvh-8rem)]`，内部 `overflow-y-auto` 独立滚动。

### 2.4 导航

`app-shell-nav.ts` 在 WORKSPACE 组（洞察之后）新增：

```ts
{ href: `${workspaceRoot}/ai`, label: "AI 助手", icon: Sparkles, active: isSectionActive("/ai") }
```

并给 `futureLabels` 加 `ai: "AI 助手"` 作为面包屑。文件未被其他 Agent 占用（编辑前 `git diff` 为空），因此直接写入，无需 patch。真实页面顶栏已显示「验收工作区 / AI 助手」，侧栏「AI 助手」高亮。

### 2.5 测试（33 条，全部通过）

`apps/web/lib/api/ai.test.ts`（16）：
- plan 请求路径/方法/credentials/body；hints 原样透传；契约不匹配 → `INVALID_RESPONSE`；非 JSON 成功响应；网络 TypeError → `network`；
- execute 路径/body（calls + idempotencyKey）；
- 6 个错误码分类 + 无 code 时按状态回退；run consumed / call not planned；
- 幂等键长度和唯一性。

`apps/web/components/ai/ai-console.test.tsx`（17）：
- plan 成功渲染 plannedCalls / 写入徽标 / trace 摘要 / 执行按钮 / `role=status` 播报；**断言 `executeAiRun` 从未被调用**；页面文本不含 `AI_TOOL_FAILED`/`plannedCalls`/`JSON`/`schema`/`trips.create`/`WRITES DATA`；
- 取消勾选后 execute 的 `calls` 不含该条；
- execute 成功逐条「已保存」+ 新建旅行链接；
- `partialFailure` 顶部「部分成功，请检查」+ 失败原因中文；
- 未确认 Dialog 前不调 execute，取消后仍不调；
- 执行失败（网络）重试复用同一个 `idempotencyKey`；
- 每个阶段（无计划 / 有计划）只有一个 `button.bg-ink`（白色 primary）；
- 4 个 plan 错误码文案（`AI_NOT_CONFIGURED` / `AI_QUOTA` / `AI_LOOP_LIMIT` / `AI_UPSTREAM`），`AI_NOT_CONFIGURED` 后台链接；
- run 已消费不可再执行；viewer 不提供可用输入。

---

## 3. 真实联调（真实 API + 真实模型）

现有 `:3000` Web 的 API `:4000` 没有 AI 配置（实测 `503 AI_NOT_CONFIGURED`）。为了不打扰并行 Agent，另启了一个**独立 AI API**：

```
DATABASE_URL=postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public
REDIS_URL=redis://127.0.0.1:46380           # 复用正在运行的 Redis stub
REDIS_PREFIX=roamlog-e2-ai
API_PORT=4001
AI_PROTOCOL=openai-chat
AI_BASE_URL=http://127.0.0.1:3425/v1
AI_MODEL=auto/deepseek-v4.1-flash
AI_API_KEY=                                  # 本地 magpie 不校验
pnpm --filter @roamlog/api dev
```

Playwright 用真实 `:3000` 页面登录 `verify-crew`，只把 `/v1/workspaces/*/ai/**` 转发到 `:4001`，其他请求仍走 `:4000`。**没有点击执行**。

结果（`.audit/evidence/e2/evidence.json`）：

```
[e2] forward AI request POST /v1/workspaces/01a1ef48-.../ai/chat
[e2] AI response 201 24172ms 1653B
[e2] trips before planning: 5
[e2] trips after planning: 5
{
  "executeLabel": "执行选中的 1 项操作",
  "savedVisible": false,
  "traceSummary": "已搜索：京都 / Kyoto, Japan（共 2 次查询）",
  "tripsBefore": 5,
  "tripsAfter": 5,
  "aiNavPresent": true
}
```

- 真实返回 1 条 `trips.create`：「京都一周：古寺与咖啡馆」，`2026-04-06 → 2026-04-12`，预算 ¥8,000.00，`readOnlyTrace` 2 条 `places.search`。
- **库内计数**（不是只看响应）：直接 Prisma 查询同库 `public` schema：
  `visibleTripCount = 5`，5 条均为 2026-11-18 已有的验收/北京行程，**没有任何京都行程**；三次真实 plan 之后仍为 5。命令见 §4.6。
- `savedVisible=false`，计划面板只有「执行选中的 1 项操作」，没有「已保存/已创建」。
- 三档无横向溢出、无 console error：
  `1440: 1440/1440`、`820: 820/820`、`390: 390/390`。
- 截图：`.audit/evidence/e2/` 下 `empty-1440.png`、`plan-1440.png`、`plan-1440-trace-expanded.png`、`plan-820.png`、`plan-390.png`。

**未做真实 execute**：这是刻意选择。execute 的真实写库路径已由 E1 的 API 测试覆盖；本任务用 UI 单测覆盖提交子集、结果渲染、partialFailure、幂等重试。真实点击会在验收工作区里创建测试旅行，未获授权。

---

## 4. 验证命令与原始结果

### 4.1 定向测试（通过）

```
$ pnpm --filter @roamlog/web exec vitest run components/ai lib/api/ai

 ✓ lib/api/ai.test.ts (16 tests) 28ms
 ✓ components/ai/ai-console.test.tsx (17 tests) 5275ms

 Test Files  2 passed (2)
      Tests  33 passed (33)
```

### 4.2 `pnpm --filter @roamlog/web typecheck`（通过）

```
$ pnpm --filter @roamlog/web typecheck
$ next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
[exit code: 0]
```

`next typegen` 同时生成并校验了新路由：

```
apps/web/.next/types/routes.d.ts:  "/w/[workspaceSlug]/ai"
apps/web/.next/types/validator.ts: // Validate ../../app/(app)/w/[workspaceSlug]/ai/page.tsx
```

（过程中该命令曾因并行 Agent 未写完的 `packages/contracts/src/api/reports.ts` 红了约 10 分钟；该文件由其 owner 修好后转绿，本任务未触碰它。）

### 4.3 `pnpm --filter @roamlog/web test`（通过）

```
$ pnpm --filter @roamlog/web test

 ✓ lib/api/ai.test.ts (16 tests)
 ✓ components/ai/ai-console.test.tsx (17 tests)
 ...
 Test Files  38 passed (38)
      Tests  317 passed (317)
   Duration  29.74s
[exit code: 0]
```

本任务两个测试文件的分组结果：

```
 ✓ lib/api/ai.test.ts (16 tests) 28ms
 ✓ components/ai/ai-console.test.tsx (17 tests)
   ✓ AI console: planning is read-only (5)
   ✓ AI console: confirmed execution (5)
   ✓ AI console: failure copy (7)
```

（全量运行曾在 fixtures 的 stop `address/bbox` 与 share.test 的本地 fixture 上短暂失败——均为并行 Agent 的契约同步问题；A6 修复后本任务未做任何越界改动，全量转绿。）

### 4.4 `pnpm --filter @roamlog/web lint`（通过）

```
$ pnpm --filter @roamlog/web lint
$ eslint -c ../../eslint.config.mjs .
[exit code: 0]
```

### 4.5 `pnpm --filter @roamlog/web build`（通过，路由表包含 `/w/[workspaceSlug]/ai`）

```
$ pnpm --filter @roamlog/web build
$ next build
▲ Next.js 16.4.6 (Turbopack)
✓ Compiled successfully in 12.7s
  Running TypeScript ...
  Finished TypeScript in 14.7s ...
  Generating static pages using 15 workers (10/10) in 788ms
  Finalizing page optimization ...

Route (app)                                 Revalidate  Expire
...
├ ƒ /w/[workspaceSlug]
├ ƒ /w/[workspaceSlug]/activity
├ ƒ /w/[workspaceSlug]/ai
├ ƒ /w/[workspaceSlug]/insights
...
[exit code: 0]
```

### 4.6 库内计数（用于回答「5→5 是不是真实查库」）

```
$ DATABASE_URL="postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public" \
  apps/api/node_modules/.bin/tsx .audit/evidence/e2/db-count.ts
{
  "database": "public",
  "workspaceId": "01a1ef48-8bac-73cc-b6ae-04e7a21540df",
  "visibleTripCount": 5,
  "trips": [ ... "北京天安门", 4 条 "Viewer 权限验收 ..." ]
}
```

这是**直接 Prisma 查库**（不是只看 HTTP 响应）。三次真实 plan（1 次 curl + 2 次 Playwright）之后仍为 5，且没有任何京都相关 title。证据脚本与 `evidence.json` 在 `.audit/evidence/e2/`（gitignore）。

---

## 5. CodeGraph 证据

```
$ codegraph status
[OK] Index is up to date

$ codegraph explore "AiChatResponse AiRunExecuteResponse AiController AiConsole buildShellNavigation"
Found 62 symbols across 7 files.

- AiChatResponse (packages/contracts/src/api/ai.ts:115) — 12 callers in
  apps/api/src/modules/ai/ai-plan.service.ts, apps/web/components/ai/ai-console.tsx,
  apps/web/components/ai/plan-panel.tsx, apps/web/lib/api/ai.ts;
  tests: apps/api/.../ai-plan.service.spec.ts, apps/web/components/ai/ai-console.test.tsx,
  apps/web/lib/api/ai.test.ts
- buildShellNavigation (apps/web/components/app-shell/app-shell-nav.ts:47) — 2 callers in
  app-shell-view.tsx; tested via apps/web/components/app-shell/app-shell.test.tsx
- dynamic: AiAssistant → AiConsole (renders), AiConsole → DialogTitle/Textarea/Button/DialogContent
```

用途：确认 `AiChatResponse` 的真实调用方与新文件位置；确认 `buildShellNavigation` 唯一消费方（新增导航不会破坏其他路由）；确认页面到 Dialog 的渲染链。

---

## 6. 已知风险

1. **后台链接依赖 `NEXT_PUBLIC_ADMIN_URL`**，未配置时默认 `http://localhost:3001/admin/settings`。生产同域部署时必须注入该变量；更好的做法是把 AI 供应商是否配置暴露为公开设置/状态端点，而不是前端猜后台地址。
2. **计划有效期只显示静态时间**（`计划有效至 HH:mm`），没有倒计时；过了 15 分钟再执行会得到 `AI_RUN_NOT_FOUND`，已有对应中文文案 + 「重新规划」。
3. **聊天记录只存在内存**：刷新会丢失 transcript 与计划（服务端 run 仍存在但 runId 丢失）。刻意不写 localStorage，避免账号切换串数据。
4. **模型 markdown 只做轻量渲染**（标题/列表/编号/小表格/粗体），不渲染链接、代码块、复杂嵌套表格；不会注入 HTML。
5. **模型日期可能给出过去日期**：真实联调返回 `2026-04-06`（今天是 2026-11-19）。这是模型行为，UI 原样展示并让用户确认；建议在服务端 system prompt 里注入当前日期下限。
6. **无流式（SSE）**：API 当前一次性返回，页面显示「正在搜索…」等待；真实调用约 20–31s，长等待需要更明确的进度文案（已有 thinking 行 + skeleton）。
7. **viewer 门禁是客户端提示**：服务端 `@RequirePermission("trip:create")` 仍是权威；绕过 UI 直接调 API 会得到 403。
8. **重试幂等依赖服务端 IdempotencyService**：UI 只保证同一个 key 被复用；真实 Redis stub 的 `EVAL` 返回 0，未做真实“断网后重试不重复创建”的端到端验证。

---

## 7. 未覆盖项

- **真实 execute 的浏览器 E2E**：未在验收工作区点击执行（避免创建测试数据）。结果渲染/partialFailure/幂等/子集提交由单测覆盖，写库链路由 E1 的 API 测试覆盖。
- SSE 流式、模型进度、Memories/Skills、hints 表单（日期/预算/风格控件）。
- axe 自动化扫描与读屏手工走查；本次只做了键盘路径与 aria-live 的代码级 + Playwright 可见性检查。
- 真实网络失败下的 execute 重试（需要可控的断网注入）。
- 全量 typecheck/test/build 已在本任务收尾时转绿；若并行 Agent 继续修改 `packages/contracts` 或共享 fixtures，需要在其变更落定后再跑一次 §4.2/4.3/4.5。

---

## 8. 建议下一步

1. 合并窗口内若 `packages/contracts` 或共享 fixtures 再变，重跑 §4.2/4.3/4.5 并保存新的 build 路由表输出。
2. 把「AI 是否配置」做成公开只读状态（或在 `/v1/public/settings` 加 `ai.enabled`），让 503 页面链接不依赖 `NEXT_PUBLIC_ADMIN_URL`。
3. 增加 execute 的真库 E2E：独立 schema + 专用 workspace，执行后断言 `Trip` 行、清理数据、再用同一 key 重试断言不重复。
4. 给服务端 system prompt 注入 `today`，避免模型产出过去日期。
5. 移动端在计划生成后提供「查看计划」锚点/自动滚动到计划面板。