# STG-BOOTSTRAP-E2E delivery report

状态: DONE
任务 ID: STG-BOOTSTRAP-E2E
角色: 首个 super_admin bootstrap 收尾工程师
日期: 2026-11-17（Asia/Shanghai）
结论: 已在真实 PostgreSQL、Mailpit、Better Auth TOTP 链路上完成首个
`super_admin` bootstrap 闭环，并取得数据库、邮件、审计和并发幂等证据。
这不代表生产环境已放行；Resend/TLS/真实 staging 部署仍未在本轮执行。
未 commit、未创建分支。

## 1. 交付范围

变更文件：

- `apps/api/scripts/bootstrap-admin.ts`
  - super_admin 提升改为事务内重新读取并条件更新。
  - 角色更新和审计均以“active + email verified + 2FA enabled + verified/unlocked
    TOTP factor”为条件。
  - 并发提升只有一个进程产生角色变更和一条审计，另一个进程返回
    `already_bootstrapped`。
- `apps/api/test/bootstrap-super-admin.e2e-spec.ts`
  - 新增真实 PostgreSQL + Mailpit + Better Auth TOTP 的完整 E2E。
  - 覆盖首次邀请、邮件回读、邮箱验证、密码设置、未完成 2FA 拒绝、
    TOTP enroll/verify、并发提升、幂等 no-op 和 schema 隔离。
- `packages/db/src/client.ts`
  - 经根协调者批准的最小共享修复：解析 `DATABASE_URL` 的 `schema` 查询参数，
    并传给 `PrismaPg` 的 `{ schema }`；缺省为 `public`。
  - 修复了运行时 Prisma 模型 SQL 固定使用 `"public"."User"`、忽略
    `?schema=` 的真实隔离缺陷。
- `packages/db/src/__tests__/client.test.ts`
  - 新增连接配置单元测试：显式 schema 正确传递，缺省 schema 为 public。
- `STG_BOOTSTRAP_E2E_REPORT.md`（本文件）

未修改 Prisma schema/migration、Web/Admin、contracts、Docker、CI、root lockfile。
未停止或重启 `3000`/`3001` 预览。

## 2. 真实 E2E 证据

运行环境：

- PostgreSQL: `localhost:55432`，独立 schema `staging_bootstrap_e2e`
- Mailpit: `127.0.0.1:1025` / `127.0.0.1:8025`
- Redis: `127.0.0.1:6379`，独立 prefix
- API: 测试内启动真实 Nest/Better Auth HTTP 服务，动态 loopback 端口
- 运行日期: 2026-11-17 23:52（Asia/Shanghai）

最后一次针对性 E2E:

```text
Test Files  1 passed (1)
Tests       1 passed (1)
Duration    10.18s
```

证据摘要：

| 步骤                      | 实际结果                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------- |
| CLI 首次建号              | `invitation_sent`；`platformRole=user`；`emailVerified=false`；生成密码未输出           |
| Mailpit 收到验证/重置邮件 | ID `27VG8Li6G1QZfeV1uMv8p3` / `7ZnPA4rRhcVy7M7ivT4DYa`，收件人为本次 `.test` 测试地址   |
| 邮箱验证                  | 通过 Mailpit 邮件中的真实 Better Auth callback URL 完成，DB 变为 `emailVerified=true`   |
| 设置密码                  | 跟随 reset callback 取得一次性 token，`POST /v1/auth/reset-password` 返回 200           |
| 未完成 TOTP 时提升        | CLI exit `1`，错误包含 `verified TOTP factor`，未输出邮箱，角色仍为 `user`              |
| TOTP enroll               | 真实 `POST /v1/auth/two-factor/enable` 返回 `totpURI` + backup codes；factor 初始未验证 |
| TOTP verify               | 真实 `POST /v1/auth/two-factor/verify-totp` 返回 200；factor 验证并解除 pending         |
| 并发提升                  | 两个 CLI 同时运行，结果分别为 `promoted` 和 `already_bootstrapped`；只有一条提升审计    |
| 幂等重跑                  | `already_bootstrapped`；提升审计仍只有 1 条，账号不产生额外角色变更                     |
| schema 隔离               | `staging_bootstrap_e2e."User"` 有目标行；`public."User"` 同 ID/email 为 0 行            |

数据库终态（测试账号 `01a1ea35-556c-779f-a042-4f6e064441fc`）：

```json
{
  "emailVerified": true,
  "twoFactorEnabled": true,
  "platformRole": "super_admin",
  "status": "active",
  "factorVerified": true,
  "factorUnlocked": true,
  "audits": ["admin.bootstrap_account_created", "admin.bootstrap_super_admin"],
  "emailTemplates": ["auth.verify-email", "auth.reset-password"],
  "emailStatuses": ["sent", "sent"],
  "publicRowsWithSameIdentity": 0
}
```

两条 audit 的 `actorType` 均为 `system`。创建账号审计记录了
`initialPlatformRole=user`、`initialCredential=generated-not-disclosed`、
`emailVerificationRequired=true`、`secondFactorRequired=true`；提升审计记录了
`previousRole=user`、`forced2fa=true`。两条 EmailLog 均有 `providerId`。

历史 `STG-INFRA-AUTH` 报告的首次 bootstrap 120 秒挂起在本轮未复现。针对隔离
schema 的手动首次邀请耗时约 2.3 秒；完整 E2E 约 6 秒测试执行时间。

## 3. 验证命令与真实结果

通过：

