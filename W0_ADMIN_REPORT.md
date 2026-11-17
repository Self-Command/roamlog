# W0-ADMIN-SHELL 交付报告

状态: DONE_WITH_CONCERNS
任务 ID: W0-ADMIN-SHELL
日期: 2026-11-17

## 变更文件

仅新增/删除 `apps/admin/**` 内文件，并新增本报告：

- `apps/admin/app/**`：Next.js App Router 根布局、`/login`、`/admin`、Users、Workspaces、
  Audit、loading、error、not-found 与 `/admin/login` 兼容跳转。
- `apps/admin/components/admin-shell/**`：固定 220px 侧栏、移动端 Sheet、面包屑、全局搜索、
  通知、环境徽标、身份/2FA 区和 mock 平台角色预览。
- `apps/admin/components/admin-ui/**`：筛选器、页面标题、状态徽标、批量选择条和破坏性确认 Dialog。
- `apps/admin/components/dashboard/**`：Metric cards、轻量 SVG 趋势图、队列与邮件健康。
- `apps/admin/components/users/**`、`workspaces/**`、`audit/**`、`login/**`：页面骨架、交互和测试。
- `apps/admin/lib/**`：合同类型 fixture、单一数据源适配器、mock 审计和格式化工具。
- `apps/admin/package.json`、`next.config.ts`、`postcss.config.mjs`、`tsconfig.json`、
  `vitest.config.ts`、`test/setup.ts`、`next-env.d.ts`、`README.md`。
- 删除占位文件 `apps/admin/.gitkeep`。
- 未修改 `apps/web/**`、`apps/api/**`、`apps/worker/**`、任何共享 package、root 配置、lockfile、
  Docker、CI、原型或设计文档。

## 实现摘要

### Runtime 与路由

- 独立 Admin Next.js 16.4.6 / React 19.3.1 / TypeScript / Tailwind CSS 4 应用，脚本绑定端口 `3001`。
- `/login`：独立极简登录占位，两阶段 credentials → TOTP；明确标注不会创建真实 session。
- `/admin`：平台总览，包含 6 个指标卡、12 日轻量 SVG 趋势、最近审计、队列和邮件健康。
- `/admin/users`：用户表格、搜索/状态/角色筛选、批量选择、详情 Sheet、角色守卫和确认动作。
- `/admin/workspaces`：Workspace 表格、搜索/状态/套餐筛选、批量选择、详情 Sheet 和确认动作。
- `/admin/audit`：只追加时间线、action/actor/日期筛选、权限受控 CSV fixture 导出。
- `/admin/login` 重定向到 `/login`；根 `/` 重定向到 `/admin`。
- 提供加载骨架、错误边界、404 和 skip-to-content 链接。

### Admin 壳与视觉

- 固定侧栏桌面 `220px`，移动端通过 Sheet 打开；侧栏包含分组导航、环境、身份、2FA 与角色预览。
- 顶部栏包含面包屑、搜索入口、环境徽标、通知和紧凑身份状态。
- 视觉沿用 `@roamlog/ui` tokens：纯黑 canvas、hairline、serif 标题、mono 元数据、低透明度氛围光。
- 高密度表格行高约 48px、控件 32–36px、移动触控目标 44px；表格容器内部横向滚动，避免页面溢出。
- 焦点环、Dialog title/description、表单 label、状态 live region 和 reduced-motion 均已处理。
- 每屏最多一个白色 primary 按钮；登录只有当前阶段一个 primary，其他页面为 ghost/outline/danger。

### 平台权限

- 直接复用 `canPlatform()`，没有在 Admin 内复制第二套权限矩阵。
- 危险操作始终可见；无权限时使用 disabled + title 说明，不隐藏。
- `support` 可暂停/恢复用户与 Workspace、强制登出，但不能改平台角色或删除。
- `analyst` 所有破坏性动作不可用，Audit CSV 导出可用。
- `admin` 可删除/恢复、重置 2FA；`super_admin` 独有平台角色修改。
- 破坏性动作必须输入目标名称；batch 操作输入选中数量。确认后只更新本地 fixture，并写入
  `roamlog.admin.mockAudit.v1`，Audit 页可显示最近本地模拟操作。

### 数据边界

- `lib/admin-data-source.ts` 是唯一消费点，当前返回 `fixtureAdminDataSource`。
- 页面和表格不直接依赖未来 API 形态；共享 `@roamlog/api-mocks` 就绪后替换该适配器即可。
- 实现开始时 `packages/api-mocks` 尚未落地；收口时该 package 已由并行任务出现，但目前只覆盖
  Web 身份/Workspace/旅行 fixture，没有 Admin metrics、users、Workspaces 或 audit fixtures。
  因此 Admin 未声明/消费该依赖，仍由本地 fixture 数据源提供数据。
- 选择角色和 mock 审计使用 `localStorage`，UI 中明确标注 fixture / mock，不宣称真实后端。

### 测试覆盖

- Admin 导航、分组、环境、身份、2FA 和 Ctrl/Cmd+K 全局搜索。
- 用户暂停操作的二次确认、目标名称门槛、mock 审计和行状态更新。
- `support` 可暂停但不可修改平台角色。
- `analyst` 的暂停、删除、改角色全部 disabled。
- Workspace 暂停确认、删除权限和 analyst 守卫。
- Audit 只读展示、导出权限和本地 mock 事件可见。
- Dashboard 指标、可访问趋势图、队列/邮件健康。
- 登录从 credentials 进入 2FA 阶段并触发完成回调。

