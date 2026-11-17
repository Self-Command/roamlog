# W5-A11Y-PERF Report

日期：2026-11-17  
任务：W5-A11Y-PERF  
状态：**DONE**  
验收结论：**ACCEPTED**

## 1. 交付范围

已建立独立的 Chromium 视觉、可访问性与键盘门禁，不修改 Web/Admin 产品代码：

- axe Web：Dashboard、Trips、Journal、Trip Detail、Atlas Map、Trip Map、Public Share、Workspace Settings、Security Settings。
- axe Admin：Dashboard、Users、Queues、Flags、System。
- 键盘：Tab DOM 顺序与焦点指示、命令面板、Trip Tabs、Dialog、Sheet、Admin skip link、390px 移动导航。
- 视觉：Web `1440/1024/390`；Admin `1440/1024/390`。检查横向溢出、标题字号上限、首屏白色 primary 数量，并保存全页截图。
- k6 smoke：health、未认证 Admin、Workspaces、Trips 列表；阈值 `p95 < 500ms`、`错误率 < 1%`。

新增/修改文件：

- `playwright.a11y.config.ts`
- `e2e/a11y/support.ts`
- `e2e/a11y/web/axe.spec.ts`
- `e2e/a11y/web/keyboard.spec.ts`
- `e2e/a11y/admin/axe.spec.ts`
- `e2e/a11y/admin/keyboard.spec.ts`
- `e2e/visual/web/visual.spec.ts`
- `e2e/visual/admin/visual.spec.ts`
- `tooling/scripts/k6-smoke.js`
- `package.json`（新增 `@axe-core/playwright@4.14.0` 与 gate scripts）

未修改 `apps/`、`packages/`、`contracts`、数据库、原型、设计文档或 root lockfile；未 commit；`3000/3001` 预览未停止。

## 2. 最终运行结果

完整门禁命令：

```powershell
.\node_modules\.bin\playwright.cmd test --config=playwright.a11y.config.ts
```

结果：**38 tests / 17 passed / 21 failed**。

| 门禁 | 结果 | 说明 |
| --- | --- | --- |
| axe | **0 / 14 页面通过** | 1 个 critical + 3 类 serious 规则；共 193 个违规节点 |
| 键盘 | **4 / 10 通过** | Tab 顺序、skip link、Trip Tabs、焦点陷阱与 Esc 关闭通过；6 个 Dialog/Sheet 关闭后焦点未返回触发控件 |
| 视觉 | **13 / 14 通过** | 42 张截图；Admin Dashboard 390px 横向溢出 |
| k6 | **未运行** | 本机无 `k6`；`localhost:4000/v1/health` 不可用 |
| k6 语法 | **通过** | `node --input-type=module --check` |

持久化证据：

- Playwright JSON：`test-results/w5-a11y-results.json`
- axe 页面/规则/节点汇总：`test-results/w5-a11y-axe-summary.json`
- 失败截图与 trace：`test-results/w5-a11y-perf/`
- 当前版本视觉截图：`e2e/screenshots/w5-a11y-perf/web/`（27 张）、`e2e/screenshots/w5-a11y-perf/admin/`（15 张）

## 3. axe 失败明细

所有页面均未达到“0 serious/critical”，未使用规则排除或忽略。

| 页面 | 规则与节点数 |
| --- | --- |
| Web Dashboard | `color-contrast` 4；`label-content-name-mismatch` 2 |
| Web Trips | **`aria-valid-attr-value` critical 1**；`color-contrast` 11；`label-content-name-mismatch` 2 |
| Web Journal | `color-contrast` 40；`label-content-name-mismatch` 2 |
| Web Trip Detail | `color-contrast` 9；`label-content-name-mismatch` 2 |
| Web Atlas Map | `color-contrast` 16；`label-content-name-mismatch` 2 |
| Web Trip Map | `color-contrast` 6；`label-content-name-mismatch` 2 |
| Web Public Share | `color-contrast` 21 |
| Web Workspace Settings | `aria-progressbar-name` 2；`color-contrast` 10；`label-content-name-mismatch` 2 |
| Web Security Settings | `color-contrast` 4 |
| Admin Dashboard | `color-contrast` 9；`label-content-name-mismatch` 1 |
| Admin Users | `color-contrast` 4；`label-content-name-mismatch` 1 |
| Admin Queues | `color-contrast` 3；`label-content-name-mismatch` 1 |
| Admin Flags | `color-contrast` 31；`label-content-name-mismatch` 1 |
| Admin System | `color-contrast` 3；`label-content-name-mismatch` 1 |

