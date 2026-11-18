# ADMIN_SHELL_TRUTH — Admin Shell 真实性清理报告

状态: DONE
任务 ID: ADMIN_SHELL_TRUTH
仓库: `C:\Users\BY9700\Desktop\UI\roamlog`（admin_frontend 子任务）
日期: 2026-11-18

---

## 1. 变更文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `apps/admin/components/admin-shell/admin-environment.ts` | 新增 | 环境徽标唯一真实来源解析 |
| `apps/admin/components/admin-shell/admin-navigation.ts` | 新增 | 统一登录跳转，保留 returnTo |
| `apps/admin/components/admin-shell/admin-session-client.ts` | 新增 | 真实 Better Auth sign-out 调用与错误模型 |
| `apps/admin/components/admin-shell/admin-topbar.tsx` | 修改 | 删除铃铛、固定「2 条未读」、`2FA GATED`；环境徽标条件渲染 |
| `apps/admin/components/admin-shell/admin-sidebar.tsx` | 修改 | 删除固定 LOCAL / `2FA 已启用` / 假登录链接；真实登出按钮与错误提示 |
| `apps/admin/components/admin-shell/admin-shell.tsx` | 修改 | 移除通知抽屉挂载、`notificationsOpen`、`onOpenNotifications` |
| `apps/admin/components/admin-shell/mock-session-provider.tsx` | 修改 | 移除硬编码 `environment:"local"` / `twoFactorEnabled:false`；401 跳登录带 returnTo；上下文新增 `signOut` |
| `apps/admin/components/admin-shell/admin-notifications-sheet.tsx` | **删除** | fixture 通知唯一消费方，无真实数据源 |
| `apps/admin/components/login/login-panel.tsx` | 修改 | 移除 fixture 邮箱预填；`NEXT_PUBLIC_ADMIN_DEMO=1` 时才标注式预填；登录后尊重 returnTo |
| `apps/admin/lib/admin-paths.ts` | 修改 | 新增 returnTo 清洗与登录后路径 |
| `apps/admin/components/admin-shell/admin-shell.test.tsx` | 重写 | 8 例：无假徽标、真实环境、401 跳转、登出请求、登出失败、命令面板、路径函数 |
| `apps/admin/components/login/login-panel.test.tsx` | 重写 | 5 例：默认无预填、demo 预填、占位流程、API 2FA 流程、returnTo |
| `.audit/admin-shell-truth-report.checkpoint.md` | 新增 | 检查点 |
| `.audit/admin-shell-truth-report.md` | 新增 | 本报告 |

未触碰 P0 禁区：`apps/admin/components/dashboard/**`、`apps/admin/lib/admin-data-source.ts`、`apps/admin/app/admin/page.tsx`、`apps/admin/app/admin/audit/**`、`apps/api/**`、`packages/**`、`apps/web/**`、compose/deploy、lockfile、其他 `.audit` 文件；未执行 `git reset/clean/checkout/stash`，未提交，未 `pnpm install`，未连接生产。

---

## 2. 实现摘要（按任务要求逐条）

### 2.1 环境徽标（要求 1）
- 来源只有两处，均在构建时被 Next 内联：`NEXT_PUBLIC_APP_ENV` 优先，其次 `NODE_ENV`。
- `resolveAdminEnvironment()` 返回 `PRODUCTION | STAGING | DEVELOPMENT | 自定义大写 | null`；`null` 时 topbar 与 sidebar 都不渲染环境徽标（sidebar 的 `Environment` 区块整体不渲染）。
- 删除固定 `LOCAL` 兜底（代码中不再存在该字面量的渲染路径）。
- 未采用 `/v1/admin/system`：该接口在 `apps/api/src/modules/admin/admin-system.service.ts:26` 确实有 `environment`，但由 `components/system/**`（非本任务可写范围）消费，Admin Shell 自身不发起该请求；为避免引入新的跨组件事务与重复请求，按任务允许的 env 来源实现。风险见 §7。

### 2.2 2FA（要求 2）
- `useGetMe` → `GET /v1/me` 的 `UserSchema`（`packages/contracts/src/entities/user.ts`）**没有** `twoFactorEnabled`；`apps/api` 的 admin 用户控制器只提供「重置 2FA」写操作，没有 2FA 状态查询端点。
- 因此删除 topbar 的 `2FA GATED`、sidebar 的 `2FA 已启用`，以及 ApiSessionProvider 里硬编码的 `twoFactorEnabled: false`。
- 登录页 `2FA REQUIRED` 保留：它描述的是「管理员访问策略/登录流程会执行 TOTP 挑战」，是登录页的静态策略文案，不是会话状态徽标（P1-01 针对的是 shell 内伪造的 2FA 状态）。`two-factor-enrollment.tsx` 的 `LOCAL QR` 同理：表示二维码在本地生成，非环境徽标。
- `fixtures.ts` 的 `AdminSession` 仍带 `twoFactorEnabled` 字段（该文件不可写，其他任务负责），但 Admin Shell 不再读取或渲染它。

