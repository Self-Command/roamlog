# B3_ADMIN_USER_EDIT 交付报告

状态: DONE（后端 / 契约 / 后台 / 数据库 / 测试 / 真实联调均完成）
任务 ID: B3_ADMIN_USER_EDIT
分支基线: `625e363`（工作区含其它 Agent 未提交改动，本任务未触碰）
时间: 2026-11-19

## 1. 变更文件（仅本任务）

### 契约
- `packages/contracts/src/api/admin.ts`
  - `UpdateAdminUserRequestSchema` 扩展为 `name/email/locale/timezone/status/platformRole`（保留既有 `status` 以不破坏暂停/恢复）
  - 新增 `AdminUserUpdateResponseSchema`（详情 + `delivery: "sent" | "failed"`）
  - 新增权限矩阵契约：`AdminPermissionsResponseSchema`、`UpdateAdminPermissionsRequestSchema`、`AdminPermissionChangeSchema` 等
- `packages/contracts/src/permissions.ts`
  - `ADMIN_ACTIONS` 增加 `admin:users:update`、`admin:permissions:read`、`admin:permissions:write`（后两个是任务 §2 明确要求的动作名；未改动其它既有动作/角色）
  - 导出 `PLATFORM_ROLE_ACTIONS`（由既有 `platformRoleActions` 派生，不复制第二份矩阵）
  - 导出 `ADMIN_ACTION_DESCRIPTIONS`、`NON_GRANTABLE_ADMIN_ACTIONS`、`ADMIN_GRANTABLE_ACTIONS`、`isGrantableAdminAction`

### 数据库
- `packages/db/prisma/schema.prisma`：新增 `PlatformRoleOverride` 模型
- `packages/db/prisma/migrations/0005_platform_role_override/migration.sql`：additive，只建一张表和索引，无任何 INSERT/ALTER/DROP
- `packages/db/src/factories.ts`、`packages/db/src/index.ts`：`makePlatformRoleOverride` 与导出
- `packages/db/src/__tests__/migration.0004.test.ts`：迁移清单断言加入 0005
- `packages/db/src/__tests__/migration.0005.test.ts`：静态迁移/模型断言
- `packages/db/src/__tests__/platform-role-override.integration.test.ts`：真实 PG 空库 + 现有库（先 0001–0004 + 既有行，再 0005）验证

### API
- `apps/api/src/modules/admin/admin-users.service.ts`
  - `PATCH /v1/admin/users/{id}`：编辑姓名/邮箱/语言/时区/平台角色
  - 邮箱变更：唯一冲突 409 `EMAIL_TAKEN`、`emailVerified=false`、触发 Better Auth 验证邮件（经既有 `EmailDeliveryService`），失败不阻断并返回 `delivery:"failed"`；以 `EmailLog` 实际状态回读投递结果
  - `platformRole` 变更：不允许最后一个 `super_admin` 降级（409 `LAST_SUPER_ADMIN`）、不允许自我降级（409 `SELF_DEMOTION_FORBIDDEN`）
  - 审计 `admin.user.updated` metadata 只写 `changedFields`（字段名）与 `emailVerificationSent`，不含任何字段值
  - 资料字段要求新动作 `admin:users:update`（仅 super_admin）；角色/状态仍按原动作校验，support 的暂停能力不受影响
- `apps/api/src/modules/admin/admin-permissions.service.ts`（新）
  - `GET /v1/admin/permissions`：角色矩阵直接从 `PLATFORM_ROLE_ACTIONS` / `ADMIN_ACTIONS` 派生，叠加 DB diff
  - `PATCH /v1/admin/permissions`：只接受 grantable=true；否则 422 `PERMISSION_NOT_GRANTABLE`
  - 只存 diff：与代码默认一致时删除 override 行；写操作审计 `admin.permissions.updated`
- `apps/api/src/modules/admin/admin-permissions.controller.ts`（新）：`GET/PATCH /v1/admin/permissions`，`admin:permissions:read|write`
- `apps/api/src/modules/admin/admin.module.ts`：注册新 controller/service
- 测试：`__tests__/admin-users.service.spec.ts` 增补 8 个用例；`__tests__/admin-permissions.service.spec.ts`（新）7 个用例

