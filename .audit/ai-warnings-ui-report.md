# AI_WARNINGS_UI — 计划 warnings 展示报告

- 状态: **NEEDS_REVIEW** — 功能、定向测试、typecheck、build 全绿；`pnpm --filter @roamlog/web lint` 仍被本任务范围外的 3 个错误挡住（详见 §4.4）。
- 任务 ID: `AI_WARNINGS_UI`
- 角色: `web_frontend`
- 分支/提交: 本地 commit `feat(ai): show the plan warnings so a rejected call explains itself`

---

## 1. 变更文件

```
apps/web/components/ai/copy.ts            # warning → 人类可读动作 / PAST_DATE 说明
apps/web/components/ai/plan-panel.tsx     # 可折叠 warnings 区块 + 空计划文案 + 修改按钮
apps/web/components/ai/ai-console.tsx     # 透传 warnings 到公告；revise 只回填草稿，不自动重发
apps/web/components/ai/ai-console.test.tsx# +5 个 warnings UI 测试
apps/web/lib/api/ai.ts                    # AiPlanResult 显式保留 warnings
apps/web/lib/api/ai.test.ts               # +1 个数据层透传测试
.audit/ai-warnings-ui-report.md           # 本报告
```

未触碰：`apps/api/**`、`packages/**`、`apps/web/components/{media,share,trips,trip-workspace}/**`、
`apps/web/lib/image/**`、`e2e/**`、`apps/web/admin/**`。

---

## 2. 实现摘要（逐 5 项）

### 2.1 数据层透传

- 新增 `AiPlanResult extends AiChatResponse`，并把 `warnings?: AiPlanWarning[]` 显式声明在结果类型上；
  `createAiPlan` 返回**原样的 Zod 解析信封**（`postJson<AiPlanResult>(…, AiChatResponseSchema)`），
  不做二次映射、不重排字段。
- 测试 `keeps the server's warnings on the parsed plan` 让服务端同时返回 `PAST_DATE` 与
  一个客户端不认识的 code，断言解析后 `plannedCalls=[]` 且 `warnings` 与原负载逐字段相等。

### 2.2 plan-panel 渲染 warnings（`plannedCalls` 之前）

- 新增 `PlanWarnings`：`text-stone` 文本 + `border-hairline` 边框 + `bg-surface-2/40` 的中性区块，
  `aria-expanded` 控制展开/折叠，默认展开（提示本身就是这轮要解决的问题，不藏起来）。
- 标题为「N 条提示」，右侧「部分操作已忽略」；每条先显示 `subject` 映射出的动作名
  （`trips.create` → 「创建旅行」，`stops.add` → 「添加行程节点」，…），再显示服务端 `message`。
- `PAST_DATE` 追加固定说明：「这些日期早于今天，已忽略。请给出未来的日期。」
- 无 warnings 时整个区块不渲染（不占位）。
- 对比度实测：`--stone #7a8083` 对 `--surface-1 #0a0a0c` = **4.94:1**，对混合背景 `#0c0c0e` = **4.88:1**，
  均 ≥ 4.5:1；`text-body` 为 14.27:1。全区块无 `accent-red`。

### 2.3 空计划的文案

- `plannedCalls=[]` 且有 warnings 时不再显示「还没有计划 / 没有可执行的计划」，改为：
  - 标题：「**已生成建议，但全部被校验拦下**」
  - 说明：「助手给出了操作建议，但没有一条通过校验，具体原因见上方「N 条提示」。工作区没有被写入任何内容。」
  - 按钮：「**修改需求重新规划**」（`outline`，非 primary）
- 按钮调用 `reviseRequest()`：把最后一条用户需求回填到输入框并聚焦，**不调用 `send()`**，
  避免自动重发同一个必败请求；真正发送仍复用现有 `send()`/表单提交路径。
- 空计划 footer 文案同步区分：有 warnings 时提示「修改需求后重新发送…现在没有写入任何内容」。

### 2.4 防腐

