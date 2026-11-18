# 根 Agent 验收记录 — WEB_TOPBAR

任务 ID: WEB_TOPBAR
验收结论: **ACCEPT（截图条件项）**
时间: 2026-11-18 19:55
交付: `.audit/web-topbar-report.md`

## 通过

- 假 presence 头像组、无条件红点、假协作者名（“同行者/编辑者”）、只开命令面板的加号，全部删除。
- 成员来自真实 `useMembersQuery`（仅 active），未读数来自 `useNotificationsQuery({unreadOnly:true})`；为空/失败直接隐藏，不回退假人。
- 中文头像 1 字（`initialsFor("同行者") === "同"`）、英文首字母；自建平铺 24px 头像条，无负 margin，超 3 人 +N；整条链接 `/w/<slug>/members`。
- 加号改为真实 `<Link href="/w/<slug>/trips/new">`，移动端由 FAB 承担同一路由。
- 静态检查：`accent-green`、`guestNames`、`快速新建`、`PLACEHOLDER` 在源码零命中（仅测试/注释）。
- `pnpm --filter @roamlog/web typecheck` exit 0；app-shell 13/13 通过。

## 条件项

1. 820×900 / 390×844 截图未覆盖（3000 未运行）。已单独派 `WEB_VISUAL_QA` 补拍与溢出量化。
2. 未读数是“当前页下界”（>20 显示 20+），因为 NotificationPage 无 `unreadCount`。记录为后续 API 小任务，不阻塞。
3. 顶栏外仍有由 `trip.status` 推导在线的假 presence（`trip-card.tsx`、`dashboard-page.tsx`），属 Wave 2 `web_shell` 范围。
4. 组件测试未覆盖 axe/对比度实测；视觉 QA 同轮补。

## 剩余风险

- 每页多两次 shell 查询（staleTime 30s，失败静默降级），可接受。
- 头像使用原生 `<img>`（租户 URL 无法预配 next/image），已注明原因。