```text
pnpm --filter @roamlog/db exec vitest run src/__tests__/client.test.ts
  -> 1 file / 2 tests PASS

pnpm --filter @roamlog/db test
  -> 3 files / 20 tests PASS；1 seed integration skip
  -> skip 原因：未设置 ROAMLOG_TEST_DATABASE_URL

pnpm --filter @roamlog/db typecheck
  -> PASS

pnpm --filter @roamlog/db lint
  -> PASS

ROAMLOG_STAGING_SERVICES=1 \
ROAMLOG_STAGING_BOOTSTRAP_DATABASE_URL=postgresql://...schema=staging_bootstrap_e2e \
ROAMLOG_STAGING_MAILPIT_URL=http://127.0.0.1:8025 \
pnpm --filter @roamlog/api exec vitest run test/bootstrap-super-admin.e2e-spec.ts
  -> 1 file / 1 test PASS

ROAMLOG_TEST_DATABASE_URL=postgresql://...schema=staging_bootstrap_api_test \
ROAMLOG_STAGING_SERVICES=1 ROAMLOG_TEST_REDIS_URL=redis://127.0.0.1:6379 \
... pnpm --filter @roamlog/api test
  -> 54 test files PASS；267 tests PASS；50.68s

pnpm --filter @roamlog/api typecheck                         -> PASS
pnpm --filter @roamlog/api lint                              -> PASS
pnpm --filter @roamlog/api build                             -> PASS
prettier --check <changed files>                             -> PASS
git diff --check <changed files>                             -> PASS
```

服务与预览：

```text
PostgreSQL localhost:55432              listening
Mailpit 127.0.0.1:1025/8025             healthy
Redis 127.0.0.1:6379                    listening
GET http://localhost:3000               -> 200
GET http://localhost:3001               -> 200
```

## 4. 关键实现说明

1. 建号只走 Better Auth 兼容路径。CLI 生成一次随机初始凭据，但不打印；用户初始
   平台角色为 `user`，邮箱未验证，不预设 TOTP。
2. 账号创建后发送验证邮件和一次性密码重置邮件，通过真实 SMTP -> Mailpit 投递，
   同时在 `EmailLog` 记录模板和投递状态。
3. 角色提升在事务内重新读取账号和 factor，再用条件 `updateMany` 完成。角色、
   active 状态、邮箱验证、2FA 开关、verified/unlocked factor 任一不满足都不会提权。
4. 审计只在角色真正变更时创建。并发落败进程重新读取状态；若已由另一进程完成提升，
   返回 `already_bootstrapped`，不重复写审计。
5. `PrismaPg({ schema })` 修复确保 `?schema=` 真正作用于 Prisma 生成的模型 SQL，
   不再静默落到 public。

## 5. 未执行 / 未覆盖

- 本轮使用本机真实 PostgreSQL/Mailpit，但不是实际 staging/production 域名与
  TLS 环境；`NODE_ENV=test`，未执行 production 环境变量、HTTPS cookie 与
  HSTS/CSP/CORS 复验。
- 未使用 Resend、真实 DNS 或外部邮箱，只证明 Mailpit SMTP sink 的投递和回读。
- TOTP 通过真实 Better Auth HTTP endpoint 完成，未由测试工程师手工在
  `/admin/2fa/enroll` UI 或物理 authenticator app 中点击验证。
- 未使用 Docker 容器运行 PostgreSQL/Mailpit/API；使用本机真实二进制服务。
- 未执行 k6、备份恢复、迁移回滚、CI 发布或首次部署演练。
- `packages/db` 的 seed integration test 因未设置 `ROAMLOG_TEST_DATABASE_URL`
  仍为 skip；本次新增的 client settings 单测和全部 API 测试已通过。

## 6. 风险与建议

1. 共享 `createPrismaClient` schema 修复会影响 API/Worker/脚本所有 Prisma 调用。
   现有无 schema URL 默认 public，保持兼容；仍建议在 staging CI 中显式运行
   API + worker schema 隔离回归。
2. Mailpit 是本地 sink，不能证明 Resend 的 DNS、退信、速率限制或生产可观测性。
   放行前需在真实 staging 用 Resend 和安全邮箱重跑一次。
3. E2E 测试账号、审计和 Mailpit 消息保留在本地独立测试 schema/sink 中，不含生产
   数据。生产环境不得使用测试邮箱或保留测试凭据。
4. 测试会暂时启动真实 API 和 Redis 连接，建议在 CI 中继续显式设置
   `ROAMLOG_STAGING_SERVICES=1`，避免默认 skip 被误读为通过。
5. `STG-QA-SECURITY` 报告的限流/Origin 问题不在本任务范围内，未修复。

## 7. 复现

```powershell
pwsh -NoProfile -File tooling/services/staging-services.ps1 -Action status

$env:DATABASE_URL='postgresql://roamlog:roamlog@localhost:55432/roamlog?schema=staging_bootstrap_e2e'
pnpm --filter @roamlog/db exec prisma migrate deploy

$env:ROAMLOG_STAGING_SERVICES='1'
$env:ROAMLOG_STAGING_BOOTSTRAP_DATABASE_URL=$env:DATABASE_URL
$env:ROAMLOG_STAGING_MAILPIT_URL='http://127.0.0.1:8025'
pnpm --filter @roamlog/api exec vitest run test/bootstrap-super-admin.e2e-spec.ts --reporter=verbose
```

测试输出只包含状态、测试用户 ID、Mailpit message ID、模板和 audit action；
不输出密码、验证 token、TOTP secret 或数据库凭据。

## 8. 边界声明

- 未 commit、未创建分支、未推送。
- 未停止 3000/3001 预览，未修改其运行状态。
- 未修改 Web/Admin、contracts、Prisma schema/migration、Docker、CI 或锁文件。
- 本报告只证明本地隔离 staging 服务上的 bootstrap 闭环，不宣称生产就绪。
