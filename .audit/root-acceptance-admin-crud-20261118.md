# 根 Agent 验收记录 — ADMIN_CRUD

任务 ID: ADMIN_CRUD
验收结论: **ACCEPT（条件：dedicated export 权限、CSV 审计、截图）**
时间: 2026-11-18 22:00

## 根 Agent 亲自主持的串行操作（共享生成物）

Agent 无法自行重新生成（并发约束），由我执行：

```
pnpm contracts:generate   → Wrote 94 paths and 203 schemas (92 → 94，新增 2 个 export 端点)
pnpm api-client:generate  → orval 完成
pnpm contracts:check      → OpenAPI fresh: 94 paths, 203 schemas
                          → API client fresh: 23 endpoint files, 609 schemas (593 → 609)
```

生成后复验：`admin typecheck` **0 错误**；`admin test` **16 files / 64 tests 全通过**。

## 通过

### 契约（我先批准再由其实现）
- `AdminUserPage` items 增可选 `activeSessionCount`；`AdminUserDetail` 增 `twoFactorEnabled`/`commentCount`/`mediaCount`/`workspaces[]`/`sessions[]`（可选，fixture 仍合法）。
- `AdminWorkspacePage` items 增 `owner` + 成员/旅行/日志/媒体计数 + `mediaBytes`；`AdminWorkspaceDetail` 增 `mediaCount`/`mediaBytes`/`members[]`/`invitations[]`。
- 新增 export query + CSV response schema。

### API
- 服务端搜索（用户：name/email/workspace 名与 slug；工作区：name/slug）、status/role/plan/sort 过滤、**真实 cursor 分页**。
- 真实用户详情（计数、2FA、带角色的成员关系、活跃会话）；工作区 owner/指标、成员与邀请详情、媒体字节数。
- 流式 CSV `GET /v1/admin/users/export`、`/v1/admin/workspaces/export`：遵守筛选、BOM/CRLF/**公式注入防护**/50k 上限、**首个校验通过的 chunk 之后才发 header**。

### Admin UI
- 用户/工作区改为服务端驱动（搜索 + 过滤 + cursor 前后翻页 + sessionStorage 保留筛选）、真实详情拉取、错误与重试分支、**真实 CSV 导出**（fixture 模式导出真实预览 CSV）。
- 工作区套餐变更 + 所有权转移走真实 PATCH + 确认框；所有既有 mutation 接通。
- **删除**了原先 disabled 的「导出接口将在运营 Wave 接入」死按钮。
- 声称「无死按钮残留，角色禁用控件均有 title 说明」。

### 测试
- admin users 9 + workspaces 8 = 17；admin 全量 64 通过。
- API admin 10 files / 72 通过；`admin-routes.e2e-spec.ts` **26 通过**，含 export 200/401/403，并证明 export 路由**未被 `:id` 吞掉**（这个回归点抓得好）。

## 边界偏差裁定

| 偏差 | 裁定 | 理由 |
|---|---|---|
| 改 `packages/contracts/scripts/openapi/paths-admin.ts` | **批准** | 不加则 OpenAPI/client 无法包含 export 端点，属必要；且已由我重新生成并校验 fresh |

## 条件项 / 风险

1. **导出权限复用了 `admin:users:delete` / `admin:workspaces:delete`**：语义错配（导出不是删除）。建议后续新增 dedicated `admin:users:export` / `admin:workspaces:export` action 并更新权限矩阵。
2. **CSV 导出未写审计日志**：导出含 PII，应当审计（谁在何时导出了哪些筛选条件的多少行）。列入后续。
3. 非法参数返回 **400**（沿用全局 `parseRequest` + OpenAPI 约定），非审计报告里写的 422；这是既有约定，接受，但需在文档里统一口径。
4. 批量操作 `Promise.all`，可能部分成功；UI 需明确呈现部分失败（已知）。
5. `admin-ui/destructive-action-dialog.tsx` 仍含越界假文案「当前没有连接真实 API」，Agent 无权改 → 已记入后续任务。
6. fixture 模式下 2FA/comment/media/invitations 诚实地显示「未接入」（因 fixtures 缺这些字段）——符合「不伪造」原则。
7. **无截图、未跑真实 DB**（Prisma 在 service 层 mock + HTTP e2e）。G4 需在 staging/真实 PG 补：搜索/分页/详情/导出/套餐变更/所有权转移实机验证。

## 说明

Admin 端当前用的是**契约类型的手写 fetch**（因禁止重新生成而无法用 generated hooks）。既然我已重新生成（609 schemas），后续可收敛为 generated hooks——记为可选重构，不阻塞。