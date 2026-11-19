# AUTHZ_OVERRIDE 交付报告

- 状态：**DONE**
- 任务 ID：`AUTHZ_OVERRIDE`
- 角色：`backend_api`
- 日期：2026-11-19（Asia/Shanghai）
- 仓库：`C:\Users\BY9700\Desktop\UI\roamlog`

## 1. 变更文件

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `apps/api/src/modules/admin/admin-authz.service.ts` | 新增 | `AdminAuthzPort` seam、`AdminAuthzService`（30s 进程内缓存、DB diff 合并、读取侧白名单、DB 回落）、`effectiveActionsFromOverrides` 纯函数 |
| `apps/api/src/modules/admin/admin.guard.ts` | 修改 | `canActivate` 改为 async，通过 `ADMIN_AUTHZ_PORT` 读取有效动作；把解析结果挂到 request 供下游断言复用；鉴权源异常不捕获（→500） |
| `apps/api/src/modules/admin/admin-access.ts` | 修改 | `assertAdminAction` 优先使用 `actor.platformActions`（AdminGuard 注入），非 Admin HTTP 路径仍回退代码矩阵 |
| `apps/api/src/modules/admin/admin-permissions.service.ts` | 修改 | 注入 `AdminAuthzPort`，PATCH 成功后 `invalidate()`；GET 合并矩阵忽略 `user`/`super_admin` 与不可授予动作，与运行时一致；写入侧不再为这两个不变量角色落 diff |
| `apps/api/src/modules/admin/admin.module.ts` | 修改 | 移除重复 provider（seam 由全局模块统一提供） |
| `apps/api/src/common/guards/actor-context.ts` | 修改 | `AuthenticatedRequest.adminActions` / `AuthenticatedActor.platformActions`，`actorFromRequest` 透传 |
| `apps/api/src/common/guards/access-control.module.ts` | 修改 | 在既有 `@Global()` 访问控制模块中提供并导出 `AdminAuthzService` + `ADMIN_AUTHZ_PORT` 单例（AdminModule 与 SettingsModule 共用同一缓存实例） |
| `apps/api/src/modules/admin/__tests__/admin-authz.service.spec.ts` | 新增 | 15 个用例：代码矩阵、grant/revoke、后写覆盖先写、白名单、TTL、invalidate、DB 回落 + warn、delegate 缺失回落、并发去重、不变量角色 |
| `apps/api/src/modules/admin/__tests__/admin-authz-override.spec.ts` | 新增 | 2 个真实 controller + 真实 guard/service 的集成用例：403 → grant → 200 → revoke → 403；super_admin 豁免 |
| `apps/api/src/modules/admin/__tests__/admin-access.spec.ts` | 修改 | async guard、可注入 stub、grant/revoke 覆盖、鉴权源抛错、`platformActions` 下游一致性 |
| `apps/api/src/modules/admin/__tests__/admin-permissions.service.spec.ts` | 修改 | 注入 authz stub；PATCH invalidate 断言；不变量角色读写一致性用例 |
| `apps/api/src/modules/settings/__tests__/admin-settings.controller.spec.ts` | 修改（最小兼容） | 该测试模块直接 `providers: [AdminGuard]`，新增 `ADMIN_AUTHZ_PORT` 的代码矩阵 stub；这是 AdminGuard 新增依赖后唯一需要改的既有测试模块 |
| `.audit/authz-override-report.md` | 新增 | 本报告 |

未修改 `packages/db/prisma/**`、`apps/admin/**`、`apps/web/**`、`packages/contracts/**`；未新增表/迁移/契约字段。

## 2. 实现摘要（逐 4 项）

### 2.1 带缓存的「有效平台权限」来源

`AdminAuthzService.getEffectiveActions(role)` 的合并顺序：