### Admin 前端
- `apps/admin/lib/admin-users.ts`（新）：资料 PATCH 客户端、表单校验、错误码映射、邮件投递文案、React Query port
- `apps/admin/lib/admin-users-permissions.ts`（新）：矩阵 GET/PATCH 客户端、错误映射
- `apps/admin/components/users/users-view.tsx`：详情抽屉「编辑资料」表单（姓名/邮箱/语言/时区/平台角色）、客户端校验、409/422 具体提示、保存后重拉详情+列表确认、邮箱投递提示
- `apps/admin/app/admin/users/page.tsx`：接入 `useAdminUserProfilePort`
- `apps/admin/app/admin/permissions/{page.tsx,permissions-view.tsx}`（新）：矩阵页（角色 × 动作）、锁定格 `Lock` + tooltip「安全敏感，界面不可授予」、二次确认对话框、保存后重拉
- 测试：`components/users/user-profile-edit.test.tsx`（新，5 例）、`app/admin/permissions/permissions-view.test.tsx`（新，4 例）

### 报告
- `.audit/b3-report.md`（本文件）

> 未触碰：`apps/admin/components/admin-shell/**`、`apps/admin/components/settings/**`、`apps/admin/lib/admin-settings*`、`apps/api/src/modules/places/**`、`packages/contracts/src/api/places.ts`、`apps/web/**`、`docker/**`、其它 `.audit`。工作区里其它 Agent 的改动保持原样未提交。

## 2. 权限矩阵设计

`GET /v1/admin/permissions` 响应：

```json
{
  "roles": [{ "role": "support", "actions": ["admin:metrics:read", "..."] }],
  "actions": [{ "action": "admin:users:read", "description": "...", "grantable": true }]
}
```

- 角色列表 / 动作列表 / 默认授权全部从 `packages/contracts/src/permissions.ts` 的常量派生，路由层不保存第二份矩阵。
- 存储 `PlatformRoleOverride(role, action, granted, updatedById, updatedAt, createdAt)`，主键 `(role, action)`；写入时与代码默认值相同的变更直接删除 override（真正的“只存 diff”）。
- `grantable=false` 动作（界面锁定 + API 422）：
  `admin:users:delete`、`admin:users:change-role`、`admin:users:reset-2fa`、`admin:users:update`、`admin:settings:write`、`admin:workspaces:transfer`（当前枚举里尚未实现，仅登记为不可授予）、`admin:permissions:read`、`admin:permissions:write`。
- 新增的 `admin:permissions:*` 与 `admin:users:update` 也锁定为不可授予，确保“仅 super_admin”不会被矩阵界面放开。

## 3. 验证命令与原始结果

### 3.1 DB（真实 PG `postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=b3_test`）

先应用迁移（空 schema）：
```
$ DATABASE_URL=...schema=b3_test pnpm --filter @roamlog/db exec prisma migrate deploy
The following migration(s) have been applied:
  ...
  └─ 0005_platform_role_override/
All migrations have been successfully applied.
```

```
$ ROAMLOG_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=b3_test' pnpm --filter @roamlog/db test
Prisma schema loaded from prisma\schema.prisma.
The schema at prisma\schema.prisma is valid 🚀

 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/packages/db

 ✓ src/__tests__/schema.test.ts (9 tests) 25ms
 ✓ src/__tests__/migration.0005.test.ts (4 tests) 10ms
 ✓ src/__tests__/migration.0004.test.ts (5 tests) 12ms
 ✓ src/__tests__/client.test.ts (2 tests) 10ms
 ✓ src/__tests__/settings-defaults.test.ts (4 tests) 9ms
 ✓ src/__tests__/seed.test.ts (9 tests) 37ms
 ✓ src/__tests__/migration.w0.test.ts (11 tests) 126ms
 ✓ src/__tests__/system-setting.integration.test.ts (7 tests) 1007ms
 ✓ src/__tests__/seed.integration.test.ts (1 test) 1364ms
 ✓ src/__tests__/platform-role-override.integration.test.ts (3 tests) 1651ms

 Test Files  10 passed (10)
      Tests  55 passed (55)
```

