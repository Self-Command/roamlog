# G3 UI Journeys — 真实浏览器验收报告（mock 模式）

- 任务 ID: `G3_UI_JOURNEYS`
- 角色: `qa_verifier`
- 仓库: `C:\Users\BY9700\Desktop\UI\roamlog`
- 环境: Next.js 16.4.6 dev（`pnpm --filter @roamlog/web dev`，端口 **3000**，mock 模式，`NEXT_PUBLIC_DATA_MODE` 未设置为 api）
- 浏览器: Playwright 1.65 + 本机 Chromium（`C:\Users\BY9700\AppData\Local\ms-playwright`），真实点击/键盘，非 JSDOM
- 证据目录: `.audit/evidence/g3-ui/`（`shots/` 29 张截图，`logs/` 断言与网络日志）
- 断言源: `e2e/g3/*.spec.ts`（新增目录，未改动既有 e2e）
- 运行命令: `npx playwright test --config=.audit/evidence/g3-ui/playwright.g3.config.ts`
  （`playwright.config.ts` 未改；因仓库配置的 `web` project 只匹配 `e2e/web/**`，G3 使用放在证据目录内的独立 config，testDir 指向 `e2e/g3`）

## 总览

| 旅程 | 结论 | 断言数 | 截图 | 备注 |
| --- | --- | --- | --- | --- |
| 1. 旅行创建全字段 | **FAIL** | 38（31 通过 / 7 失败） | `create-form-1440.png`、`create-form-390.png`、`create-submit-result.png`、`combobox-real-mock.png` | 表单本身（日历、天数派生、目的地顺序/去重/删除、预算、标签去重、同行人）全部实测通过；**起点无法填写**（mock 无 places/search + error 态不渲染手动降级行）与**提交不跳转**（mock 无 POST 处理器）阻断 |
| 2. combobox 五态 | **PASS** | 22 | `combobox-loading.png`、`combobox-empty.png`、`combobox-error.png`、`combobox-degraded.png`、`combobox-manual.png` | 五态均由 `window.fetch` 注入构造（MSW 在 Service Worker 内，`page.route` 无法截获，已实证）；组件本身、防抖、ARIA 均为真实实现 |
| 3. 日期选择器键盘 | **PASS** | 18 | `datepicker-keyboard-tab.png`、`datepicker-keyboard.png` | Tab→Enter→ArrowRight/ArrowDown→Enter→Esc 全链路通过，Esc 后焦点回到触发器且 ring 可见 |
| 4. 编辑页 | **FAIL** | 13（11 通过 / 2 失败） | `edit-prefilled-1440.png`、`edit-submit-result.png`、`edit-synthetic-after.png` | 回填（标题/简介/日期/预算/币种/v7）实测通过；**保存不跳转、不持久**（mock 无 PATCH）；合成 200 PATCH 下表单成功路径可跳转 |
| 5. 详情工作台 | **FAIL** | 7（5 通过 / 2 失败） | `detail-概览-1440.png`、`detail-行程-1440.png`、`detail-相册-1440.png`、`detail-预算-1440.png`、`detail-打包-1440.png`、`detail-活动-1440.png` | mock 路由挂载的是 **legacy 详情（8 tab）**，7-tab `TripWorkspace` 仅 `DATA_MODE=api` 可达；已挂载的 8 个 tab 全部渲染真实组件与数据 |
| 6. 响应式与溢出 | **PASS** | 3（每次 6 组测量） | `responsive-{390,820,1440}-{create,detail}.png` | 6 个组合 `scrollWidth === clientWidth`（390/820/1440） |
| 7. 键盘可达性 | **PASS** | 3（覆盖 29 个可交互控件） | `keyboard-focus-ring.png` | 40 次 Tab：29 个真实控件的 `:focus-visible` 与 ring 全部为真；焦点顺序已记录 |
| 8. reduced motion | **PASS** | 11 | `reduced-motion.png`、`reduced-motion-detail.png` | `matchMedia` 为 true；日历选定、天数派生、tab 切换均不依赖动画结束；无 opacity:0 残留元素 |

合计 23 个 spec 用例：**19 PASS / 4 FAIL**。4 个 FAIL 均已定位到具体断言，且原因均为“mock 模式缺少后端能力”或“路由在 mock 下走 legacy 分支”，不是脚本缺陷。

## 逐条失败证据

### FAIL-1 · 创建提交不跳转（旅程 1）
- spec: `e2e/g3/01-create-form.spec.ts › create: submit navigates to the new trip detail`
- 断言: `await expect(page).toHaveURL(/\/w\/roamlog-crew\/trips\/[0-9a-f-]{36}$/)`
- 期望: 跳转 `/w/roamlog-crew/trips/<id>`
- 实际: 停留在 `/w/roamlog-crew/trips/new`，出现 `role=alert`“网络异常，未能保存。请检查网络连接后重试，已填写的内容不会丢失。”
- 网络事实（`logs/create-submit-observed.json` + 运行时响应记录）：`POST /v1/workspaces/019a7e3a-2b40-7c1d-8a5f-000000000003/trips -> 500`。mock 的 MSW 处理器集合（`packages/api-mocks/src/handlers.ts`）**只有 GET**，未处理请求被 `onUnhandledRequest: "bypass"` 放行，经 `next.config.ts` 的 `/v1/:path*` rewrite 转发到未启动的 `API_URL`（:4000）而失败。
- 截图: `.audit/evidence/g3-ui/shots/create-submit-result.png`

