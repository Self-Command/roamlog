# W2-API-ADMIN Delivery Report

状态: DONE_WITH_CONCERNS

任务 ID: W2-API-ADMIN

## 变更文件

新增 `apps/api/src/modules/admin/**`：

- `admin.module.ts`
- `admin.decorator.ts`
- `admin-access.ts`
- `admin.guard.ts`
- `admin-ids.ts`
- `admin-selects.ts`
- `admin.presenters.ts`
- `admin-queue.service.ts`
- `admin-metrics.service.ts`
- `admin-system.service.ts`
- `admin-users.service.ts`
- `admin-users.controller.ts`
- `admin-workspaces.service.ts`
- `admin-workspaces.controller.ts`
- `admin-content.service.ts`
- `admin-content.controller.ts`
- `admin-media.service.ts`
- `admin-audit.service.ts`
- `admin-emails.service.ts`
- `admin-jobs.service.ts`
- `admin-operations.controller.ts`
- `admin-dashboard.controller.ts`

新增 `apps/api/src/modules/feature-flags/**`：

- `feature-flags.module.ts`
- `feature-flags.service.ts`

新增测试：

- `apps/api/src/modules/admin/__tests__/admin-access.spec.ts`
- `apps/api/src/modules/admin/__tests__/admin-users.service.spec.ts`
- `apps/api/src/modules/admin/__tests__/admin-workspaces.service.spec.ts`
- `apps/api/src/modules/admin/__tests__/admin-content.service.spec.ts`
- `apps/api/src/modules/admin/__tests__/admin-emails-jobs.service.spec.ts`
- `apps/api/src/modules/admin/__tests__/admin-metrics-system.service.spec.ts`
- `apps/api/src/modules/admin/__tests__/admin-queue.service.spec.ts`
- `apps/api/src/modules/feature-flags/__tests__/feature-flags.service.spec.ts`
- `apps/api/test/admin-routes.e2e-spec.ts`

未修改 `apps/api/src/app.module.ts`、`apps/api/package.json`、web/admin/worker/packages/root 配置、lockfile、原型或设计文档。

## 实现摘要

### 路由

已实现 `@Controller("admin")` 下的全部契约路由：

- `GET /v1/admin/metrics`
- `GET /v1/admin/users`、`GET /v1/admin/users/:id`
- `PATCH /v1/admin/users/:id`
- `POST /v1/admin/users/:id/force-logout`
- `POST /v1/admin/users/:id/reset-2fa`
- `DELETE /v1/admin/users/:id`
- `GET /v1/admin/workspaces`、`GET /v1/admin/workspaces/:id`
- `PATCH /v1/admin/workspaces/:id`（status、plan、ownerId/所有权转移）
- `DELETE /v1/admin/workspaces/:id`
- `GET /v1/admin/trips`、`GET /v1/admin/entries`、`GET /v1/admin/comments`
- `DELETE /v1/admin/content/:type/:id`
- `POST /v1/admin/content/:type/:id/restore`
- `GET /v1/admin/media`、`DELETE /v1/admin/media/:id`
- `GET /v1/admin/audit`
- `GET /v1/admin/flags`、`PATCH /v1/admin/flags/:key`
- `GET /v1/admin/emails`、`POST /v1/admin/emails/:id/resend`
- `GET /v1/admin/jobs`、`POST /v1/admin/jobs/:queue/:jobId/retry`
- `GET /v1/admin/system`

### 权限

- `AdminGuard` + `@RequireAdminAction` 按 `@roamlog/contracts` 的 `canPlatform` 执行。
- 平台角色矩阵覆盖 `support / analyst / admin / super_admin`，`user` 一律拒绝。
- `admin:jobs:retry` 仅 admin/super_admin；`admin:jobs:manage` 仅 super_admin（见风险：契约无对应管理端点）。
- `admin:flags:update` 仅 super_admin，服务层二次校验。
- support 可暂停/恢复用户与 Workspace、强制登出、重发邮件；不可删除、改平台角色、重置 2FA、重试队列、切开关。
- analyst 只读指标/审计/用户/Workspace/邮件/队列。
- Workspace plan/owner 变更使用 `admin:workspaces:delete` 作为运营级权限门（契约未提供单独 plan/owner 平台动作）。

### 审计与软删除

- 用户 PATCH、删除、强制登出、重置 2FA；Workspace PATCH、删除、转移所有权；内容删除/恢复；媒体删除；邮件重发；队列重试；功能开关更新均写 `AuditLog`，`actorType` 为 `admin`。
- 用户、Workspace、Trip、JournalEntry、Comment、Media 使用 `deletedAt` 软删除。
- 用户/Workspace 可通过 PATCH `status: "active"` 恢复；内容通过 restore 端点恢复。
- 最后一名 active `super_admin` 禁止降级或删除。