### 2.3 通知（要求 3）
- 结论：**没有 Admin 运营通知 API**。`packages/contracts/openapi.json` 只有用户个人通知 `/v1/me/notifications`、`/v1/me/notifications/{id}/read`、`/v1/me/notifications/read-all`；`apps/api` 无 admin notifications controller。
- 直接删除：铃铛按钮、红点、`aria-label="通知，2 条未读"`、`AdminNotificationsSheet` 组件文件、`admin-shell.tsx` 中的 state/挂载、`onOpenNotifications` prop。
- `fixtures.ts` 里的 `MOCK_ADMIN_NOTIFICATIONS` 仍存在（文件不可写），但**零消费者**；grep 见 §5。未保留任何「2 条未读」固定文案。

### 2.4 登出（要求 4）
- 真实端点已确认存在：Better Auth catch-all `apps/api/src/modules/auth/auth.controller.ts`（`@All("*path")`）转发到 Better Auth，`/v1/auth/sign-out` 已在 Web 端使用（`apps/web/lib/api/auth.ts:111`）；Admin 侧经 `apps/admin/app/v1/[...path]/route.ts` 同源代理，cookie 双向转发。
- 实现：`signOutAdminSession()` → `authPostHandler("sign-out", {}, { credentials: "include" })`（生成的真实客户端，`POST /v1/auth/sign-out`，`credentials: "include"`）。
  - 2xx 或 401（已无会话）视为成功 → `redirectToAdminLogin()` 跳转 `/login`；此时 API 已清除 httpOnly Better Auth cookie，重新加载即为未登录（fixture 模式则先清 localStorage 角色预览并重置本地 session）。
  - 其他 ≥400 抛 `AdminSignOutError(status)` → sidebar 以 `role="alert"` 显示 `退出登录失败（HTTP 500），当前会话仍然有效。`，不跳转、不清 Cookie。
  - 网络异常 → `status 0`，提示无法连接认证服务。
- 改动前是 `<Link href="/login">返回登录占位</Link>`，不调用后端、不清 Cookie。
- 因此**不构成 BLOCKED**：后端能力存在，前端已接真实请求。

### 2.5 登录页预填（要求 5）
- 默认 `email` 初始值为 `""`，不再出现 `lin.zhixia@roamlog.local`。
- 仅当显式 `NEXT_PUBLIC_ADMIN_DEMO === "1"`：预填 `demo@roamlog.local`，并在页头显示 `DEMO PREFILL` 徽标、邮箱字段 hint 明示 `已通过 NEXT_PUBLIC_ADMIN_DEMO=1 预填演示邮箱，请勿用于生产`。
- 登录/2FA 成功后使用 `getAdminPostLoginPath(returnTo)`：清洗 `returnTo` 后跳转，默认 `/admin`。

### 2.6 会话过期（要求 6）
- `ApiSessionProvider` 基于 `useGetMe`：
  - `data.status === 401` → `unauthenticated`，effect 记录 `pathname + search` 并调用 `redirectToAdminLogin(returnTo)`；原路径不再渲染任何假内容，只渲染「会话已过期」说明 + 「继续前往登录」兜底链接。
  - 不重复跳转：effect 仅在 `unauthenticated` 为真时触发；当前路径已是登录路径时直接跳过，防止 guard 被复用到登录页时形成环。
  - 查询失败（网络/5xx）→ 「无法校验后台会话」+ 重试按钮（`refetch`），不伪造已登录，也不误清 Cookie。
  - 403/其他 ≥400 → 权限/错误卡片；`role === "user"` → 无权访问卡片。
- `/admin/login` 不在 `AdminConsoleLayout` 的 shell 内（`apps/admin/components/admin-shell/admin-console-layout.tsx`），不会形成重定向环。

### 2.7 测试（要求 7）
见 §4，覆盖：无假徽标、fixture 通知不再渲染、未登录跳转并携带 returnTo、登出真实请求、登出失败提示；测试对 `@roamlog/api-client` 只 mock `useGetMe` 以驱动会话状态，登出路径使用**真实生成客户端 + stub 的全局 `fetch`**，并断言 URL/方法/credentials，未 mock 业务请求逻辑。

---

## 3. 关键代码位置

