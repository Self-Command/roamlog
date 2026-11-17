# W0-API-PLATFORM Delivery Report

状态: DONE_WITH_CONCERNS

任务 ID: W0-API-PLATFORM

## 变更文件

- `apps/api/package.json`
- `apps/api/README.md`
- `apps/api/tsconfig.json`
- `apps/api/tsconfig.build.json`
- `apps/api/vitest.config.ts`
- `apps/api/src/main.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/bootstrap/configure-app.ts`
- `apps/api/src/config/**`
- `apps/api/src/common/**`
- `apps/api/src/modules/health/**`
- `apps/api/src/modules/prisma/**`
- `apps/api/src/modules/redis/**`
- `apps/api/src/modules/storage/**`
- `apps/api/src/modules/idempotency/**`
- `apps/api/src/modules/audit/**`
- `apps/api/src/modules/observability/**`
- `apps/api/scripts/bootstrap-admin.ts`
- `apps/api/test/**`

未修改 `packages/**`、其他 `apps/**`、root workspace 配置、Docker、CI、原型或设计文档。最终 `pnpm-lock.yaml`、`pnpm-workspace.yaml` 与 HEAD 无 diff。

## 实现摘要

- NestJS 12.5.1 平台应用，监听 `4000`，全局前缀 `/v1`。
- `GET /v1/health` liveness、`GET /v1/ready` DB/Redis/S3 并发 readiness、`GET /v1/metrics` Prometheus 指标。
- RFC 7807 `ProblemDetailsFilter`，未知路由返回 `application/problem+json` 和 404。
- 安全 request ID、pino JSON 日志、HTTP latency/count/process metrics、Sentry 可选初始化及 5xx 捕获。
- helmet 安全头、CORS Web/Admin allowlist、credentials、cookie-parser、共享 httpOnly session cookie 配置。
- Zod 环境变量校验；生产环境强制 HTTPS URL、显式 CORS origin、非占位 Auth secret。
- Prisma 7 客户端包装、lazy Redis 适配器、S3/MinIO presign/complete/delete/signed-read。
- 24 小时 Redis 幂等结果与并发占位、AuditLog 写入骨架。
- `apps/api/scripts/bootstrap-admin.ts` CLI：只提升已存在、邮箱已验证且有完整 TOTP factor 的账号；不改写/打印密码；生产必须 `--force`。
- 明确未实现认证、Workspace、Trip、Entry、媒体业务 CRUD、实时或 Worker 逻辑。

## 新增依赖

Dependencies:

- `@aws-sdk/client-s3@3.1170.0`
- `@aws-sdk/s3-request-presigner@3.1170.0`
- `@nestjs/common@12.5.1`
- `@nestjs/config@12.1.1`
- `@nestjs/core@12.5.1`
- `@nestjs/platform-express@12.5.1`
- `@roamlog/contracts@workspace:*`
- `@roamlog/db@workspace:*`
- `@sentry/node@11.13.0`
- `cookie-parser@1.4.7`
- `helmet@8.3.0`
- `ioredis@6.0.0`
- `pino@10.4.0`
- `pino-http@11.0.0`
- `prom-client@15.1.3`
- `reflect-metadata@0.2.2`
- `rxjs@7.8.2`
- `zod@4.6.7`

Dev dependencies:

- `@nestjs/testing@12.5.1`
- `@types/cookie-parser@1.4.10`
- `@types/express@5.0.6`
- `@types/node@24.10.1`
- `@types/supertest@7.2.1`
- `supertest@7.3.2`
- `tsx@4.23.15`
- `typescript@5.9.3`
- `vitest@5.1.0`

## 验证命令与结果

1. 测试

```powershell
cd apps/api
.\node_modules\.bin\vitest.cmd run
```

结果：PASS。`5` 个测试文件、`14` 个测试全部通过。

覆盖：liveness、readiness 200/503、DB/Redis/S3 检查、metrics、RFC 7807 未知路由、request ID、CORS/安全头、S3 presign/complete/key traversal、24h 幂等重放与失败清理、生产环境配置拒绝。

测试先于实现编写。首次可执行红灯为 `7 passed / 2 failed`：`instance` 未包含 `/v1` 前缀，以及不安全 request ID 的测试输入本身被 HTTP 客户端拒绝；修正实现与测试输入后全绿。