1. `user` → 空集（即使 DB 有 `granted=true` 行也不生效）。
2. `super_admin` → `ADMIN_ACTIONS` 全集（即使 DB 有 `granted=false` 行也不生效），且不查 DB。
3. 其他角色 → `PLATFORM_ROLE_ACTIONS[role]` 代码矩阵，再按下表 diff 叠加：
   - `granted=true` 添加；
   - `granted=false` 删除；
   - 同一 `(role, action)` 多行时后写覆盖先写（查询 `orderBy: { updatedAt: "asc" }`，合并循环按顺序应用）。
4. 读取侧白名单：`isGrantableAdminAction(action) === false` 的行**任何方向都不生效**。B3 写入侧已 422 拦截，这里再兜一次，防止手工 SQL / 旧版本 / 恢复的 dump 扩大权限面。

缓存与一致性：

- 进程内 `Map<PlatformRole, { actions, expiresAt }>`，TTL `30_000ms`（`ADMIN_AUTHZ_CACHE_TTL_MS`）。
- `PATCH /v1/admin/permissions` 成功提交后由 `AdminPermissionsService` 调用 `invalidate()`，当前实例下一次请求立即读到新值。
- `invalidate(role?)` 支持全量或单角色失效（PATCH 使用全量）。
- 并发去重：`pendingOverrides` 让同进程内并发角色查询共享一次 DB 往返，避免缓存未命中风暴。

DB 不可用：

- `loadOverrides()` 抛错（连接失败、表不存在、Prisma delegate 缺失）→ 记录 `admin.authz.override_unavailable` warn（60s 节流）并返回代码矩阵。
- 回落结果**不写入缓存**，下一次请求会重试 DB，恢复后自动收敛。
- 失败方向是“回落到更严格的代码默认”，不是“全允许”；但注意语义见 §5 风险 2。

### 2.2 接入 admin 鉴权

- `AdminGuard.canActivate` 改为 `async`，先解析 `@RequireAdminAction` 元数据，再 `await this.authz.getEffectiveActions(request.user.platformRole)`，用 `Set.has(action)` 判定。
- 语义保持：`super_admin` 全集、`user` 无任何 admin 动作（由 §2.1 不变量保证）。
- **失败方向**：`getEffectiveActions` 抛错时 guard 不 catch，Nest 映射为 500；有单测 `surfaces authorization-source failures instead of allowing the request` 证明不会静默放行。
- **可注入 seam**：`AdminAuthzPort` 接口 + `ADMIN_AUTHZ_PORT` Symbol token。测试可替换任意实现（`admin-access.spec.ts` 的 `codeMatrixAuthz()` / `authzWith()`）。
- 下游服务内 `assertAdminAction`（47 处调用）不需要改签名：AdminGuard 把有效集合写入 `request.adminActions` → `actorFromRequest` 复制为 `actor.platformActions` → `assertAdminAction` 优先用它。这样 `granted=true` 的覆盖不会被服务层旧的代码矩阵二次拒绝；`granted=false` 的撤销也不会在服务层被放行。非 Admin HTTP 调用（无该字段）继续使用代码矩阵。
- 模块解析：`SettingsModule` 也挂着 `AdminGuard`，因此 seam 放在既有 `@Global()` 的 `AccessControlModule` 中提供，`AdminModule` 与 `SettingsModule` 共用**同一个** `AdminAuthzService` 实例（避免同进程两个缓存，PATCH 失效只影响一半路由）。

### 2.3 幂等与一致性

- 实例 A：`PATCH` 事务提交 → `this.authz.invalidate()` → A 自己下一次鉴权立即使用新 diff。
- 实例 B：未处理该 PATCH，最迟 `TTL=30s` 后缓存过期并重新读 DB；**收敛窗口 ≤30s**。单测用 fake timers 验证“TTL 到期后读到新值”（`serves the cached answer for 30s and then reads the new value`）。
- 写入仍保持 B3 的“只存 diff”：与代码默认一致的变更删除旧行，不落冗余副本。
- 一致性修正：`user` / `super_admin` 是代码不变量，写入侧不再为它们落 diff（并清理旧行），GET 矩阵也不再展示被运行时忽略的状态；否则会出现“矩阵显示已撤销、运行时仍放行 super_admin”的双源真相。
- 矩阵 GET（`mergePermissionMatrix`）与运行时共用 `isGrantableAdminAction` 白名单。