### 指标 / 系统 / 队列

- Metrics 从 Prisma 聚合用户/Workspace/Trip/Entry/Comment/Media/Export，从 BullMQ 兼容 Redis keys 聚合队列计数。
- 数据库不可用时返回 `503 METRICS_UNAVAILABLE`，不伪造数值。
- 队列不可用时返回 DB 指标并把 `queues` 置空，同时设置 `x-roamlog-degraded: queues` 响应头。
- 队列读取使用 BullMQ key 约定（`<queue>:wait|active|failed|completed|delayed`），retry 仅允许 failed job。
- System 返回契约字段：版本、环境、Node 版本、uptime、DB/Redis/S3 延迟与状态、队列计数。

### 功能开关 / 邮件

- Feature flags：全局 enabled、rolloutPercentage、rules；支持 `workspaceIds` / `workspaceAllowlist` / `workspaces` 数组校验（UUIDv7），并写入审计。
- Email：读取 `EmailLog`（含 bounced/complained 状态）、按 userId/status/template/to 过滤；resend 创建新的 queued `EmailLog` 并审计。

## 需 root 注册/依赖

无需新增 npm 依赖。需要在共享文件中接线：

```ts
import { AdminModule } from "./modules/admin/admin.module.js";
import { FeatureFlagsModule } from "./modules/feature-flags/feature-flags.module.js";

// AppModule imports 中追加：
// AdminModule,
// FeatureFlagsModule,
```

`AdminModule` 已导入并导出 `FeatureFlagsModule`；如果其他模块要直接使用开关判断，可另行 import `FeatureFlagsModule`。

## 验证命令与结果

```text
pnpm --filter @roamlog/api test
Test Files 39 passed (39)
Tests      200 passed (200)

pnpm --filter @roamlog/api typecheck
tsc --noEmit 通过

pnpm --filter @roamlog/api build
tsc -p tsconfig.build.json 通过
```

## 未覆盖/风险

1. **AppModule 尚未接线**：按任务约束未修改 `app.module.ts`，在 root 注册 `AdminModule` 前不会挂载 `/v1/admin/**`。
2. **AdminSystem 契约字段不足**：设计要求迁移版本、构建时间、Worker 健康，但 `AdminSystemSchema` 只允许 version/environment/nodeVersion/uptimeSeconds/checks(database,redis,storage)/queues。未擅自扩展响应结构。需要契约升级后补充。
3. **队列管理端点缺失**：契约只有 list/retry，没有 pause/clear/manage 路由；`admin:jobs:manage` 的权限矩阵已通过 `canPlatform` 测试，但没有可挂载的 manage 端点。
4. **审计 CSV 导出缺失**：`admin:audit:export` 动作存在，但 OpenAPI 无导出路径；本次未新增未契约化路由。
5. **邮件 resend 未入队**：resend 会创建 queued `EmailLog` 并审计，但没有直接向 BullMQ 添加 email job。Worker 侧 email processor（其他 track）接收 `EmailJobData.emailLogId`；root/W3 需在 resend 后 enqueue，或给 API 增加 bullmq 依赖后接线。
6. **媒体删除为软删除**：只写 `deletedAt`，不删除 S3 对象，也没有媒体恢复端点（契约未提供）。
7. **Admin 2FA 未在 API Guard 强制**：设计要求后台强制 2FA；当前只校验平台角色。生产接线前需补 `twoFactorEnabled` 校验和种子/bootstrap 策略。
8. **Metrics 降级信号仅响应头**：契约 body 无 degraded 字段，队列降级通过 `x-roamlog-degraded` 暴露；DB 失败直接 503。
9. **Workspace plan/owner 权限映射**：契约无独立动作，暂用 `admin:workspaces:delete` 作为 admin/super_admin 门槛；如果产品要求更细粒度，需要新契约动作。

## 建议下一步

1. root 在 `AppModule` 注册 `AdminModule`（并视需要注册 `FeatureFlagsModule`）。
2. 与 contracts owner 确认 AdminSystem 扩展字段、queue manage 路由、audit CSV 导出路由。
3. 打通 resend → BullMQ email job（使用 worker 的 `EmailJobData.emailLogId`）。
4. 在生产暴露前补 Admin 2FA 强制与 bootstrap super_admin 校验。
5. 运行 Admin 前端针对这些真实端点的契约/E2E 集成检查。