- 环境解析：`apps/admin/components/admin-shell/admin-environment.ts:26`
- 跳转封装：`apps/admin/components/admin-shell/admin-navigation.ts:7`
- sign-out 调用：`apps/admin/components/admin-shell/admin-session-client.ts:18`
- 401 跳转 effect：`apps/admin/components/admin-shell/mock-session-provider.tsx`（`ApiSessionProvider` 内 `useEffect`）
- 登出按钮/错误：`apps/admin/components/admin-shell/admin-sidebar.tsx`（`handleSignOut`）
- 环境徽标渲染：`apps/admin/components/admin-shell/admin-topbar.tsx`、`admin-sidebar.tsx`
- returnTo 清洗：`apps/admin/lib/admin-paths.ts:16`（`sanitizeAdminReturnTo`）

---

## 4. 验证命令与结果

```bash
# 1) 类型检查
pnpm --filter @roamlog/admin typecheck
$ tsc --noEmit
# exit code 0

# 2) 指定测试
pnpm --filter @roamlog/admin exec vitest run components/admin-shell components/login
#  Test Files  3 passed (3)
#       Tests  15 passed (15)
#   ✓ components/admin-shell/admin-shell.test.tsx (8 tests)
#   ✓ components/login/login-panel.test.tsx (5 tests)
#   ✓ components/login/two-factor-enrollment.test.tsx (2 tests)

# 3) Lint（仅变更范围）
pnpm --filter @roamlog/admin exec eslint components/admin-shell components/login lib/admin-paths.ts
# 无输出，exit code 0
```

测试用例清单（admin-shell.test.tsx）：
1. 渲染导航与身份，且无 `LOCAL`、无 2FA 徽标、无通知铃铛/未读数；
2. `NEXT_PUBLIC_APP_ENV=staging` → 显示 `STAGING`，不显示 `LOCAL`；
3. API 模式渲染真实 `useGetMe` 身份（admin 角色锁定、无 2FA/通知入口）；
4. 401 → `redirectToAdminLogin("/admin/users?status=active")`，并断言登录链接 href 编码正确；
5. 登出成功 → `fetch("/v1/auth/sign-out", { method:"POST", credentials:"include" })` 且发生跳转；
6. 登出 500 → `role="alert"` 显示 HTTP 500 与「当前会话仍然有效」，不跳转、身份仍在；
7. 命令面板快捷键仍可用；
8. 路径函数：`/login?returnTo=%2Fadmin%2Fusers`、拒绝 `//evil.example` 与绝对 URL、`getAdminPostLoginPath("//evil.example/admin") === "/admin"`。

login-panel.test.tsx：默认邮箱为空、仅 `NEXT_PUBLIC_ADMIN_DEMO=1` 预填并标注、fixture 两步流程、API 两步流程（`signIn` 收到用户实际输入而非 fixture 邮箱）、returnTo 清洗。

---

## 5. 静态检查（grep 命令与结果）

```bash
# 固定 LOCAL 徽标
grep -rn "LOCAL" apps/admin/components/admin-shell apps/admin/components/login
# 命中仅：注释/测试断言；`admin-environment.ts:11` 注释「旧 shell 硬编码 LOCAL」；
# `login/two-factor-enrollment.tsx:177` 的 "LOCAL QR"（本地生成二维码，非环境徽标）。
# 渲染路径中不存在固定 LOCAL 环境徽标。

# 2FA 徽标
grep -rn "2FA GATED\|2FA active\|2FA 已启用\|>2FA" apps/admin/components
# 唯一命中：apps/admin/components/login/login-panel.tsx:302 的 <Badge>2FA REQUIRED</Badge>
# —— 登录页访问策略文案，不是会话状态；shell 内 0 命中。

# fixture 通知与未读数
grep -rn "MOCK_ADMIN_NOTIFICATIONS\|条未读\|onOpenNotifications\|AdminNotificationsSheet\|Bell" apps/admin/components apps/admin/lib
# 无命中（仅 fixtures.ts 仍导出未使用的 MOCK_ADMIN_NOTIFICATIONS；无任何 import/引用）

# 固定「2 条未读」
grep -rn "2 条未读\|条未读" apps/admin/components
# 无命中

# 登录页 fixture 邮箱预填
grep -rn "lin.zhixia@roamlog.local" apps/admin/components
# NO MATCH（该 fixture 身份仅存在于不可写的 lib/fixtures.ts）

# 旧硬编码会话字段
grep -rn "session\.environment\|session\.twoFactorEnabled" apps/admin/components
# NO MATCH
```

补充：通知抽屉删除后 `grep -rn "AdminNotificationsSheet" apps/admin` 无结果；`apps/admin/app` 下无该组件引用。

---

