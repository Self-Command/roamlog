# G3_FIX_VERIFY — 修复后真实浏览器复验报告

- 任务 ID: `G3_FIX_VERIFY`
- 角色: `qa_verifier`（只验证，未改任何产品代码）
- 仓库: `C:\Users\BY9700\Desktop\UI\roamlog`（Windows Git Bash）
- 时间: 2026-11-18 23:10–23:2x（Asia/Shanghai）
- Web: Next.js 16.4.6 dev（`cd apps/web && pnpm exec next dev -p 3500`，**非**影子目录）
- 浏览器: **Playwright 1.65.0 + 本机 Chromium**（真实点击/键盘/截图，非 jsdom）
- 入口: `http://localhost:3500`（`127.0.0.1` 会被 Next 16 dev-origin 拦截 → MSW 不启动，已按要求只用 localhost）
- demo slug: `roamlog-crew`（`packages/api-mocks/src/fixtures.ts:33 DEMO_WORKSPACE_SLUG`）
- 断言源: **新增** `e2e/g3-fix/{00-diagnose,01-manual-fallback,02-copy-leak,03-date-window}.spec.ts` + `support/harness.ts`
- 运行命令（仓库 `playwright.config.ts` 未改，QA 使用证据目录内独立 config）:

```bash
npx playwright test --config=.audit/evidence/g3-fix/playwright.g3fix.config.ts
```

## 总览

| 缺陷 | 结论 | 断言数 | 截图 |
| --- | --- | --- | --- |
| V1（P0）搜索失败仍可手动填写地点 | **PASS** | 21 | `manual-fallback-500-state.png`、`v1-manual-fallback-listbox-500.png`、`v1-manual-selected-click.png`、`v1-manual-selected-keyboard.png` |
| V2（P1）错误文案不泄露底层细节 | **PASS** | 43 | `manual-fallback-with-500.png`、`v2-listbox-with-500.png`、`v2-real-500.png`、`v2-manual-fallback-offline.png`、`v2-real-offline.png` |
| V3（P1）日期默认值与成对修正 | **PASS** | 25 | `date-default-7days.png`、`date-start-future-selectable.png`、`date-auto-adjust.png`、`date-end-before-start.png` |

**9 个 Playwright 用例（8 个产品验收 + 1 个环境诊断）/ 89 条产品断言，连续 3 轮 100% 通过**（3 次运行均 `9 passed`，见 `logs/playwright-run-3.log`）。0 FAIL，无产品缺陷结论项。

## 环境门（三道门，全部通过）

| 门 | 结果 |
| --- | --- |
| `GET http://localhost:3500/login` | **200** |
| `/w/roamlog-crew/trips/new` 可进入 | **200**，表单可交互 |
| 「创建旅行」按钮可见 | **可见**，9 个用例均以它作为就绪门 |
| 未卡在「正在准备本地旅行数据」 | `bodyHasPreparing=false`（每轮诊断用例记录） |

启动日志：`▲ Next.js 16.4.6 (Turbopack) - Local: http://localhost:3500 - Ready in 377ms`；`apps/web/.next/dev/lock` 不存在，无需影子目录。启动前 3000/3100/3500/4000/4100 均无 LISTENING，55443（另一 Agent 的 PG）未触碰。证据：`logs/env-gates.json`。

## 拦截方式的实测事实（重要，属测试写法与环境，不是产品结论）

按要求用 `page.route("**/v1/places/search**", …)` 注册了拦截，并在每个用例里回读命中数：

- **`routeHits` 恒为 0**。原因与 G3 记录一致：Web 的 MSW 跑在 **Service Worker**（`apps/web/public/mockServiceWorker.js`）内，`/v1/*` 由 worker 直接处理，Playwright 的页面级路由看不到该请求（诊断树 `00-diagnose` 实测：`requests` 有 1 条、`routeHits: 0`）。
- 因此另加 **`window.fetch` 初始化脚本 shim**（仅测试侧，**未改 MSW 源码**），返回与要求完全相同的 `{ code: "UPSTREAM_ERROR", message: "Internal Server Error" }` / `TypeError`。`shimHits` 实测为 1，证明请求确实被注入。
- 额外保留**完全不打桩的真实路径**（V2c）：MSW bypass → Next dev rewrite → `:4000` 未启动 → **真实 500**（响应体是 HTML，正是修复前吐出 `Unexpected token 'I', "Internal S"...` 的那条链路）。这条用例在真实 500 下同样不泄露。
- 断网场景：`route.abort("failed")` 在本栈同样打不到（同因），故用两种更强的方式：shim 抛 `TypeError`（V2b）+ **浏览器级真实断网 `context.setOffline(true)`**（V2d，真网络调用失败）。