### 2.4 测试

- 纯代码矩阵、grant 追加、revoke 移除、同 action 后写覆盖先写：`admin-authz.service.spec.ts`。
- 读取侧白名单（`admin:users:delete`、`admin:permissions:write` 等 `grantable=false` 行不生效，双向）：`effectiveActionsFromOverrides` 用例。
- 缓存 TTL、`invalidate()` 立即生效、按角色失效、并发去重：同名 spec。
- DB 抛错 → 代码矩阵 + warn；delegate 缺失 → 代码矩阵 + warn：同名 spec。
- 鉴权接入真实 controller：`admin-authz-override.spec.ts` 使用真实 `AdminContentController` + 真实 `AdminGuard` + 真实 `AdminPermissionsService`（假 Prisma 内存表），验证 403 → PATCH grant → 200 → PATCH revoke → 403；super_admin 直接写入 false 行仍 200。
- `super_admin` 豁免 override 的移除：纯函数用例 + 上面的集成用例 + 真实联调步骤 [6]。
- 下游一致性：`admin-access.spec.ts` 验证 `platformActions` 存在时 grant 可过、revoke 被拒；不存在时回退代码矩阵。
- 既有 Admin e2e（`test/admin-routes.e2e-spec.ts`，26 用例）在 Prisma mock 无 override delegate 时通过“回落代码矩阵 + warn”保持绿色，证明灰度/部分部署不会被 500 打穿。

## 3. 验证命令与结果

### 3.1 `pnpm --filter @roamlog/api typecheck`

```text
$ tsc --noEmit

[exit code: 0]
```

### 3.2 `pnpm --filter @roamlog/api exec vitest run src/modules/admin src/common/guards`

```text
 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/api

 ✓ src/modules/admin/__tests__/admin-authz-override.spec.ts (2 tests) 197ms
 ✓ src/modules/admin/__tests__/admin-users.service.spec.ts (20 tests) 51ms
 ✓ src/modules/admin/__tests__/admin-workspaces.service.spec.ts (11 tests) 32ms
 ✓ src/modules/admin/__tests__/admin-permissions.service.spec.ts (10 tests) 16ms
 ✓ src/modules/admin/__tests__/admin-metrics-system.service.spec.ts (6 tests) 20ms
 ✓ src/modules/admin/__tests__/admin-queue.service.spec.ts (15 tests) 21ms
 ✓ src/modules/admin/__tests__/admin-audit.service.spec.ts (4 tests) 13ms
 ✓ src/modules/admin/__tests__/admin-emails-jobs.service.spec.ts (10 tests) 14ms
 ✓ src/modules/admin/__tests__/admin-authz.service.spec.ts (15 tests) 12ms
 ✓ src/modules/admin/__tests__/admin-content.service.spec.ts (6 tests) 12ms
 ✓ src/modules/admin/__tests__/admin-access.spec.ts (12 tests) 8ms
 ✓ src/modules/admin/__tests__/platform-two-factor.guard.spec.ts (6 tests) 10ms
 ✓ src/modules/admin/__tests__/admin-export.controller.spec.ts (3 tests) 8ms

 Test Files  13 passed (13)
      Tests  120 passed (120)
```

补充（既有 admin e2e）：

```text
 ✓ test/admin-routes.e2e-spec.ts (26 tests) 648ms

 Test Files  1 passed (1)
      Tests  26 passed (26)
```

### 3.3 `pnpm --filter @roamlog/contracts test`

