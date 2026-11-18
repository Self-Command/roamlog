# WEB_TOPBAR — Web 顶部工作栏真实化与头像溢出修复

状态: DONE
任务 ID: `WEB_TOPBAR`
角色: `web_frontend`
日期: 2026-11-18

## 1. 变更文件

全部位于允许范围内，未触碰 `apps/api/**`、`packages/**`、`apps/admin/**`、`apps/web/app/(app)/w/[workspaceSlug]/trips/**`、`apps/web/lib/demo-store*`、lockfile 或任何 `.audit` 之外的报告。

| 文件 | 类型 | 说明 |
|---|---|---|
| `apps/web/components/app-shell/app-shell-view.tsx` | 改 | 删除假 presence 头像组/假红点/假加号，改接真实 props |
| `apps/web/components/app-shell/workspace-app-shell.tsx` | 改 | 接 `useMembersQuery` / `useNotificationsQuery` |
| `apps/web/components/app-shell/topbar-members.tsx` | 新增 | 真实成员头像条（不重叠、中文 1 字、无在线点） |
| `apps/web/components/app-shell/notification-bell.tsx` | 新增 | 真实未读数红点，0 时完全不渲染 |
| `apps/web/components/app-shell/topbar-utils.ts` | 新增 | `initialsFor` / `roleLabelFor` / `cx` |
| `apps/web/components/app-shell/user-footer.tsx` | 改 | 移除当前用户头像的假"在线"绿点 |
| `apps/web/components/app-shell/command-palette.tsx` | 改 | 删除过期假文案"表单骨架将在本轮提供"与 `COMMAND PALETTE PLACEHOLDER` |
| `apps/web/components/app-shell/app-shell.test.tsx` | 改 | 13 个用例，覆盖真实性与可达性 |
| `.audit/web-topbar-report.checkpoint.md` | 新增 | checkpoint |
| `.audit/web-topbar-report.md` | 新增 | 本报告 |

未新增任何数据 hook：`useMembersQuery`（`apps/web/lib/query.ts:244`）与 `useNotificationsQuery`（`apps/web/lib/query.ts:210`）已存在，直接复用。

## 2. 实现摘要

### 2.1 删除的假数据

- **假在线头像**：删除 `app-shell-view.tsx` 中原 `AvatarGroup`；它把 `currentUser` 固定标为 `online: true`，另两人取 `trips[0].guestNames[0]` / `trips[1].guestNames[0]`，无数据时回退硬编码"同行者""编辑者"。
- **假 aria-label**：删除固定 `${Math.min(3, trips.length + 1)} 位协作者在线`。
- **假通知红点**：删除无条件渲染的固定 `<span class="bg-accent-orange">` 小点。
- **装饰性加号**：删除 `aria-label="快速新建"` 但只打开命令面板的 `IconButton`。
- **侧栏假在线**：`user-footer.tsx` 的 `<Avatar ... online />` 去掉 `online`（全仓无 Socket.IO presence 客户端）。
- **过期文案**：命令面板的"表单骨架将在本轮实现"与空态 `COMMAND PALETTE PLACEHOLDER` 徽章。

### 2.2 真实数据来源

```tsx
// workspace-app-shell.tsx
const MEMBER_STRIP_PARAMS = { limit: 24 };
const UNREAD_NOTIFICATIONS_PARAMS = { unreadOnly: true, limit: 20 };

const membersQuery = useMembersQuery(workspace?.id, MEMBER_STRIP_PARAMS);
const notificationsQuery = useNotificationsQuery(UNREAD_NOTIFICATIONS_PARAMS);
const topbarMembers = useMemo(
  () => (membersQuery.data?.items ?? []).filter((member) => member.status === "active"),
  [membersQuery.data],
);
const unreadNotificationCount = notificationsQuery.data?.items.length ?? 0;
```

- 成员：`WorkspaceMemberWithUser[]`，仅保留 `status === "active"`。
- 未读：`NotificationPage` 无 `unreadCount` 字段，因此用 `unreadOnly=true` 查询结果计数；`hasMore` 为真时徽章显示 `20+` 且 aria 读作"20 条以上未读"，不编造总数。
- 两个查询都不阻塞 shell：加载中 / 失败 / 空 → `members = []`、`unreadCount = 0` → 头像条与红点直接隐藏。