- `describePlanWarning` 只对已知 code 追加解释；**未知 code 照样渲染服务端 `message`**，不丢弃。
- `code` 与 `subject` 从不进入 DOM；`subject` 仅在命中已知工具名时映射为动作，未知 subject 只显示 message。
- 测试对整页 `document.body.textContent` 断言不含 `PAST_DATE` / `plannedCalls` / `warnings` / `JSON`
  以及测试用的未知 code。

### 2.5 测试（新增 6 个，全部通过）

1. 1 条 warning：区块、动作名「创建旅行」、`message`、PAST_DATE 明确说明齐全。
2. 3 条 warning：显示「3 条提示」，默认展开，点击折叠后再展开。
3. 无 warning：不渲染提示区块。
4. 空 `plannedCalls` + warning：主文案指向 warnings，不出现「已创建/已保存」；点「修改需求重新规划」只回填草稿、`createAiPlan` 仍只调用 1 次。
5. 未知 code：仍渲染服务端 message，且页面不含该 code。
6. 数据层：服务端返回 warnings → `createAiPlan` 解析后仍在。

---

## 3. 关键代码

```ts
// apps/web/lib/api/ai.ts
export interface AiPlanResult extends AiChatResponse {
  warnings?: AiPlanWarning[];
}

export async function createAiPlan(...): Promise<AiPlanResult> {
  return postJson<AiPlanResult>(`/v1/workspaces/${...}/ai/chat`, body, AiChatResponseSchema);
}
```

```ts
// apps/web/components/ai/copy.ts
function warningExplanation(code: string): string | undefined {
  switch (code) {
    case "PAST_DATE":
      return "这些日期早于今天，已忽略。请给出未来的日期。";
    default:
      return undefined;
  }
}
```

---

## 4. 验证命令与结果

### 4.1 `pnpm --filter @roamlog/web typecheck` → exit 0

```
$ next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully
[typecheck exit: 0]
```

### 4.2 `pnpm --filter @roamlog/web exec vitest run components/ai lib/api/ai` → 39/39

```
 ✓ lib/api/ai.test.ts (17 tests) 38ms
 ✓ components/ai/ai-console.test.tsx (22 tests) 9299ms
   ✓ AI console: plan warnings (5)
     ✓ renders one warning with a human action name and an explicit past-date explanation 364ms
     ✓ lists three warnings behind an expandable count 364ms
     ✓ does not render a warning block when the server sent none 313ms
     ✓ points an empty plan at the warnings and restores the draft without re-sending 965ms
     ✓ renders an unknown warning code from the server message alone 363ms

 Test Files  2 passed (2)
      Tests  39 passed (39)
   Duration  13.13s
[exit code: 0]
```

### 4.3 `pnpm --filter @roamlog/web test` → 362/362

```
 Test Files  44 passed (44)
      Tests  362 passed (362)
   Start at  15:36:22
   Duration  23.85s
[exit code: 0]
```

### 4.4 `pnpm --filter @roamlog/web lint` → exit 1（范围外阻塞）

```
C:\...\apps\web\components\media\live-photo.tsx
  148:8  error  Definition for rule '@next/next/no-img-element' was not found  @next/next/no-img-element

C:\...\apps\web\components\media\use-live-photo-upload.ts
  317:7  error  The value assigned to 'durationMs' is not used in subsequent statements  no-useless-assignment

C:\...\apps\web\components\moderation\api.ts
  31:7  error  The value assigned to 'body' is not used in subsequent statements  no-useless-assignment

✖ 3 problems (3 errors, 0 warnings)
[full-lint exit: 1]
```

归属证明：

- `live-photo.tsx` / `use-live-photo-upload.ts` 属于并行 Agent 的提交 `9dcd2d9 feat(web): play and upload Live Photo pairs`，工作区对它们无改动。
- `components/moderation/api.ts` 相对 HEAD 无 diff（`git diff --stat` 为空），最后提交为 `5df8607`，是既有错误。
- 本任务文件单独 lint：`pnpm exec eslint -c ../../eslint.config.mjs components/ai lib/api/ai.ts lib/api/ai.test.ts`
  → `[ai-scoped-lint exit: 0]`，无任何输出。