```text
 ✓ src/__tests__/admin-settings.test.ts (7 tests) 28ms
 ✓ src/__tests__/permissions.test.ts (10 tests) 10ms
 ✓ src/__tests__/ai.test.ts (7 tests) 25ms
 ✓ src/__tests__/pagination.test.ts (7 tests) 22ms
 ✓ src/__tests__/money.test.ts (4 tests) 16ms
 ✓ src/__tests__/realtime.test.ts (3 tests) 16ms
 ✓ src/__tests__/admin.test.ts (4 tests) 12ms
 ✓ src/__tests__/entities.test.ts (24 tests) 45ms
 ✓ src/__tests__/openapi.test.ts (10 tests) 667ms

 Test Files  9 passed (9)
      Tests  76 passed (76)
```

### 3.4 真实联调（本地 API 4200 + PG 55444 + Redis 6379）

环境：本地 `roamlog_local` public schema 上应用了已提交的 `0005_platform_role_override` 迁移（仅新增 `PlatformRoleOverride` 表，additive），`DATABASE_URL=postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public`，API 以最终代码启动于 `127.0.0.1:4200`（4000 当时未运行；Redis 用仓库自带 runtime 二进制临时启动）。

账号：本地临时创建 `authz-super@roamlog.test`（super_admin）与 `authz-analyst@roamlog.test`（analyst），通过真实 `POST /v1/auth/sign-in/email` 获取会话 Cookie；未伪造会话。Cookie 值未记录。

原始输出（脱敏，无 Cookie/密码）：

```text
[1] analyst GET /v1/admin/flags (baseline)
 -> HTTP 403
 -> code ADMIN_ACCESS_DENIED

[2] super_admin PATCH /v1/admin/permissions grant analyst admin:flags:read
 -> HTTP 200
 -> analyst has flag: true

[3] analyst GET /v1/admin/flags (after grant)
 -> HTTP 200

[4] super_admin PATCH revoke
 -> HTTP 200
 -> analyst has flag: false

[5] analyst GET /v1/admin/flags (after revoke)
 -> HTTP 403
 -> code ADMIN_ACCESS_DENIED

[6] super_admin tries to revoke its own admin:flags:read
 -> HTTP 200
 -> matrix still grants super_admin: true
 -> super_admin GET /v1/admin/flags HTTP 200

[7] tries to grant user admin:metrics:read
 -> HTTP 200
 -> user actions: []
```

DB 与审计核对：

```text
PlatformRoleOverride rows: []

AuditLog: admin.permissions.updated {"changeCount":1,"changedActions":["user:admin:metrics:read:true"]} 2026-11-18T22:10:06.893Z
AuditLog: admin.permissions.updated {"changeCount":1,"changedActions":["super_admin:admin:flags:read:false"]} 2026-11-18T22:10:06.798Z
AuditLog: admin.permissions.updated {"changeCount":1,"changedActions":["analyst:admin:flags:read:false"]} 2026-11-18T22:10:06.635Z
AuditLog: admin.permissions.updated {"changeCount":1,"changedActions":["analyst:admin:flags:read:true"]} 2026-11-18T22:10:06.506Z
```

结论：同一进程 A 的 PATCH 通过 `invalidate()` 立即生效（403 → 200 → 403），且 diff 表最终为空；不可授予动作与不变量角色的尝试均未留下有效行。

## 4. CodeGraph 证据

- `codegraph status` → `[OK] Index is up to date`（1,617 files / 24k+ nodes）。
- `codegraph_explore`（MCP，`projectPath: C:\Users\BY9700\Desktop\UI\roamlog`）查询：
  `AdminAuthzService getEffectiveActions ADMIN_AUTHZ_PORT AdminGuard platformActions access-control.module`
- 关键结果：
  - `ADMIN_AUTHZ_PORT` → 5 callers：`access-control.module.ts`、`admin-permissions.service.ts`、`admin.guard.ts`；测试：`admin-authz-override.spec.ts`、`admin-settings.controller.spec.ts`。
  - `AdminAuthzPort.getEffectiveActions` → `AdminAuthzService.getEffectiveActions`（interface → impl，`admin-authz.service.ts:104`）。
  - `AdminGuard` → 11 callers（全部 Admin controller：users/workspaces/content/operations/dashboard/permissions + settings admin controller）；测试含 `admin-access.spec.ts`、`admin-authz-override.spec.ts`。
  - `getEffectiveActions` 调用链：`canActivate → getEffectiveActions → effectiveActionsFromOverrides / loadOverrides / warnFallback`；`update → invalidate`。