2. TypeScript

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit
```

结果：exit `0`，无错误。

3. Build

```powershell
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.build.json
```

结果：exit `0`，生成 `apps/api/dist/main.js`。

4. Lint / format

```powershell
node node_modules/eslint/bin/eslint.js apps/api
node node_modules/prettier/bin/prettier.cjs --check "apps/api/**/*.{ts,json,md}"
```

结果：均通过。

5. 启动与路由探测

```powershell
cd apps/api
.\node_modules\.bin\tsx.cmd src\main.ts
.\node_modules\.bin\tsx.cmd dist\main.js
```

- 两种启动方式均在 `http://localhost:4000` 成功启动。
- `GET /v1/health`：`200 {"status":"ok"}`。
- `GET /v1/metrics`：`200`，包含 `process_cpu_seconds_total`、`roamlog_http_requests_total`、`roamlog_http_request_duration_seconds`。
- `GET /v1/does-not-exist`：`404 application/problem+json`，`instance` 为 `/v1/does-not-exist`，`code` 为 `NOT_FOUND`。
- 响应包含 `x-request-id`、CSP、`X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff` 等；HSTS 仅在 `NODE_ENV=production` 启用。
- `GET /v1/ready` 在当前机器返回预期 `503`：Postgres、Redis、MinIO 均不可达。Docker CLI 在该环境不可用，因此未取得真实三依赖健康时的 live 200；该路径已由 e2e adapter-boundary 测试覆盖为 200。

6. Bootstrap CLI

```powershell
cd apps/api
.\node_modules\.bin\tsx.cmd scripts\bootstrap-admin.ts --force --email admin@roamlog.local
```

结果：exit `1`，因数据库不可达停止；未创建账号、未输出密码。正常路径要求目标账号已有已验证邮箱与完整 TOTP factor。

## 未覆盖 / 风险

- 未运行根包安装后的 `pnpm --filter @roamlog/api ...` 包装命令。首次尝试时 pnpm 12 的运行前依赖校验自动触发安装并改写 root lock/workspace；已中止并恢复两个 root 配置文件，后续一律直接调用 `apps/api/node_modules/.bin/**` 验证。root Agent 的统一安装仍需重新生成 lock。
- pnpm 12 自动安装期间按其 supply-chain 策略追加了 NestJS、Sentry、S3 presigner 等 `minimumReleaseAgeExclude` 条目；相关 root 文件已恢复，统一安装时需由 root Agent 复核并保留/提交这些允许项。
- Docker CLI 不可用，未做真实 Postgres/Redis/MinIO readiness 200、MinIO upload round-trip 或 DB 审计写入集成验证。
- Admin bootstrap 目前只提升已有 2FA 账号，不创建首个账号，也不发送设置密码/2FA 邮件；原因是 Wave 0 尚无 Better Auth、Resend 与 TOTP enrollment 流程。脚本不会伪造 2FA row。
- `TwoFactor` schema 没有 verified/enabled 字段，CLI 只能要求 secret 与 backup codes 非空；严格 enrollment 验证应在 Better Auth 模块补齐。
- `/v1/metrics` 当前按任务要求公开暴露；生产网络层保护/采集鉴权尚未实现。
- 认证、CSRF session enforcement、限流、租户隔离、业务 CRUD、realtime、Worker 均属于后续 Wave，未在本任务实现。
- MinIO/S3 测试使用真实 AWS SDK presign 与 mock S3 transport；尚无真实对象存储 e2e。
- root `admin:bootstrap` 仍指向 `tooling/scripts/bootstrap-admin.ts`（该路径由 root/其他 agent 持有）。API 内部等价命令为 `pnpm --filter @roamlog/api admin:bootstrap -- --force`，需 root 决定最终接线。

## 建议下一步

1. root Agent 在统一 `pnpm install` 后运行：

```powershell
pnpm --filter @roamlog/api test:e2e -- health problem-details storage
pnpm --filter @roamlog/api typecheck
pnpm --filter @roamlog/api build
pnpm --filter @roamlog/api lint
```

2. 启动 Docker Compose，执行数据库迁移后复验 `/v1/ready` 真实 `200` 和 MinIO presign/complete。
3. Wave 1 Better Auth 落地后，补齐首个 super_admin 创建、设置密码邮件与严格 TOTP enrollment；再决定 root `admin:bootstrap` 的最终入口。
4. 生产部署前明确 `/v1/metrics` 的网络或鉴权边界，并在 API 入口增加 rate limiting。