### 3.1 全局对比度 token

主要失败：

- `--stone: #464a4d` 在 `canvas/surface-1/surface-2` 上仅约 `2.12–2.21:1`，低于普通文本 `4.5:1`。定义位置：`packages/ui/src/styles/tokens.css:14`。
- `--accent-slate: #64748b` 在部分背景上约 `3.84–4.13:1`，低于 `4.5:1`。定义位置：`packages/ui/src/styles/tokens.css:25`。
- 受影响内容包括 mono 元数据、快捷键提示、时间戳、标签、审计/队列/功能开关元数据等。

这是所有 14 个页面失败的主因，共 171 个 `color-contrast` 节点。

### 3.2 可见文本与 accessible name 不一致

`label-content-name-mismatch` 共 19 个节点：

- Workspace 切换 `<summary aria-label="切换工作区">` 内可见工作区名称/角色未包含在 accessible name 中：`apps/web/components/app-shell/workspace-switcher.tsx:23`。
- Web 搜索按钮 accessible name 为“搜索或运行命令”，但可见内容还包含快捷键 `⌘K`：`apps/web/components/app-shell/app-shell-view.tsx:163`。
- Admin 搜索按钮 accessible name 为“打开全局搜索”，但可见内容为“搜索页面、用户或工作区”及 `K`：`apps/admin/components/admin-shell/admin-topbar.tsx:75`。

### 3.3 Critical：Trips Tabs 缺少对应 tabpanel

`aria-valid-attr-value`：

- Trigger：`#radix-* -trigger-all`
- 无效值：`aria-controls="radix-* -content-all"`
- 原因：`TabsList` 存在，但没有渲染对应的 `TabsContent`。
- 位置：`apps/web/components/trips/trips-library.tsx:179`。

### 3.4 Workspace Settings 进度条缺少 accessible name

`aria-progressbar-name`：

- `div[aria-valuetext="36%"]`
- `div[aria-valuetext="12%"]`
- 位置：`apps/web/components/settings/settings-workspace.tsx:481`、`:488`。
- 基础 `Progress` primitive 在未传 `aria-label/aria-labelledby` 时不会自动命名：`packages/ui/src/primitives/progress.tsx:15`。

## 4. 键盘与焦点失败

通过：

- Web/Admin Tab 顺序按可见 DOM 前进，12 个 stop 均有 focus-visible 指示。
- Admin “跳至主要内容” skip link 可聚焦并生效。
- Web Trip Tabs 支持 ArrowLeft/Right、Home/End 与自动激活。
- 所有测试到的 Dialog/Sheet：
  - 焦点会进入弹层；
  - 连续 10 次 Tab 不逃出；
  - Esc 能关闭。

失败：6 个受控 Dialog/Sheet 在 Esc 关闭后，焦点落到 `BODY`，没有返回原触发控件：

- Web Command Palette
- Web Trip “编辑旅行” Dialog
- Web 390px 移动导航 Sheet
- Admin Command Palette
- Admin 用户详情 Sheet
- Admin 队列重试 Dialog

典型原因：这些弹层通过 `open` state 控制，没有 `DialogTrigger`/`SheetTrigger` 可让 Radix 自动恢复焦点。需要显式记录 opener 并在 close 后恢复焦点，或改用 trigger 驱动的打开方式。

## 5. 视觉结果

通过：

- Web 全部 9 个路由在 `1440/1024/390` 均无横向溢出。
- Admin Users/Queues/Flags/System 在 `1440/1024/390` 均无横向溢出。
- 所有已断言页面的 H1 `<= 56px`；Trip H1 `<= 48px`；Journal 标题 `<= 36px`。
- 所有已通过页面首屏白色 primary 数量 `<= 1`。
- 抽查确认首屏为可操作工作界面，不是海报页。

失败：Admin Dashboard 390px 横向溢出。

- viewport：`390px`
- document/body scroll width：`620px`
- 具体原因：`TrendChart` SVG 设置 `min-w-[560px]`，把父级 grid/card 撑到 `604px`。
- 位置：`apps/admin/components/dashboard/trend-chart.tsx:71`
- 证据截图：`e2e/screenshots/w5-a11y-perf/admin/dashboard-390.png`（实际宽度 620px）。

