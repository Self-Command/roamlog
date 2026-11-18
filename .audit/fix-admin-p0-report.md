# Admin P0 修复报告 — 审计 UUIDv4 与总览数据源隔离

任务 ID: admin_p0_audit_contract
状态: IN_PROGRESS
开始时间: 2026-11-18 (Asia/Shanghai)

## 根因

- `AuditLogSchema` 将审计记录的 `id`、`actorId`、`targetId`、`workspaceId` 限制为 UUIDv7。
- 生产 5 条审计记录中有 1 条 `admin.user.updated` 的主键为 UUIDv4；`presentAdminAuditLog()` 直接 `AuditLogSchema.parse()`，因此 `GET /v1/admin/audit` 以及共用 presenter 的 CSV 导出返回 500。
- 总览同时请求 metrics、emails、audit；`combineResources()` 任一项失败即令整个 dashboard data 为 null，错误边界覆盖整页。

## 修复决策

选择 **读取兼容历史记录**，不改写审计主键：

- 审计日志是只追加的不可篡改记录。迁移/重写既有的审计 UUID 会改变证据链并可能破坏外部引用，风险高于读取兼容。
- 不新增数据库迁移；数据库仍对所有新记录使用 `uuid(7)` 默认值，新写入保持 UUIDv7。
- `AuditLog` 读取契约的 UUID 字段接受 RFC 4122/9562 UUID（含历史 UUIDv4），并对非 UUID 值继续严格拒绝。
- 总览为 metrics、emails、audit 分别保留状态与重试；单个数据源失败只降级对应区块。

## 进度

- [x] 阅读审计报告 P0-01、AGENTS.md、契约与 presenter。
- [x] 兼容契约；OpenAPI/API client 已生成一次，后续由 W0 统一重新生成。
- [x] API 单测已覆盖 UUIDv4 list/export 与非法 UUID 拒绝。
- [x] 真实 PostgreSQL 回归测试已编写（待运行）。
- [x] 总览分区块错误边界与重试已实现，组件测试通过。
- [ ] 运行 TypeScript、测试、Admin 构建与契约检查。
- [ ] 最终 diff/安全检查与交付记录。

## 验证记录

- `pnpm --filter @roamlog/api exec vitest run src/modules/admin/__tests__/admin-audit.service.spec.ts` → 4 passed。
- `pnpm --filter @roamlog/admin exec vitest run components/dashboard/dashboard-view.test.tsx` → 4 passed。

## 剩余风险

- 尚未运行全量验证与真实 PostgreSQL e2e。