> 判定：以上是测试执行层的适配差异，**不是产品缺陷**；产品在 4 种失败形态（注入 500 JSON、真实 500 HTML、注入断网、真实断网）下的表现一致且正确。

## V1（P0）搜索失败时仍可手动填写地点 — PASS（21 断言）

用例：`01-manual-fallback.spec.ts`（`V1a` 12 断言 / `V1b` 9 断言，均 PASS）

**V1a（鼠标）**：注入 500 → 在「旅行起点」输入 `京都`
- `role=listbox`（`旅行起点建议`）可见；内含 `role=status` + **「重试」按钮仍在**，未被降级行替代；
- 手动降级行出现且可见：`使用「京都」作为起点`，且 `aria-selected="true"`（`activeIndex` 指向它）；
- 点击后：输入框值 `京都`、**「手动地点」徽章可见**、**「坐标为空」可见**、无「地点库」徽章、listbox 关闭；
- 观测：`shimHits: 1`、`routeHits: 0`（`logs/v1a-manual-click.json`）。

**V1b（键盘）**：同样 500 场景，输入 `京都` 后直接 `Enter`
- `aria-activedescendant = "_r_a_-listbox-_r_a_-manual"`，该 id 实际指向手动行（`document.getElementById(...).textContent === "使用「京都」作为起点"`），其 `aria-selected="true"` → **证明 activeIndex 指向 manual**；
- `Enter` 后同样得到「手动地点」+「坐标为空」，listbox 关闭（`logs/v1b-keyboard-enter.json`）。

关键 DOM 文本摘录（500 态）：

```
地点搜索暂时不可用，你可以直接输入地点名称。

重试
使用「京都」作为起点
```

截图：`.audit/evidence/g3-fix/shots/manual-fallback-500-state.png`（视口，错误+重试+降级行同屏）、`v1-manual-fallback-listbox-500.png`（listbox 元素）、`v1-manual-selected-click.png`（点击后「手动地点 / 本地时区 / 坐标为空」）、`v1-manual-selected-keyboard.png`（键盘选中后同态）。

## V2（P1）错误文案不泄露底层细节 — PASS（43 断言）

用例：`02-copy-leak.spec.ts`，**4 种失败形态各测一次**，每次对 listbox 文本与 `body.innerText` 逐一断言不含 `500`、`/v1/`、`Unexpected token`、`Internal Server`（每形态 8 条 + 固定文案/重试断言）。

| 用例 | 形态 | 断言 | 用户可见文案（摘录） | 泄露检查 |
| --- | --- | --- | --- | --- |
| V2a | 注入 500 JSON（`{code:"UPSTREAM_ERROR",message:"Internal Server Error"}`） | 10 | `地点搜索暂时不可用，你可以直接输入地点名称。` + `重试` + `使用「京都」作为起点` | 4/4 片段均不出现（listbox 与 body） |
| V2b | shim 抛 `TypeError`（断网等价） | 12 | `网络连接中断，请检查网络后重试，或直接输入地点名称。` | 同上 |
| V2c | **真实 500 HTML**（无任何打桩，Next dev 代理 500） | 10 | `地点搜索返回异常，你可以直接输入地点名称。` | 同上 |
| V2d | **真实断网**（`context.setOffline(true)`） | 11 | `网络连接中断，请检查网络后重试，或直接输入地点名称。` | 同上 |

固定文案确实随失败类型变化（`unavailable` / `offline` / `invalid-response` 三分支各命中一次），且 `重试` 始终保留；V2d 是浏览器级真实断网，不是模拟。日志：`logs/v2a-json500-no-leak.json`、`v2b-offline-no-leak.json`、`v2c-real-500-no-leak.json`、`v2d-real-offline.json`（均含逐片段 `present: false`）。

截图：`manual-fallback-with-500.png`（要求的命名，视口内可见错误/重试/降级行）、`v2-listbox-with-500.png`（748×138 元素截图，可读全部文案）、`v2-real-500.png`、`v2-manual-fallback-offline.png`、`v2-real-offline.png`。

## V3（P1）日期默认值与成对修正 — PASS（25 断言）

用例：`03-date-window.spec.ts`（`V3a` 4 / `V3b` 21）

**V3a 默认 7 天窗口**
- 从两个触发器读出 `start = 2026-11-18`、`end = 2026-11-24` → **`end === start + 6`**，含首尾 `7` 天；
- 派生文案 `共 7 天 · 6 晚` 同时出现在区块头与「含首尾两天」小结（`logs/v3a-default-window.json`）。
- 截图 `date-default-7days.png`。