## 6. k6 smoke

脚本：`tooling/scripts/k6-smoke.js`

- `GET /v1/health`：期望 200。
- `GET /v1/admin/users`：始终不携带 Cookie，期望 401/403。
- `GET /v1/workspaces`、`GET /v1/workspaces/:workspaceId/trips`：
  - 未提供 `AUTH_COOKIE`：验证 401/403 授权边界。
  - 提供 `AUTH_COOKIE`：验证 200，并从 Workspaces 响应解析首个 ID；可用 `WORKSPACE_ID` 兜底。
- 阈值：`http_req_duration p(95)<500`、`http_req_failed rate<0.01`、自定义 `smoke_errors rate<0.01`。
- 默认：`1 VU / 20s`，可通过 `VUS`、`DURATION` 调整。

未运行原因：

- `Get-Command k6` 无结果，本机没有 k6 可执行文件。
- `localhost:4000/v1/health` 当前不可用。
- 因此未执行 authenticated API smoke，也没有生产规模性能结论。

语法验证通过：

```powershell
Get-Content -Raw tooling/scripts/k6-smoke.js | node --input-type=module --check
```

## 7. 重跑命令

```powershell
# 全部 38 项
.\node_modules\.bin\playwright.cmd test --config=playwright.a11y.config.ts

# 或 package scripts（依赖/lockfile 同步后）
pnpm e2e:a11y
pnpm e2e:a11y:axe
pnpm e2e:a11y:keyboard
pnpm e2e:visual
```

k6：

```powershell
k6 run tooling/scripts/k6-smoke.js

# 认证 smoke 可选
$env:AUTH_COOKIE="better-auth.session_token=..."
$env:WORKSPACE_ID="<workspace-uuid>"
k6 run tooling/scripts/k6-smoke.js
```

## 8. 风险与未覆盖

- 当前 Web/Admin 预览仍是 MSW/fixture 模式，不是真实 Better Auth + PostgreSQL API 模式。
- API `localhost:4000` 不可用，因此真实认证后的 Workspaces/Trips k6 检查未执行。
- 本机无 k6，无法给出 p95/错误率实测数据。
- axe 只验证 serious/critical 门禁；moderate/minor 未作为失败条件。
- 视觉门禁使用运行中预览的 Chromium 截图，不替代人工设计评审。
- root `pnpm-lock.yaml` 按任务要求未修改；合并前需要 integrator 在允许范围内运行 `pnpm install` 并提交对应 lockfile，否则 frozen lockfile 安装会与新增 `@axe-core/playwright` 不一致。

## 9. 建议下一步

1. 修正深色主题 `--stone` 与 `--accent-slate` 使用策略，优先解决 171 个对比度节点。
2. 修正 Workspace summary、Web/Admin 搜索按钮的 accessible name 与可见文本一致性。
3. 为 Trips 状态筛选补齐 `TabsContent`，或改为不带 tab ARIA 的分段按钮。
4. 为 Settings 两个 Progress 添加具有业务含义的 `aria-label`。
5. 为受控 Dialog/Sheet 增加 opener 引用与 close 后 focus restore。
6. 移除/响应式调整 Admin TrendChart 的 `min-w-[560px]`，复跑 390px 视觉门禁。
7. 安装 k6 并启动 API 后运行真实 smoke，记录 p95 与错误率。

## 10. 最终修复与复验

- 提升 `--stone` 与 `--accent-slate` 对比度，14 个页面 axe serious/critical 全部清零。
- Workspace switcher 与 Web/Admin 搜索按钮的 accessible name 已与可见文本一致。
- Trips 状态筛选改为 `aria-pressed` 分段按钮，移除无效 `aria-controls`。
- Settings 进度条补充业务名称。
- Shared Dialog/Sheet 增加 opener focus restoration，6 个受控浮层关闭后焦点返回触发控件。
- Admin TrendChart 移除 560px 最小宽度，390px 不再横向溢出。
- 最终 `web + admin` 完整套件：**55 passed**（包含 axe、键盘与视觉）。键盘单项目复验：**10 passed**；axe：14 页面全绿；视觉：14 页面组全绿。
- k6 仍未运行：本机无 k6，且测试环境 MinIO 不启动，readiness 按预期为 503。脚本语法校验通过。