### 3.2 API

```
$ pnpm --filter @roamlog/api typecheck
$ tsc --noEmit
[exit code: 0]
```

```
$ pnpm --filter @roamlog/api exec vitest run src/modules/admin
 ✓ src/modules/admin/__tests__/admin-users.service.spec.ts (20 tests) 77ms
 ✓ src/modules/admin/__tests__/admin-permissions.service.spec.ts (7 tests) 21ms
 ... (其余 9 个 admin 测试文件)
 Test Files  11 passed (11)
      Tests  95 passed (95)
```

### 3.3 Admin

```
$ pnpm --filter @roamlog/admin typecheck
$ tsc --noEmit
[exit code: 0]
```

```
$ pnpm --filter @roamlog/admin exec vitest run components/users app/admin/permissions
 ✓ app/admin/permissions/permissions-view.test.tsx (4 tests) 1411ms
 ✓ components/users/user-profile-edit.test.tsx (5 tests) 1965ms
 ✓ components/users/users-view.test.tsx (9 tests) 2060ms
 Test Files  3 passed (3)
      Tests  18 passed (18)
```

### 3.4 Contracts

```
$ pnpm --filter @roamlog/contracts test
 ✓ src/__tests__/permissions.test.ts (10 tests) 9ms
 ... 8 个测试文件
 Test Files  8 passed (8)
      Tests  64 passed (64)
```

### 3.5 Admin build

```
$ pnpm --filter @roamlog/admin build
✓ Generating static pages using 15 workers (17/17) in 760ms
Route (app)
...
├ ○ /admin/permissions
├ ○ /admin/users
...
[exit code: 0]
```

### 3.6 真实联调（API `4000` 为旧进程，新代码实例起在 `4200`，DB=`...?schema=b3_live`）

说明：`127.0.0.1:4000` 上运行的进程是 `e2e/live-support/start-api.ts`（无 watch，且启动于本任务代码变更前），不含新端点；`?schema=b3_live` 上另起同代码实例完成联调，本机 Redis 8.10.3 由 `tooling/services/runtime/bin/redis` 启动。测试账号均为本地测试数据，会话 token 已脱敏。

1) 改 name → GET 确认：

```
$ curl -s -w "status=%{http_code}\n" -b <session> -X PATCH http://127.0.0.1:4200/v1/admin/users/<target> \
    -H 'content-type: application/json' -d '{"name":"B3 Target Renamed"}'
status=200
{"id":"<target>","name":"B3 Target Renamed","emailVerified":true,"platformRole":"user"}

$ curl -s -b <session> http://127.0.0.1:4200/v1/admin/users/<target>
{"id":"<target>","name":"B3 Target Renamed","email":"b3.target@roamlog.test","emailVerified":true}
```

2) PATCH `grantable=false` 动作 → 422：

```
$ curl -s -w "status=%{http_code}\n" -b <session> -X PATCH http://127.0.0.1:4200/v1/admin/permissions \
    -H 'content-type: application/json' \
    -d '{"changes":[{"role":"admin","action":"admin:users:delete","granted":true}]}'
status=422
{"type":"https://roamlog.app/errors/permission-not-grantable","title":"Unprocessable Content",
 "status":422,"detail":"This action is security-sensitive and cannot be granted through the UI.",
 "instance":"/v1/admin/permissions","code":"PERMISSION_NOT_GRANTABLE","errors":[]}
```

3) 权限矩阵读取（派生 + 锁定动作）：

```
GET /v1/admin/permissions -> 200
roles: user=0, support=12, analyst=7, admin=24, super_admin=32
actions: 32
nonGrantable: admin:users:delete, admin:users:reset-2fa, admin:users:change-role,
              admin:settings:write, admin:users:update,
              admin:permissions:read, admin:permissions:write
```

4) override 合并生效：

```
PATCH {"changes":[{"role":"support","action":"admin:flags:read","granted":true}]} -> 200
GET  -> roles.support 包含 admin:flags:read = true
DB   -> PlatformRoleOverride [{"role":"support","action":"admin:flags:read","granted":true}]
```