### 4.5 `pnpm --filter @roamlog/web build` → exit 0

```
✓ Generating static pages using 15 workers (10/10) in 869ms
Route (app)                                 Revalidate  Expire
├ ƒ /w/[workspaceSlug]/ai
...
[build exit: 0]
```

> 本任务未改 `components/trips/trip-form`；build 未被 `DESTINATIONS_UPGRADE` 阻塞，完整通过。

---

## 5. CodeGraph 证据

- 项目：`C:\Users\BY9700\Desktop\UI\roamlog`
- `codegraph status`：`[OK] Index is up to date`（1,742+ 文件 / 27,198 节点 / 62,107 边；改动后 watcher 已增量收录新符号）。
- 查询 1（动手前）：
  `codegraph_explore "AiChatResponse warnings AiPlanResult plan-panel ai-console copy.ts"`
  → 命中 `AiChatResponse`（packages/contracts/src/api/ai.ts:136）、`AiPlanWarning`、
  `AiChatResponseSchema`、`PlanPanel`、`describePlannedCall`；blast radius 显示 `AiChatResponse` 有 12 个调用方
  （含 `apps/web/lib/api/ai.ts`、`apps/web/components/ai/*`、`apps/api/.../ai-plan.service.ts`），
  并确认 **`AiPlanResult` 不在索引中**（即 web 数据层此前没有该类型，warnings 也无人消费）。
- 查询 2（改动后）：
  `codegraph_explore "describePlanWarning AiPlanResult PlanWarnings reviseRequest"`
  → 新符号已收录：
  - `PlanWarnings` (plan-panel.tsx:93) — dynamic render `PlanPanel → PlanWarnings`，测试经 `ai-console.test.tsx`
  - `AiPlanResult` (lib/api/ai.ts:217) — `AiPlanResult → AiChatResponse`（extends）
  - `describePlanWarning` (copy.ts:244) — `PlanWarnings → describePlanWarning → knownTool/toolLabel/warningExplanation`
- 结论：只影响 AI 计划面板与其数据层；未改服务端调用链，未触碰并行边界。

---

## 6. 已知风险

1. **全量 lint 红**：3 个错误均在范围外文件（media ×2、moderation ×1），本任务文件 lint 为 0。需由对应 owner 修复后重跑。
2. **默认展开**：warnings 默认展开；契约上限 20 条，极端情况下会占满面板可视区（可折叠，不是阻塞）。
3. **未知 subject 无动作名**：为保证不泄漏原始标识符，未知 subject 只显示 message；用户可能少一条「这是对哪个操作」的线索。
4. **Announcement 变化**：有 warnings 时 `role=status` 文案改为「N 项操作被校验拦下」；无 warnings 的旧文案保持不变。
5. **`next-env.d.ts` 工作区噪音**：`next typegen`/build 把 dev 类型引用改成 `.next/types/...`；该文件在开工前已是 modified，未纳入本提交。

---

## 7. 未覆盖项

- 未跑真实服务端联调（不修改 `apps/api/**`）；warnings 负载按 `.audit/ai-settings-report.md` §E2E 的真实样例构造。
- 未加浏览器截图/视觉回归；仅按 token 计算对比度（4.94:1 / 4.88:1）。
- 未覆盖「warnings + 非空 plannedCalls」同屏的显式断言（组件逻辑同一路径，空计划场景已覆盖）。
- 未测试 20 条 warnings 的滚动表现。

---

## 8. 建议下一步

1. 由 media/moderation 的 owner 清掉 3 个 lint 错误，然后重跑 `pnpm --filter @roamlog/web lint` 作为合并门禁。
2. QA 用真实 API 重放 `PAST_DATE` 负载（或 e2e mock），确认面板文案与截图一致。
3. 契约 owner 重生成 OpenAPI/api-client 后，把 `warnings` 写进生成客户端；本任务的 `AiPlanResult` 不需要再改。