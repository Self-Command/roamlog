# 根 Agent 验收记录 — ADMIN_SHELL_TRUTH

任务 ID: ADMIN_SHELL_TRUTH
验收结论: **ACCEPT（条件：构建注入 NEXT_PUBLIC_APP_ENV）**
时间: 2026-11-18 21:30
交付: `.audit/admin-shell-truth-report.md`（208 行）

## 通过

| 项 | 结果 |
|---|---|
| 环境徽标 | 只从 `NEXT_PUBLIC_APP_ENV`（优先）→ `NODE_ENV` 推导；无来源返回 null 时徽标与 sidebar 环境区块**整体不渲染**；固定 `LOCAL` 已删除 |
| 2FA | `/v1/me` 无 `twoFactorEnabled` 且无 Admin 2FA 状态端点 → 删除 topbar「2FA GATED」、sidebar「2FA 已启用」、provider 硬编码；shell 内 0 个 2FA 徽标（登录页保留 `2FA REQUIRED` 访问策略文案） |
| 通知 | 确认无 Admin 运营通知 API → 删除铃铛、红点、固定「2 条未读」、抽屉组件与 state；`admin-notifications-sheet.tsx` 已删除，零残留引用 |
| 登出 | 真实 `POST /v1/auth/sign-out`（生成客户端 + `credentials:"include"`）；2xx/401 视为成功并跳 /login；≥400 显示「退出登录失败，当前会话仍然有效」且不跳转不清 Cookie；网络异常另有提示 → **不是假登出** |
| 登录页 | 默认邮箱为空；仅 `NEXT_PUBLIC_ADMIN_DEMO=1` 时预填并带 `DEMO PREFILL` 徽标 |
| 会话过期 | 401 → 记录 pathname+search → 跳登录带 returnTo；原路径只渲染「会话已过期」+ 兜底链接；登录路径防环；5xx → 「无法校验后台会话」+ 重试 |
| 测试 | admin typecheck exit 0；admin-shell + login 3 files / 15 tests 通过；eslint 无输出 |

静态检查：`LOCAL` 仅剩注释/断言与 `LOCAL QR`（真实语义）；`条未读`/`Bell`/`onOpenNotifications` 零命中；`lin.zhixia@roamlog.local` 零命中。

## 条件项

1. **构建必须注入 `NEXT_PUBLIC_APP_ENV`**：否则回退 `NODE_ENV`，生产构建的 staging 部署会显示 `PRODUCTION`（审计 P1-01 的困惑点）。属 devops/compose 范围，已记入发布门禁 G5。
2. fixture 数据模式仍在（默认），侧栏仍显示 fixture 身份「林知夏」；属 `admin-data-source.ts` owner 范围，后续 Admin fixture 下线任务处理。
3. 未跑 admin build、未做 staging E2E（登出成功/失败、过期 returnTo、无会话访问受保护页）→ G4/G5。

## 未覆盖

2FA 状态展示与运营通知中心：均无真实数据源，已按规则**移除而非伪造**。若产品需要，需先补后端端点：
- `GET /v1/admin/notifications` + read/read-all + 真实未读数
- `/v1/me` 或 admin 安全端点补 2FA 状态字段（并更新 OpenAPI/UserSchema）

## 剩余风险

- 生成类型未声明 401，sign-out 的「已登出」分支用 number 拓宽；后端若改路径需同步。
- 单测 mock 了 `useGetMe`；登出真实性靠真实客户端 + fetch 断言（URL/method/credentials）。