5) 邮箱变更（验证邮件真实投递 + emailVerified 重置）：

```
$ PATCH {"email":"b3.target2@roamlog.test","locale":"en-US","timezone":"Europe/Berlin"} -> 200
{"email":"b3.target2@roamlog.test","emailVerified":false,"locale":"en-US","timezone":"Europe/Berlin","delivery":"sent"}

$ GET -> {"email":"b3.target2@roamlog.test","emailVerified":false,"locale":"en-US","timezone":"Europe/Berlin"}
EmailLog -> {"to":"b3.target2@roamlog.test","template":"auth.verify-email","status":"sent"}
```

6) 自我降级 → 409：

```
PATCH /v1/admin/users/<self> {"platformRole":"admin"} -> 409
{"code":"SELF_DEMOTION_FORBIDDEN","detail":"You cannot demote your own platform role."}
```

7) 审计 metadata（只有字段名 + 邮件布尔值，无值）：

```
admin.user.updated -> {"changedFields":["email","locale","timezone"],"emailVerificationSent":true}
admin.user.updated -> {"changedFields":["name"]}
admin.permissions.updated -> {"changeCount":1,"changedActions":["support:admin:flags:read:true"]}
```

## 4. CodeGraph 证据

```
$ codegraph status
[OK] Index is up to date   (1,502 files / 19,714+ nodes)

codegraph_explore(
  projectPath: "C:\Users\BY9700\Desktop\UI\roamlog",
  query: "admin users controller service AdminUsersController AdminUsersService admin user list update"
)
命中：apps/api/src/modules/admin/admin-users.controller.ts / admin-users.service.ts /
packages/contracts/src/api/admin.ts / admin-selects.ts / actor-context.ts /
apps/admin/lib/admin-data-source.ts / apps/admin/components/users/users-view.tsx
关键结论：PATCH 已存在但只处理 status/platformRole（service.update 145–198 行）；
审计 metadata 带值（需按任务改为只写字段名）；权限矩阵由 permissions.ts 常量派生。
```

## 5. 已知风险 / 未覆盖项

1. **覆盖层未参与运行时鉴权**：`canPlatform` 仍是同步纯函数，`GET /permissions` 会合并 DB diff，但管理员实际调用仍按代码矩阵鉴权。若要让 override 真正生效，需要把 AdminGuard/`canPlatform` 改成异步 + 缓存（本次任务范围只定义读取合并与受控编辑）。
2. **OpenAPI / api-client 未重新生成**（任务禁止）：`scripts/openapi/paths-admin.ts`、`schemas.ts` 未登记 `/v1/admin/permissions` 与 `UpdateAdminUserResponseSchema`；根 Agent 串行执行 `contracts:generate`/`api-client:generate` 时需补这两处，否则 `contracts:check` 会因 openapi.json 旧而失败。Admin 前端的新端点用手写 same-origin fetch，不依赖生成客户端。
3. 权限矩阵不限制给 `user` 角色授予 grantable 动作（任务只规定 grantable 白名单）。若产品希望禁止，需要额外 422 规则。
4. `admin:workspaces:transfer` 在 `ADMIN_ACTIONS` 中尚不存在，只登记在不可授予集合；等该动作落地后自动锁定。
5. 真实联调使用本机新起 API 实例（4200）+ `b3_live` schema；4000 旧进程未重启，未在 4000 上验证新端点。
6. 未做浏览器端截图；Admin 视觉验证以 build + jsdom 组件测试为准。

## 6. 建议下一步

1. 根 Agent：`contracts:generate` 时补 admin permissions 路径/响应 schema；再跑 `contracts:check` 与 `api-client:generate`。
2. 在 `apps/admin/components/admin-shell/admin-nav.ts` 的「信任与安全」组加入：

```ts
{ href: "/admin/permissions", label: "权限矩阵", icon: ShieldCheck },
```

（`ShieldCheck` 需加入同文件 lucide-react import；该文件当前由另一 Agent 占用，本任务未修改。）

3. 后续把 override 层接入 AdminGuard（异步/缓存）并补一条“override 生效”的 API e2e。