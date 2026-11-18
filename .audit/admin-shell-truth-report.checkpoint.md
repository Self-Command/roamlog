# ADMIN_SHELL_TRUTH — Checkpoint

- 任务: 清除 Admin Shell 假环境徽标 / 假 2FA / fixture 通知 / 假登出 / 登录页 fixture 预填
- 仓库: C:\Users\BY9700\Desktop\UI\roamlog
- 状态: DONE（验证通过）

## 门禁
- `codegraph status` → `[OK] Index is up to date`（Files 1,364 / Nodes 20,178）
- `codegraph explore "MockSessionProvider ApiSessionProvider FixtureSessionProvider AdminTopbar AdminSidebar admin-notifications-sheet"` 已执行
- 已读 `.audit/2026-11-18-admin-prod-audit.md` P1-01 / P1-02 / P1-07 / §6

## 已完成变更（均在允许目录内）
1. 新增 `apps/admin/components/admin-shell/admin-environment.ts`：环境只取 `NEXT_PUBLIC_APP_ENV` → `NODE_ENV`，无来源返回 null（不渲染），无 LOCAL 兜底。
2. 新增 `apps/admin/components/admin-shell/admin-session-client.ts`：真实 `POST /v1/auth/sign-out`（生成的 `authPostHandler`），失败抛 `AdminSignOutError`。
3. 新增 `apps/admin/components/admin-shell/admin-navigation.ts`：登录跳转统一入口，携带 returnTo。
4. `admin-topbar.tsx`：删除铃铛 / 固定 2 条未读 / `2FA GATED`；环境徽标改为真实来源，无来源不渲染。
5. `admin-sidebar.tsx`：删除 `Environment` 固定 LOCAL 与 `2FA 已启用`；`返回登录占位` 改为真实登出按钮（pending / 错误提示）。
6. `admin-shell.tsx`：移除通知抽屉挂载与 state。
7. 删除 `admin-notifications-sheet.tsx`（fixture 通知唯一消费方）。
8. `mock-session-provider.tsx`：401 自动跳登录并带 returnTo；移除 `environment: "local"` / `twoFactorEnabled: false` 硬编码；上下文新增 `signOut`。
9. `login-panel.tsx`：默认不预填；仅 `NEXT_PUBLIC_ADMIN_DEMO=1` 预填并显式标注；登录后尊重 returnTo。
10. `admin-paths.ts`：新增 `sanitizeAdminReturnTo` / `getAdminLoginPathWithReturnTo` / `getAdminPostLoginPath`（拒绝 `//` 与绝对 URL）。
11. 测试更新：`admin-shell.test.tsx`（8 例）、`login-panel.test.tsx`（5 例）。

## 验证
- `pnpm --filter @roamlog/admin typecheck` → exit 0
- `pnpm --filter @roamlog/admin exec vitest run components/admin-shell components/login` → 3 files / 15 tests passed
- `eslint components/admin-shell components/login lib/admin-paths.ts` → 无输出
- 静态 grep：无固定 LOCAL 徽标、无 2FA 徽标、无 MOCK_ADMIN_NOTIFICATIONS 使用、无「条未读」、无 fixture 邮箱预填

## 未完成 / 风险
- 未跑 admin build（按要求留给集成阶段）；未连生产。
- `NEXT_PUBLIC_APP_ENV` 需部署构建时注入，否则回退 NODE_ENV=production（staging 会显示 PRODUCTION）。
- 2FA 状态无真实来源（`UserSchema` 不含 twoFactorEnabled，无 Admin 2FA 状态接口），已整体移除。
- 无 Admin 通知 API，已移除入口；`/v1/me/notifications` 是用户个人通知，不是运营通知。
