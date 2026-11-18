# Checkpoint — admin_p0_audit_contract

时间: 2026-11-18 16:57 (Asia/Shanghai)
状态: IN_PROGRESS — 核心修复完成，进入全量验证

## 已完成

- 已确认 P0 根因：`AuditLogSchema` 强制 UUIDv7；生产 1 条 UUIDv4 审计主键在 `presentAdminAuditLog()` 中触发 ZodError。
- 已确认总览整页失败来自 `combineResources()` 的 all-or-nothing 行为。
- 已确定采用读取兼容，不迁移/重写不可篡改审计记录。
- 已修改 `packages/contracts/src/entities/audit-log.ts`：审计 `id/actorId/targetId/workspaceId` 接受任意 RFC UUID，非 UUID 仍拒绝。
- 已新增 API 单测：UUIDv4 list/export 成功、非法 UUID 仍失败。
- 已新增 `apps/api/test/admin-audit-uuid-compat.e2e-spec.ts`：真实 PostgreSQL 下 GET audit/export/metrics/emails 均 200。
- 已修改 `apps/admin/lib/admin-data-source.ts`：独立 metrics/emails/audit source 状态，仅认证失败或三者全失败才整页错误。
- 已修改 `apps/admin/components/dashboard/dashboard-view.tsx`：逐区块错误/加载/重试。
- 已扩展 dashboard 组件测试。

## 变更文件

- `.audit/fix-admin-p0-report.md`
- `.audit/fix-admin-p0-report.checkpoint.md`
- `packages/contracts/src/entities/audit-log.ts`
- `packages/contracts/openapi.json`（生成物，等待 W0 统一重新生成）
- `packages/api-client/src/generated/schemas/adminAuditPageItemsItem.ts`
- `packages/api-client/src/generated/schemas/auditLog.ts`
- `packages/api-client/src/generated/schemas/workspaceAuditPageItemsItem.ts`
- `apps/api/src/modules/admin/__tests__/admin-audit.service.spec.ts`
- `apps/api/test/admin-audit-uuid-compat.e2e-spec.ts`
- `apps/admin/lib/admin-data-source.ts`
- `apps/admin/components/dashboard/dashboard-view.tsx`
- `apps/admin/components/dashboard/dashboard-view.test.tsx`

## 验证

- API audit service spec: 4 passed。
- Admin dashboard view spec: 4 passed。

## 剩余项

1. 启动本地 embedded PostgreSQL，应用迁移并运行真实 PostgreSQL e2e。
2. 运行 API/Admin typecheck、完整测试、Admin build。
3. W0 重新生成 OpenAPI/API client 后运行 `contracts:check`。
4. 最终 diff/边界/安全检查。