### FAIL-2 · 起点无法在 mock 下填写（旅程 1）
- spec: `e2e/g3/01-create-form.spec.ts › create: origin search in mock mode offers a manual fallback`
- 断言: `expect(listbox.getByRole("option", { name: /使用「京都」作为起点/ })).toBeVisible()`
- 期望: 搜索不可用时提供“使用「京都」作为起点”的手动降级行
- 实际: 列表内只有错误文案与原“重试”按钮，`role=option` 数 = 0（`logs/origin-search-mock.json`：`{"network":["500"],"options":0,"originCount":0}`）。原因：mock 无 `/v1/places/search` 处理器（同上 bypass→500）；且 `searchable-combobox` 仅在 `status === "ready"` 时渲染 options，error 态下 manual 行被一并隐藏，`OriginField` 的“手动起点”提示因此也无从触发。
- 截图: `.audit/evidence/g3-ui/shots/combobox-real-mock.png`
- 影响: mock 模式下“旅行起点”是唯一无法通过 GUI 设置的字段；旅程 1 的“起点选择”要求未覆盖。

### FAIL-3 · 编辑保存不跳转、不持久（旅程 4）
- spec: `e2e/g3/04-edit-trip.spec.ts › edit: submit persists the new title and echoes it back`
- 断言: `await expect(page).toHaveURL(/\/w\/roamlog-crew\/trips\/019a7e3a-...-000000000010$/)`
- 期望: 保存后回到详情并回显新标题，刷新仍保留
- 实际: 停留在 `/edit`，`role=alert`“网络异常，未能保存…”，标题输入框仍保留用户输入 `首尔，晚秋与夜航（G3 已改）`（`logs/edit-submit-observed.json`）。mock 无 `PATCH /v1/trips/:id` 处理器，请求同样 bypass→500。
- 对照（合成证据，明确标注非产品能力）: `edit: with a responding server the form navigates back to detail` 通过 —— 用 `window.fetch` 注入 200 PATCH 后，表单确实跳转回详情页；因此缺陷在 mock 数据层，不在表单成功路径。
- 截图: `.audit/evidence/g3-ui/shots/edit-submit-result.png`、`edit-synthetic-after.png`

### FAIL-4 · 7-tab 工作台在 mock 下不可达（旅程 5）
- spec: `e2e/g3/05-trip-detail.spec.ts › detail: the seven-tab workbench is reachable in mock mode`
- 断言: 依次 `expect(page.getByRole("tab", { name: label, exact: true })).toBeVisible()`，label ∈ {行程, 照片, 费用, 行李, 分享, 参与者, 活动}
- 期望: `TripWorkspace` 的 7 个 tab
- 实际: 挂载的是 legacy 详情的 8 个 tab：`["概览","日志","行程","相册","地图","预算","打包","活动"]`（`logs/detail-tabs.json`）；第一个不存在的“照片”即失败。根因在路由数据模式门禁：`apps/web/app/(app)/w/[workspaceSlug]/trips/[tripId]/page.tsx` 中 `if (DATA_MODE === "api") return <TripDetailLive …/>`，否则渲染 `LegacyTripDetail`。`TripWorkspace` 只能由 `TripDetailLive` 渲染（CodeGraph 动态派发已确认）。
- 截图: `.audit/evidence/g3-ui/shots/detail-*-1440.png`（6 张）
- 补充（PASS）：对**实际挂载**的 8 个 tab 逐个点击，断言每个 tabpanel 有真实标题、文案长度 > 30、无 `animate-pulse` 骨架，并记录条数：概览 528 字符 / 日志 223 / 行程 4 行 / 相册 157 / 地图 239 / 预算 530 / 打包 172 / 活动 237。**不是渐变占位**。

## 通过项的关键断言摘要