## 6. CodeGraph 证据

```
$ codegraph status
[OK] Index is up to date   （1,364 files / 20,178 nodes；watcher 已增量同步新增/删除文件）

$ codegraph explore "MockSessionProvider ApiSessionProvider FixtureSessionProvider AdminTopbar AdminSidebar admin-notifications-sheet"
# 28 symbols / 7 files / 47 edges；动态分发链
# AdminShell → MockSessionProvider → (Fixture|Api)SessionProvider → AdminSidebar/AdminTopbar
# 证明：AdminTopbar/Sidebar 均从 context 取 session，原先的 LOCAL/2FA/通知均来自 context/fixture。

$ codegraph explore "signOutAdminSession SignIn authPostHandler getAuthPostHandlerUrl resolveAdminEnvironment redirectToAdminLogin"
# Found 70 symbols across 8 files
# 调用链：signOutAdminSession → authPostHandler → getAuthPostHandlerUrl
# blast radius：signOutAdminSession 2 callers（mock-session-provider）、redirectToAdminLogin 4 callers
# 证明：登出走生成客户端的真实 `POST /v1/auth/${path}`，非本地假动作。
```

---

## 7. 已知风险

1. **`NEXT_PUBLIC_APP_ENV` 未在部署构建中注入**时，回退 `NODE_ENV`；生产构建的 staging 部署会显示 `PRODUCTION`（审计 P1-01 的原始困惑点）。修复方向属于 devops/compose 任务：在 staging 构建时注入 `NEXT_PUBLIC_APP_ENV=staging`。本任务不可写 compose/deploy，已在 §9 提为下一步。
2. sign-out 的 401 不在生成的响应联合类型里（OpenAPI 未声明），已用 `const status: number` 拓宽处理；若后端改路径/契约，需同步 `authPostHandler("sign-out")` 与生成类型。
3. 若未来新增 Admin 通知 API，需要重新引入入口并接真实未读/已读 mutation；当前删除为正确选择，但运营侧会失去一个（本来也是假的）入口。
4. fixture 数据模式仍存在（`NEXT_PUBLIC_ADMIN_DATA_MODE=fixture` 默认），其 fixture 身份（林知夏）仍会在侧栏显示；这属于 `admin-data-source.ts` / 数据源 owner 的范围，本任务只移除登录页预填与 shell 假徽标。fixture 模式下的登出按钮文案为「退出本地预览」，避免冒充真实登出。
5. `AdminSession` 类型仍要求 `twoFactorEnabled`/`environment` 字段（`lib/fixtures.ts` 不可写），provider 从 `initialSession` 继承但从不读取；若后续清理类型，可删除这两个字段。
6. 测试层面 `useGetMe` 被 mock 以驱动状态；未做真实 API 集成测试（禁止连生产，未启动 API）。登出请求的真实性由「真实生成客户端 + fetch 断言」保证。

---

## 8. 未覆盖项

- 未执行 `next build`（任务禁止 admin build，留给集成/QA 阶段）。
- 未对 staging 做端到端登出/过期验证（无可用测试服，且禁止连接生产）。
- 未验证真实浏览器中 `window.location.assign` 的时序（jsdom 不实现导航，测试通过注入的 `redirectToAdminLogin` 接缝 + 纯函数断言覆盖，浏览器行为等同标准 `location.assign`）。
- 未新增 2FA 状态展示（无真实来源）；未新增通知中心（无 Admin API）。
- 未修改 `apps/admin/lib/fixtures.ts` 中残留的 `MOCK_ADMIN_NOTIFICATIONS`（不在可写范围）。

---

## 9. 建议的下一步

1. **devops**：在 staging/production 构建参数中显式注入 `NEXT_PUBLIC_APP_ENV`（`staging`/`production`），并在 CI 校验该值，消除 NODE_ENV 回退歧义。
2. **backend_api**：如需运营通知，新增 `GET /v1/admin/notifications` 与 `POST /v1/admin/notifications/{id}/read`、`/read-all`，返回真实未读数；前端再恢复铃铛与抽屉（含错误态）。
3. **backend_api + contracts**：若确需在 shell 显示 2FA 状态，在 `/v1/me` 增加 `twoFactorEnabled`（或在 admin 安全端点暴露），并更新 `UserSchema`/OpenAPI；否则维持不显示。
4. **qa_verifier**：在 staging 上执行登出成功/失败、会话过期 returnTo、无会话访问 `/admin/users` 的 E2E，并保存网络日志。
5. **admin_frontend（后续任务）**：清理 fixture 模式下的 demo 身份展示，让 `admin-data-source.ts` 的 fixture 标记更明确，或彻底下线 fixture 模式。