### 2.3 头像溢出与中文字形

根因有两层（见审计 `:15`）：

1. `AvatarGroup` 使用 `-space-x-2` 重叠 26px 头像；
2. `getInitials`（`packages/ui/src/lib/initials.ts:10`）对单段名取**前 2 个字**，中文名"同行者"→"同行"，两串字在重叠圆里连读成"同行编辑"。

`packages/ui` 为禁止修改范围（`AvatarGroup` 有 14 个调用方），因此在 `apps/web/components/app-shell/` 内自建头像条：

- 中文/日文/韩文：**只取 1 个字**（`initialsFor`）。
- 英文：单段取 1 个首字母，多段取首尾首字母（`Ada Lovelace` → `AL`）。
- 布局改为 `gap-1.5` 平铺，`24px` 固定尺寸，**不使用负 margin**，不重叠。
- 成员超过 `max=3` 时渲染 `+N` 徽章（`title` 注明"另有 N 位成员"）。
- 整个头像条是一个指向 `/w/<slug>/members` 的真实链接（补齐审计"不可点、无成员列表"的问题），带 `focus-visible` ring。
- 无实时通道 → 不渲染任何绿色在线点；`members` 为空时组件 `return null`。

### 2.4 加号改为真实入口

```tsx
<Button asChild variant="outline" className="hidden size-11 shrink-0 px-0 sm:inline-flex md:size-9">
  <Link href={`${workspaceRoot}/trips/new`} aria-label="新建旅行">
    <Plus aria-hidden="true" />
  </Link>
</Button>
```

路由真实存在：`apps/web/app/(app)/w/[workspaceSlug]/trips/new/page.tsx`。与 `MobileNav` 已有的 `quickAction`（`aria-label="新建旅行"`）指向同一路由。

### 2.5 命令面板

- **保留**搜索入口与 `⌘K` 提示，`aria-label="搜索或运行命令 ⌘K"`。
- 不再把它伪装成"创建"：加号已改为真实新建链接。
- 命令面板内"新建旅行"条目的 hint 由"表单骨架将在本轮提供"改为"打开新建旅行表单"。

### 2.6 响应式收敛（820 / 390）

- 头像组：`hidden md:flex`（≥768 显示），且 `members` 为空时整个槽位不渲染，不留空档。
- 新建入口：`hidden sm:inline-flex`（<640 隐藏，由 `MobileNav` 底部 FAB 承担同一真实路由）。
- 搜索按钮：移动端 `size-11 shrink-0 justify-center px-0`（不再是"很宽的只有放大镜的空按钮"，见审计 `:205`），`md+` 才展开为 `flex-1 max-w-64` 并显示文案与 `⌘K`。
- 面包屑工作区名：`max-w-36 sm:inline` → `max-w-28 lg:inline`，窄屏只留当前段并可截断。
- 头部 `gap-2 sm:gap-3`，全部控件 `shrink-0`，`nav` 保持 `min-w-0`。

**宽度预算（静态推算，非实测）**

- 390px（`px-4` → 358 可用）：菜单 44 + 搜索 44 + 铃铛 44 + 3×8 gap = 156，面包屑剩余 ~202px 截断 → 不溢出。
- 820px（`px-6` → 772 可用）：菜单 32 + 头像条 92（3×24+2×6+8）/ 最坏 122（含 `+N`）+ 铃铛 36 + 新建 36 + 5×12 gap = 256~286，搜索封顶 256，面包屑余量 ≥230 → 不溢出。

### 2.7 键盘与动效

- 所有顶栏控件（导航按钮、搜索、成员条、铃铛、新建）均有 `aria-label` 与 `focus-visible:ring-2`。
- 仅使用 `transition-colors`，无 `animate-*`，无动画依赖；reduced motion 下行为不变。