## 新增依赖

已写入 `apps/admin/package.json`，但未执行安装、未更新 `pnpm-lock.yaml`：

- Runtime：`next@16.4.6`、`react@19.3.1`、`react-dom@19.3.1`、`lucide-react@1.74.0`、
  `@roamlog/ui@workspace:*`、`@roamlog/contracts@workspace:*`。
- Dev：Tailwind 4.3.5、`@tailwindcss/postcss@4.3.5`、Vitest 5.1.0、Testing Library、
  jsdom 31.0.1、TypeScript 5.9.3、React/Node 类型。
- 未添加 Recharts；当前趋势图是依赖更少的轻量 SVG 骨架。

## 验证命令与结果

### 1. TDD Red

初始测试在实现前失败，先因 Admin 依赖尚未链接无法解析 Testing Library，随后用本地临时路径映射后，
按预期因 `admin-shell`、`users-view`、`workspaces-view`、`audit-view`、`dashboard-view`、
`login-panel` 不存在而失败；实现后逐步转绿。临时验证文件已删除，未进入交付。

### 2. Component tests

```powershell
cd apps/admin
..\..\node_modules\.bin\vitest.cmd run --config vitest.preinstall.config.ts
```

结果：exit `0`；6 个测试文件、12 个测试全部通过。

说明：该临时配置复用了当前已安装的 UI package React/Testing Library 和 prototype 的 Next 类型；
它没有被保留。标准 `pnpm --filter @roamlog/admin test` 需根 Agent 安装依赖后执行。

### 3. TypeScript

```powershell
cd apps/admin
..\..\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.preinstall.json
```

结果：exit `0`，无输出。临时 tsconfig 映射了 workspace UI/contracts、prototype Next 16.4.6 类型和
已安装 React 类型；临时文件已删除。

直接使用标准 `tsconfig.json` 时，当前工作区会因 Admin 依赖尚未安装而无法解析 `next`、React 和
Testing Library；这不是源码类型错误。

### 4. ESLint

```powershell
cd apps/admin
..\..\node_modules\.bin\eslint.cmd .
```

结果：exit `0`，无输出。

### 5. Prettier

```powershell
.\node_modules\.bin\prettier.cmd --check "apps/admin/**/*.{ts,tsx,json,css,mjs,md}"
```

结果：exit `0`，`All matched files use Prettier code style!`

### 6. 文件边界

```powershell
git status --short -- apps/admin
git diff --check -- apps/admin
```

结果：仅 `apps/admin/**` 的预期新增和 `.gitkeep` 删除；无 whitespace error；无 root lockfile 或共享
package 改动。

## 未覆盖/风险

1. **未运行 Next build / dev / 路由 smoke**：Admin 依赖未链接，且未运行 `pnpm install`。
   因此不能声明 3001 端口运行、字体下载、Tailwind 实际产物或构建产物通过。
2. **无截图**：未生成 1440 / 1024 / 390 视觉截图；视觉、键盘和 axe 验收仍需 root/QA 执行。
3. **共享 Admin mocks 未就绪**：`@roamlog/api-mocks` package 已存在，但尚无 Admin 数据和 handler；
   当前数据仍是本地 fixture，消费点通过适配器预留。
4. **认证是占位**：没有 Better Auth session、真实 2FA 校验或服务端 Admin guard。当前 URL 可直接访问
   `/admin`，生产接入前必须由服务端强制鉴权与 2FA。
5. **平台角色预览是 mock**：角色存于 `localStorage`，只用于审查 UI 守卫，不构成授权边界。
6. **运营子页未实现**：邮件、队列、功能开关、系统健康在导航中明确标记 `SOON`，没有页面或真实动作。
   内容/媒体/评论运营也不在本任务范围。
7. **全局搜索是 fixture**：用户/Workspace 结果携带 query 参数，但页面尚未按该参数自动打开详情 Sheet。
8. **移动表格**：小屏使用表格内部横向滚动，没有转换为卡片行；需在 390px 视觉验收时确认可接受或安排返工。
9. **导航使用原生 `<a>`**：功能可用但不会获得 Next 客户端路由预取；后续可统一切换 `next/link`。
10. **SVG 趋势图**：符合轻量占位目标，但未使用 Recharts；若产品要求图表库一致性，需后续替换。
11. **未提交**：未执行 `git add` / `commit`，由根 Agent 统一安装、复验和提交。

## 建议下一步

1. 根 Agent 运行 `pnpm install`，更新并锁定 `pnpm-lock.yaml`。
2. 执行标准复验：

```powershell
pnpm --filter @roamlog/admin test
pnpm --filter @roamlog/admin typecheck
pnpm --filter @roamlog/admin build
```

3. 启动 Admin 并检查 `/login → /admin → Users → Workspaces → Audit`，验证 3001 端口、字体、
   Tailwind 产物、键盘路径和 Dialog 焦点。
4. 生成 1440 / 1024 / 390 截图，重点检查表格滚动、侧栏 Sheet、环境徽标、2FA 状态、单 primary 规则。
5. 共享 mocks 就绪后，把 `fixtureAdminDataSource` 替换为 MSW/API 适配器；在此之前保持 mock 标识。
6. 全栈认证落地时补服务端 admin guard、真实 2FA 强制跳转、CSRF/CORS 与审计写入。