- **无裸日期输入**：`input[type=date]` 计数 = 0；两个日期控件是 `<button aria-haspopup="dialog">`，点击后出现 `role=grid`，`aria-activedescendant` 指向 `date-picker-选择出发日期-YYYY-MM-DD`，打开即聚焦到 grid。
- **日期必须点日历**：断言方式为点击 gridcell（非 `fill`）；`2026-11-20` → `2026-11-24` 后派生文案 `共 5 天 · 4 晚` 出现，触发器分别显示 `2026年11月20日` / `2026年11月24日`。
- **目的地 chips**：添加「金泽」「白川乡」→ 2 行；重复「金泽」被拒（“「金泽」已在目的地列表中”）；“上移「白川乡」”后首行变为白川乡；“移除「金泽」”后剩 1 行。
- **预算**：金额 `18800` + 币种 combobox 选出 `CNY` → 预览 `¥18,800 · 保存为 1880000 CNY`。
- **标签去重**：`城市漫步`、`咖啡` 后重复添加被拒（“「城市漫步」已存在，不能重复添加”），chips 仍为 2；同行人 `Mira Chen` 添加成功。
- **combobox aria**：`role=combobox`、`aria-expanded=true`、`aria-autocomplete=list`、`aria-haspopup=listbox`、`aria-controls` 指向 listbox、`aria-activedescendant` 随选项变化；loading 态 listbox 内 `role=status` 为“正在搜索…”，error 态含“重试”，degraded 态显示“搜索服务暂时降级，可手动填写。”，手动行选中后出现“手动地点 / 坐标为空 / aria-expanded=false”。
- **键盘**：焦点顺序 `trip-title → trip-summary → trip-status → trip-visibility → 封面上传按钮 → trip-start-date → trip-end-date → trip-origin → trip-destination-search → trip-destination-manual → trip-budget-amount → trip-budget-currency → trip-tags → 添加 → trip-guests → 取消/创建`，40 步内 29 个真实控件全部 `:focus-visible === true` 且 ring 非 none（`logs/focus-order.json`）。
- **响应式**：390/820/1440 × 创建/详情 共 6 组 `documentElement.scrollWidth === clientWidth`（`logs/responsive-overflow.jsonl`）。

## 附加发现（未阻断验收，建议修复）

1. **错误文案泄露底层实现**：places/search 失败时用户看到 `Unexpected token 'I', "Internal S"... is not valid JSON`（解析 Next 500 HTML 的异常消息）或 `API request to /v1/places/search failed with status 500`。应统一为面向用户的降级文案。
2. **空结果文案不可达**：`allowManual` 恒为 true 时 `showEmpty = ready && items.length === 0 && !showManualRow` 永不成立，`emptyLabel`（“没有匹配的结果”）不会出现；空结果只显示手动行。文案属于死代码。
3. **创建页日期默认今天**：`emptyTripFormValues()` 把 `startDate/endDate` 都设为今天；出发日期的 `max = endDate`，因此首次打开“出发日期”时所有未来日期都是 `aria-disabled`，用户必须**先**改结束日期。可用但反直觉，建议默认留空或交换限制逻辑。
4. **mock 能力清单**（供产品口径使用）：mock 模式支持 GET（me/workspaces/trips/members/entries/expenses/packing/stops/media/activity…）；**不支持** `POST /v1/workspaces/:id/trips`、`PATCH /v1/trips/:id`、`POST /v1/trips/:id/cover`、`/v1/places/search`、上传 presign/complete。上述能力在本轮只能“mock 不支持，需 api 模式或 staging”验证。

## 未覆盖 / 需 api 模式的项目

| 项 | 原因 |
| --- | --- |
| 创建/编辑的真实持久化与二次刷新 | mock 无对应写处理器 |
| `TripWorkspace` 7 tab（费用/分享/参与者/photos 工作台态）的组件级验收 | mock 路由走 legacy；需 `NEXT_PUBLIC_DATA_MODE=api` + API:4000 |
| 封面上传 presign → complete → 处理态 | mock 不支持 |
| 真实地点搜索（provider 结果、坐标、时区写入） | mock 无 `/v1/places/search`；本次仅用注入态验证 UI |

## 复现方式

```bash
cd C:/Users/BY9700/Desktop/UI/roamlog
pnpm --filter @roamlog/web dev                     # :3000, mock
npx playwright test --config=.audit/evidence/g3-ui/playwright.g3.config.ts
```

## 边界声明

本轮只写入：
- `.audit/evidence/g3-ui/**`（config、29 张截图、logs、test-results）
- `.audit/g3-ui-journeys-report.md`、`.audit/g3-ui-journeys-report.checkpoint.md`
- 新增 `e2e/g3/*.spec.ts`（8 个，新目录）

未改动任何产品代码、`playwright.config.ts`、既有 e2e；未跑 build；未触碰 3100/4100；未连生产；无 git 写操作。

CodeGraph 证据: `codegraph status` → `[OK] Index is up to date`（1,466 files / 22,522 nodes / 49,496 edges）；`codegraph explore "NewTripPage TripForm EditTripPage TripWorkspace TripDetailLive SharePage AppShell"` → 42 symbols / 8 files，动态派发链 `NewTripPage → NewTripShell → TripForm`、`EditTripPage → TripForm`、`TripDetailLive → TripWorkspace`；blast radius: `TripForm` 6 callers + `trip-form/__tests__`、`TripWorkspace` 5 callers + `trip-workspace/__tests__`，据此把旅程 1/4 定位到 `trip-form` 提交路径、旅程 5 定位到 `trip-detail-live → trip-workspace` 的唯一渲染入口（并据此确认 mock/legacy 分支事实）。