## 3. 验证命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm --filter @roamlog/web typecheck` | **PASS**，`✓ Types generated successfully`，无 TS 错误（exit 0） |
| `pnpm --filter @roamlog/web exec vitest run components/app-shell` | **PASS**，`Test Files 1 passed (1)`，`Tests 13 passed (13)` |
| `codegraph status` | `[OK] Index is up to date`（1,362 files / 20,159 nodes / 42,782 edges） |

> 说明：typecheck 第一次运行时曾在 `packages/api-mocks/src/fixtures.ts` 报 `TS1005 ';' expected`。该文件不在我的可写范围，其 mtime `19:01:36` 恰好等于该次 typecheck 执行时刻——是其他 agent 正在写入造成的半写状态。待其写完后原样重跑即 `exit 0`，未做任何改动。

### 3.1 静态检查（假数据清零）

```bash
cd apps/web/components/app-shell
# 1. 假在线 / 硬编码成员名
grep -rnE "guest-a|guest-b|同行者|编辑者|位协作者在线|协作者在线|online:\s*true" .
#  → 仅命中 app-shell.test.tsx（断言这些字符串"不存在"）与 topbar-members.tsx:25 文档注释
# 2. 固定未读数
grep -rnE "unreadCount\s*=\s*[0-9]|3 条未读" .
#  → 仅命中 app-shell.test.tsx:219 的断言
# 3. 装饰性加号
grep -rn "快速新建" .
#  → 仅命中 app-shell.test.tsx:119 的断言（要求该按钮不存在）
# 4. 过期占位文案
grep -rnE "表单骨架|PLACEHOLDER" .
#  → NO MATCH
# 5. 重叠头像组件
grep -rn "AvatarGroup" .
#  → 仅命中 topbar-members.tsx:22 文档注释
# 6. 在线绿点 token
grep -rn "accent-green" .
#  → NO MATCH
# 7. 由 guestNames 推导头像
grep -rn "guestNames" .
#  → NO MATCH
```

全仓范围（排除测试）：

```bash
grep -rnE "guest-a|guest-b|同行者|编辑者|位协作者在线" apps/web --include=*.tsx --include=*.ts \
  | grep -v "app-shell.test.tsx"
```

剩余 `同行者` 命中均为**正当中文文案**（"同行者的话"、"邀请同行者"、"一句话说明路线、季节和同行者"），不是假成员名，`apps/web/components/trips/**` 等区域也不在本轮可写范围内。

## 4. 截图 / 日志 / 接口证据

- **截图：未覆盖（诚实声明）。** `http://127.0.0.1:3000` 探测为 `HTTP 000`，`netstat` 在 3000/3001 无监听；本会话也没有浏览器自动化工具，且任务明确禁止新起端口。因此**未生成** `.audit/evidence/web-topbar/` 下任何图片，也没有伪造截图。
- 替代证据：上述静态宽度预算 + 13 个组件测试 + typecheck。
- 日志证据：typecheck / vitest 输出已摘录于第 3 节。
- 接口证据：数据来自既有 `DataAdapter.fetchMembers` / `fetchNotifications`（mock 与 real 适配器均已实现，`apps/web/lib/api/mock.ts:296`、`apps/web/lib/api/real.ts:290`），本轮未改接口、未改契约。

## 5. CodeGraph 证据

前置门禁：

```
codegraph status
→ [OK] Index is up to date   (1,339 files / 19,718 nodes / 41,594 edges)
```

查询 1：

```
codegraph explore "WorkspaceAppShell AppShellView user-footer top bar notification"
→ AppShellView (app-shell-view.tsx:41)，3 callers 全部在 workspace-app-shell.tsx；
  tests: app-shell.test.tsx
→ UserFooter (user-footer.tsx:10) / WorkspaceAppShell (workspace-app-shell.tsx:45)
→ blast radius: AvatarGroup (packages/ui/src/primitives/avatar.tsx:67) 有 14 callers
  ⇒ 不能改 packages/ui，改在 app-shell 内自建头像条
```

查询 2：

