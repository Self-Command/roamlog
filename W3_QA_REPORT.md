# W3-QA-E2E Report

状态: NEEDS_REVIEW

任务 ID: W3-QA-E2E

## 变更文件

- `playwright.config.ts`
- `e2e/support/fixtures.ts`
- `e2e/support/helpers.ts`
- `e2e/web/dashboard.spec.ts`
- `e2e/web/trips.spec.ts`
- `e2e/web/journal.spec.ts`
- `e2e/web/planning.spec.ts`
- `e2e/web/members.spec.ts`
- `e2e/web/mobile.spec.ts`
- `e2e/admin/login.spec.ts`
- `e2e/admin/queues.spec.ts`
- `e2e/admin/flags.spec.ts`
- `e2e/admin/content.spec.ts`
- `e2e/admin/roles.spec.ts`
- `e2e/admin/responsive.spec.ts`
- `e2e/api/smoke.spec.ts`
- `package.json`：新增 Playwright scripts 与 `@playwright/test` devDependency。
- `.gitignore`：新增 `e2e/screenshots/`。
- `pnpm-lock.yaml`：见下方“依赖与边界”说明。

未修改 `apps/**`、`packages/**`、`docker/**`、CI、contracts、数据库、原型或设计文档。工作区中同时存在其他 Agent 的改动，我没有触碰这些文件。

## 实现摘要

- Playwright 配置默认 Web `http://localhost:3000`、Admin `http://localhost:3001`、API `http://localhost:4000`。
- 本地复用已运行的 Web/Admin dev server；CI 下由 `webServer` 启动。`E2E_SKIP_WEB_SERVER=1` / `E2E_SKIP_ADMIN_SERVER=1` 可用于隔离快跑。
- API 不默认自动启动。设置 `E2E_START_API=1` 时由 `webServer` 启动；否则 API smoke 在端口不可达时明确 skip。
- 19 个测试：Web 9 个、Admin 8 个、API 2 个。
- 浏览器 console warning/error 与 `pageerror` 自动收集并导致失败；仅忽略匹配 `/Cross origin request detected/i` 的 Next dev HMR cross-origin 警告，并把被忽略项附到测试报告。
- 截图统一输出到 `e2e/screenshots/`，该目录已 gitignore。

## 依赖与环境

- 最初检查时根 `node_modules` 无 `@playwright/test`。执行 `pnpm exec prettier` 时 pnpm 自动解析并安装了 `@playwright/test@1.65.0`，因此 `pnpm-lock.yaml` 也被更新。没有显式执行 `pnpm install`。
- `pnpm-lock.yaml` 不在原任务可写清单内；未回滚是因为工作区同时存在其他 Agent 对 lockfile 的依赖变更，回滚会覆盖并发改动。请根 Agent 确认并纳入集成。
- Playwright 浏览器已存在：`chromium-1254`、`chromium_headless_shell-1254`。
- API `4000` 未运行，因此 2 个 API smoke 被 skip；没有启动 API，也没有停止 `3000/3001` 预览。

## 验证命令与结果

```text
pnpm exec playwright test
17 passed, 2 skipped (23.9s)
```

分项目结果：

```text
pnpm exec playwright test --project=web
9 passed (15.9s)

pnpm exec playwright test --project=admin
8 passed (full run)

pnpm exec playwright test --project=api
2 skipped (API not running)
```

格式化：

```text
pnpm exec prettier --check package.json playwright.config.ts "e2e/**/*.ts"
All matched files use Prettier code style!
git diff --check
(no output)
```

API skip 原因：

```text
API is not running. Start it with `pnpm --filter @roamlog/api dev` or set E2E_START_API=1.
```

## 覆盖范围

Web：

- Dashboard 渲染、统计卡、下一趟旅行、最近整理与预算分布。
- Trips 文本搜索、状态筛选、筛选结果计数。
- Trip detail Overview / Journal / Itinerary / Budget / Packing Tabs。
- Journal 搜索筛选、打开详情 Sheet、填写并发送评论。
- Itinerary 勾选完成、新增行程。
- Budget 新增花费。
- Packing 勾选打包。
- Members 邀请、角色变更、撤销邀请。
- 390px 下 Dashboard、Trips、Trip detail、Journal、Members 无横向溢出。

Admin：

- Login placeholder 两步本地流程。
- Queues retry 二次确认、精确 job ID 校验、成功状态与行消失。
- Flags rollout 通过真实键盘操作修改并保存。
- Content 软删除与恢复二次确认。
- Analyst Content 删除/恢复禁用；Support 可暂停用户但不可删除或修改平台角色。
- 1440px 与 1024px 下 Login、Dashboard、Queues、Flags、Content、Users 无页面横向溢出。

截图：

- Web 12 张：1440px 关键交互 + 390px 五个核心路由。
- Admin 15 张：1440/1024 关键路由、Analyst/Support 权限状态。
- 已人工抽查 `web-1440-dashboard.png`、`web-390-trip-detail.png`、`web-1440-journal-sheet.png`、`admin-1440-dashboard.png`、`admin-1024-queues.png`、`admin-1440-flags.png`；布局为真实工作型 UI，未发现页面横向溢出。

未覆盖：

- API 实际 200/401 smoke 尚未运行。
- 真实认证、数据库、Redis、Worker、S3、Resend、WebSocket、上传与公开分享。
- axe、键盘焦点顺序、Dialog 焦点陷阱、视觉回归基线、安全与负载测试。
- Admin 390px 移动端（任务只要求 1440/1024）。

## 已知风险

- 当前 Web 仍以 MSW/demo state 为主，E2E 证明的是当前本地演示交互，不代表真实后端链路。
- API smoke 未执行，`/v1/health` 200 与未认证 `/v1/admin/metrics` 401 仍缺少本轮运行证据。
- `pnpm-lock.yaml` 与 `package.json` 的改动需要根 Agent 审核，避免与并行 Agent 的依赖集成冲突。
- Console guard 只忽略 Next dev 的 cross-origin HMR 警告；其他 warning/error 都会失败，后续若出现新的已知开发噪声需显式登记。
- 测试会修改每页独立 browser context 内的 localStorage；不会污染 `3000/3001` 的用户预览会话。

## 建议的下一步

1. 根 Agent 审核 `pnpm-lock.yaml` 与 `@playwright/test` 依赖归属。
2. 启动 API 依赖后运行 `pnpm exec playwright test --project=api`；CI 可用 `E2E_START_API=1 pnpm exec playwright test --project=api`。
3. 接入 CI release gate，保留 `playwright-report/` 与 `e2e/screenshots/` 为构建产物。
4. 下一轮补 axe、键盘焦点、公开分享、WebSocket presence、上传与版本冲突 E2E。

未 commit。
