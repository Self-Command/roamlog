# WEB_TOPBAR — checkpoint

- 任务 ID: `WEB_TOPBAR`
- 角色: `web_frontend`
- 开始时间: 2026-11-18
- 状态: **DONE**（详见 `.audit/web-topbar-report.md`）

## 1. 前置门禁

- `codegraph status` → `[OK] Index is up to date`（1,339 files / 19,718 nodes / 41,594 edges）
- CodeGraph 查询 1：`codegraph_explore "WorkspaceAppShell AppShellView user-footer top bar notification"`
  - 命中 `AppShellView` (apps/web/components/app-shell/app-shell-view.tsx:41)，3 callers、tests: `app-shell.test.tsx`
  - 命中 `UserFooter` (user-footer.tsx:10)、`WorkspaceAppShell` (workspace-app-shell.tsx:45)
  - blast radius 确认 `AvatarGroup` (packages/ui/src/primitives/avatar.tsx:67) 有 14 callers → **不能改 packages/ui**，本次仅在 app-shell 内自建头像条
- CodeGraph 查询 2：`codegraph_explore "useMembersQuery useNotificationsQuery unreadCount ..."`
  - 既有 `useMembersQuery(workspaceId, params)` (apps/web/lib/query.ts:244)、`useNotificationsQuery(params)` (apps/web/lib/query.ts:210) → **复用，不新增 hook**
  - `unreadCount` 不在索引中 → `NotificationPage` 无未读总数字段
- CodeGraph 查询 3：`codegraph_explore "Avatar AvatarGroup ... NotificationPage"` + `getInitials`
  - 根因确认：`getInitials` (packages/ui/src/lib/initials.ts:10) 对单段名取 **2 字** → 中文名 "同行者"→"同行"
  - `AvatarGroup` 使用 `-space-x-2` 重叠 → "同行编辑" 视觉串

## 2. 已读审计条目

`.audit/2026-11-18-web-prod-audit.md` 第 1 节：

| 项 | 级别 | 根因 |
|---|---|---|
| "同…编辑" | P1 | `-space-x-2` 重叠 + 中文取 2 字 |
| 合作头像 | P1 | `trips[0]/[1].guestNames[0]` + 硬编码 "同行者/编辑者" |
| 头像组 aria-label | P1 | 固定 `${min(3, trips.length+1)} 位协作者在线` |
| 通知红点 | P1 | 无条件渲染 span，不读未读数 |
| 加号 | P2 | `aria-label="快速新建"` 但只开命令面板 |
| 工作栏整体 | P1 | `sm:flex` 640px 就显示头像组，820 更挤 |

## 3. 实施结果

1. ✅ 删除 `app-shell-view.tsx` 中硬编码 `AvatarGroup members` 三元组与假 aria-label。
2. ✅ 新增 `topbar-members.tsx`：真实成员头像条，不重叠、中文 1 字、无在线绿点、空则 `return null`。
3. ✅ 新增 `notification-bell.tsx`：红点仅在真实未读数 > 0 渲染，`hasMore` 时显示 `20+`。
4. ✅ `workspace-app-shell.tsx`：接 `useMembersQuery` / `useNotificationsQuery({unreadOnly:true,limit:20})`，失败/空不阻塞 shell。
5. ✅ 加号 → 真实 `<Link href="/w/<slug>/trips/new">`（路由已确认真实存在）。
6. ✅ 命令面板过期文案 "表单骨架将在本轮提供" / `COMMAND PALETTE PLACEHOLDER` 已删除，`⌘K` 入口保留。
7. ✅ 820px / 390px 布局收敛：头像组 `md+`、新建入口 `sm+`（390 由 MobileNav FAB 承担）。
8. ✅ 额外修复 `user-footer.tsx` 的假 `online` 绿点（同属 app-shell 范围）。

## 4. 验证

| 命令 | 结果 |
|---|---|
| `pnpm --filter @roamlog/web typecheck` | PASS（exit 0，无 TS 错误） |
| `pnpm --filter @roamlog/web exec vitest run components/app-shell` | PASS（13/13） |
| 静态假数据 grep | 源码 0 命中（仅测试断言与文档注释） |
| `codegraph sync` + `codegraph status` | `[OK] Index is up to date`（1,362 files / 20,159 nodes / 42,782 edges） |

## 5. 未覆盖

- 820×900 / 390×844 截图：3000 端口未运行、无浏览器工具、禁止新起端口 → 未采集，未伪造。
- 未跑全量 build，未连生产。