```
codegraph explore "useMembersQuery useNotificationsQuery unreadCount members list query"
→ 命中既有 useMembersQuery (apps/web/lib/query.ts:244)、useNotificationsQuery (apps/web/lib/query.ts:210)
→ 明确 "unreadCount Not in the index" ⇒ NotificationPage 无未读计数字段，只能用 unreadOnly 计数
⇒ 复用既有 hook，未新增 apps/web/lib 文件
```

查询 3：

```
codegraph explore "Avatar AvatarGroup ... NotificationPage ..."
→ getInitials (packages/ui/src/lib/initials.ts:10) 单段名 slice(0,2) ⇒ "同行者"→"同行"（根因）
→ AvatarGroup 使用 -space-x-2 重叠（根因）
→ NotificationPage = { items, nextCursor, hasMore }
```

改动后校验：

```
codegraph sync   → Synced 2 changed files / [OK] Index is up to date
codegraph explore "TopbarMembers NotificationBell initialsFor"
→ TopbarMembers (topbar-members.tsx:27) — 2 callers in app-shell-view.tsx
→ NotificationBell (notification-bell.tsx:20) — 2 callers in app-shell-view.tsx
→ initialsFor (topbar-utils.ts:21) — 3 callers；tests: app-shell.test.tsx
→ AppShellView → TopbarMembers / NotificationBell 动态渲染关系已建立
```

## 6. 已知风险

1. **未读数是"当前页"下界**：`NotificationPage` 无 total 字段，`limit: 20` 之外若还有未读，徽章显示 `20+`（aria 读"20 条以上未读"）。要精确总数需要后端新增 `unreadCount`，属本轮非目标。
2. **通知按用户而非按 workspace 计数**：`/v1/me/notifications` 是跨工作区收件箱，红点表示"我的未读"，与通知页一致，但与当前 workspace 未必一一对应。
3. **成员条最多显示 3 个**：更多成员以 `+N` 表示，链接到成员页。若产品要求"全部可见"需另行设计。
4. **每个 app 页面多两次查询**：成员与未读查询在 shell 层，`staleTime: 30s`；失败的查询静默降级为不显示，不会阻断页面。
5. **`<img>` 用于成员头像**：头像 URL 由租户上传，无法预先配置 `next/image` 的 `remotePatterns`，故用原生 `<img loading="lazy" alt="">` 并加 eslint 说明注释。
6. **`TopbarMembers.className` 用本地 `cx`（非 twMerge）**：若未来调用方传入与原语冲突的 display 类（如 `hidden`），需改为包裹层而非直接传参；当前调用已改为包裹 `<div>`，不再有冲突。

## 7. 未覆盖项

- **820×900 / 390×844 截图未采集**（原因见第 4 节：3000 端口未运行 + 无浏览器工具 + 禁止新起端口）。宽度结论来自静态推算与 Tailwind 断点，未做几何测量。
- 未做 axe / 对比度实测（`text-[9px]` 徽章对比度沿用既有 token）。
- 未跑全量 `next build`（任务明确要求不跑），未连生产服务器。
- 未处理顶栏以外的假 presence：`apps/web/components/trips/trip-card.tsx`、`dashboard-page.tsx` 仍由 `trip.status === "active"` 推导在线（审计 P2，不在本轮文件边界）。
- `apps/web/components/trip-detail/budget-tab.tsx:170` 仍有 `?? "同行者"` 与硬编码 `4 人均分`（不在本轮可写范围，仅记录）。

## 8. 建议的下一步

1. 由根 Agent 在预览可用时补 820×900、390×844 两张截图到 `.audit/evidence/web-topbar/`，并确认头像条与 `+N` 徽章在 768–1024 区间不与面包屑挤压。
2. 后端补 `unreadCount`（或 `GET /v1/me/notifications/unread-count`）以替换 `20+` 下界语义；这是唯一能让红点数字完全精确的方式。
3. 接入 Socket.IO presence 后，再在 `TopbarMembers` 增加受 `online` 驱动的绿点；在此之前保持无绿点。
4. 另开任务处理旅行卡/看板由 `trip.status` 推导在线的问题（审计 P2），与本轮共享同一"无 presence 不显示在线"原则。