**V3b 未来可选 + 成对修正**（4 步，每步都重新读控件值与派生天数）
1. 打开**开始日期**日历：`start+5 = 2026-11-23` 的 `aria-disabled` 不为 `true`；另取 **`start+10 = 2026-11-28`**（修复前 `max=endDate` 下必被禁用）同样不为 `true` → **未来日期可选**。截图 `date-start-future-selectable.png`。
2. 选 `2026-11-23`：`start → 11-23`、**`end` 保持 `11-24`**（合法改动不动另一端），派生 `共 2 天 · 1 晚`。
3. 再选 `start+8 = 2026-12-01`（> 当前 end）：**`end` 自动跟到 `2026-12-01`**，区间 `1` 天，派生 `共 1 天 · 0 晚`。截图 `date-auto-adjust.png`。
4. 打开**结束日期**日历选 `start-2 = 2026-11-29`：**`start` 回退到 `2026-11-29`**，`end = 11-29`，`end >= start` 恒成立，派生 `共 1 天 · 0 晚`，且页面无「返回日期需不早于出发日期」错误。截图 `date-end-before-start.png`。
- 日志：`logs/v3b-start-future-and-pair.json`（`start0/end0 → 11-23/11-24 → 12-01/12-01`）、`logs/v3b-end-before-start.json`（`11-29/11-29`）。

**与要求字面表述的偏差（测试写法问题，非产品缺陷）**：要求写「选中 `start + 5` → 断言结束日期自动跟到该日」。在默认窗口 `[start, start+6]` 内，`start+5` 仍 ≤ `end`，`applyTripDateChange` 只允许**非法**方向触发联动；要求括号内的「或按 `applyTripDateChange` 语义」已覆盖此点。因此按语义断言为「end 不动」，并**另行**用 `start+8 > end` 证明「end 被推到新 start」分支，两个分支都拿到证据。

## 未覆盖 / 说明

- `rate-limited`（429）文案分支未在真实浏览器复跑（需要拦截 429 且带 `Retry-After`；本任务 3 条缺陷不涉及）。
- mock 模式没有 `/v1/places/search` 处理器，500 由 Next dev rewrite 到未启动的 `:4000` 产生——这是**既有环境事实**，不是本次修复的目标；修复点在 UI 层（降级行 + 文案收口），已在上述 4 种失败形态下全部验证。
- 真实地点搜索结果（provider 坐标/时区回填）不可测：mock 无 place provider；不在本次 3 条缺陷范围内。
- 「创建旅行」提交持久化仍受 mock 无 POST 限制（G3 已记录），不属于本次修复项，未重复验收。

## 边界声明

本轮**只写入**：

- `.audit/evidence/g3-fix/**`（独立 config、14 张截图、9 个日志 + `env-gates.json` + 运行日志）
- `.audit/g3-fix-verify-report.md`、`.audit/g3-fix-verify-report.checkpoint.md`
- **新增** `e2e/g3-fix/**`（4 个 spec + 1 个 harness，全新目录）

未改动 `apps/**`、`packages/**`、既有 `e2e/**`、`playwright.config.ts`、`playwright.a11y.config.ts`；未跑 build；未执行任何 git 写操作（`reset/clean/checkout/stash/commit` 均未使用）；未触碰 3000/3100/4100/55443；未连生产。反证：被验证的 5 个产品文件 mtime 仍为 `23:06`（修复任务时间），本会话 23:10 之后无写入；`git status` 中我的改动只有 `?? e2e/g3-fix/`。

清理：3500 dev server 已停止，`netstat` 确认 3500 无监听；本次未使用影子目录，无需删除临时目录。

CodeGraph 证据: `codegraph status` → `[OK] Index is up to date`（1,481 files / 22,706 nodes / 49,952 edges）；`codegraph_explore "SearchableCombobox classifySearchFailure renderOptionRow failureMessage applyTripDateChange TripForm emptyTripFormValues"` → 命中 3 文件，确认调用链 `TripForm → OriginField → SearchableCombobox → failureMessage → classifySearchFailure`，且 `SearchableCombobox` 8 callers / `DatePicker` 5 callers / `TripForm` 6 callers；二次查询 `origin-field.tsx OriginField manualLabel 手动地点 handleDateChange trip-start-date DatePicker trip-end-date` 取得 `origin-field.tsx:65 manualLabel`（`使用「${value}」作为起点`）、`origin-field.tsx:66-71` 固定 errorLabel/errorMessages、`trip-form.tsx:226-239 handleDateChange`、`date-picker.tsx:311 aria-disabled`，据此把断言直接锚定到 `role=option`、`aria-activedescendant`、`aria-disabled` 与 `#trip-start-date`/`#trip-end-date`，无需试错式搜索。