- 修改后 `codegraph status` 仍为 `[OK] Index is up to date`，新文件已被索引。

## 5. 已知风险

1. **30s 收敛窗口**：多实例部署时，未处理 PATCH 的实例最多 30s 后才读到新 diff。期间同一账号在不同实例上的鉴权结果可能不一致。需要更强一致性时应改为 Redis pub/sub 广播失效，但本任务明确接受 30s 窗口。
2. **DB 回落语义**：DB 不可用时回落到**代码矩阵**，不是“全允许”。这意味着：
   - 新增的 `granted=true` 覆盖暂时失效（更严格，安全）；
   - 已保存的 `granted=false` 撤销也暂时失效（相对当前生效状态是**临时放宽**，回到代码默认）。
   这是任务指定的方向（拒绝“DB 抖动全挂”），但若未来要求 fail-closed，需要配置开关或把缓存作为 secondary source。白名单动作（`admin:users:delete` 等）不受影响，仍由代码矩阵保护。
3. **同进程单例**：seam 放在 `@Global()` 的 `AccessControlModule` 中，`AdminModule` 与 `SettingsModule` 共用同一实例。若未来新增独立模块直接 `providers: [AdminGuard]`，需同样提供 `ADMIN_AUTHZ_PORT`，否则启动期 DI 报错（已通过 settings 测试修改暴露并修复）。
4. **本地数据副作用**：本地 `roamlog_local` public schema 新增了 `PlatformRoleOverride` 表（0005 迁移，additive）；创建了两个本地测试账号；临时 Redis/API 进程已停止；未写入仓库、未写密码。
5. **未修复的既有问题**：Redis 不可用时，auth rate-limit 路径会把 API 进程打崩（`MaxRetriesPerRequestError`，20 次重试的 ioredis 客户端无 catch）。与本任务无关（admin flags 流程本身不需要 Redis），已在联调中观察并绕过，未顺手修复。

## 6. 未覆盖项

- 未用**两个真实 API 进程**验证 B 实例 30s 收敛；该性质由 fake timers 单测和 TTL 常量保证，未做双进程实验。
- 未压测 admin 路由的缓存命中率/DB 回退频率。
- 未覆盖 2FA 强制开启（`ADMIN_2FA_ENFORCED=true`）下的真实联调（本地默认关闭）。
- `AdminAuthzService` 的 DB 读取失败只记录 warn，未接指标/告警。
- 未清理本地测试账号（保留可复验，不影响仓库）。

## 7. 建议下一步

1. 把 `AdminAuthzService` 从 `AccessControlModule` 迁到独立 `AdminAuthzModule`（`@Global()`），让“访问控制模块依赖 admin authz”变成显式模块依赖，降低后续维护歧义。
2. 增加 `admin.authz.override_unavailable` / `fallback` 指标与告警，并评估生产环境是否需要对“撤销在 DB 故障期间失效”做 fail-closed 开关。
3. 若要跨实例即时收敛，增加 Redis pub/sub `admin.permissions.changed` 广播，收到后调用 `invalidate()`；30s TTL 保留为兜底。
4. 为 `PATCH /v1/admin/permissions` 增加幂等键/预期版本（当前 last-write-wins + 审计已足够，但并发操作员仍可能互相覆盖）。
5. 将 `NON_GRANTABLE_ADMIN_ACTIONS` 与 `ADMIN_ACTIONS` 的集合一致性（当前 `admin:workspaces:transfer` 不在 action 列表）纳入 contracts 单测，避免白名单出现幽灵项。