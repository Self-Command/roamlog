# W0_MAIL — 生产邮件链路从 Mailpit 拆出（Resend/SMTP + SPF/DKIM/DMARC）

状态: DONE（3 项验证受环境/并行改动限制，已在 §6 明确标注）
任务 ID: W0_MAIL
角色: devops / data_worker
日期: 2026-11-18

## 1. 变更文件

新增

- `docker/compose.production.yml`
- `docker/production.env.example`
- `apps/worker/test/email-sender.spec.ts`
- `tooling/scripts/check-email-dns.mjs`
- `docs/operations/email-production.md`
- `.audit/w0-mail-report.md`、`.audit/w0-mail-report.checkpoint.md`

修改

- `apps/api/src/config/environment.ts`
- `apps/api/src/config/app-config.service.ts`
- `apps/api/src/config/environment.spec.ts`
- `apps/worker/src/dependencies.ts`（仅邮件段 + 顶部 import/依赖注入一行）
- `deploy/README.md`

未触碰（按要求）：`apps/web/**`、`apps/admin/**`、`packages/**`、
`docker/compose.staging.yml`、`docker/compose.server.yml`、
`.github/workflows/**`、lockfile、其他 `.audit` 文件。未执行任何 git 写操作，
未安装依赖。

## 2. 实现摘要

### 2.1 独立生产 compose `docker/compose.production.yml`

- `name: roamlog`，单文件独立，不与 legacy 双文件叠加。
- 9 个服务：`postgres`、`redis`、`minio`、`minio-init`、`migrate`、`api`、`worker`、
  `web`、`admin`；**无 mailpit**（全文不含该词）。
- `env_file: /opt/roamlog/config/.env.production` 挂在 migrate/api/worker/web/admin。
- 应用镜像全部 `ghcr.io/self-command/roamlog/*:${ROAMLOG_IMAGE_TAG:?ROAMLOG_IMAGE_TAG is required}`。
- 端口只绑 `127.0.0.1`：web 13000、admin 13001、api 14000、minio 19000/19001
  （均由 `PRODUCTION_*_PORT` 覆盖）。Postgres/Redis 无宿主端口。
- 数据卷改为 bind：`/opt/roamlog/data/{postgres,redis,minio}`；minio 沿用
  server override 的 digest 固定 + `user 65532` + `read_only` + `shm_size`。
- 加固单锚点 `x-app-service`：`init`、`restart: unless-stopped`（migrate 为 `no`）、
  `no-new-privileges`、`cap_drop: ALL`、日志轮转；postgres/redis/minio 同样带
  `no-new-privileges`；network 分 `edge` / `egress` / `backend(internal)`。
- healthcheck 沿用现有风格：infra 显式（pg_isready / redis-cli PING /
  MinIO `/minio/health/live` 走 /dev/tcp），api/web/admin/worker 依赖镜像内
  HEALTHCHECK（Dockerfile 已有）+ `depends_on: service_healthy`。
- 无任何字面密钥，全部 `${VAR:?}` / `${VAR:-}` 引用。

### 2.2 生产 env 模板 `docker/production.env.example`

- 全部占位：`CHANGE_ME_*`、`re_xxxxxxxxxxxxxxxxxxxxxxxx`、`smtp.example.com`、
  `CHANGE_ME.example.com`；无真实域名/邮箱/密钥。
- 显式 `APP_ENV=production`、`EMAIL_PROVIDER=resend`、`EMAIL_FROM`、
  `RESEND_API_KEY`、`SMTP_*`、`S3_PUBLIC_BASE_URL`。
- 注释用 `[deployer]` / `[secret]` / `[fixed]` 标注谁填、哪些由密管注入；
  resend 与 smtp 两套路径分别给出，并说明 `SMTP_HOST` 在 resend 时必须是空。

### 2.3 配置校验（`environment.ts` + `app-config.service.ts`）

- 新增 `APP_ENV` 枚举 `development|staging|production|test`，默认 `development`。
- 新增 `EMAIL_PROVIDER` 枚举 `resend|smtp|mailpit`，默认 `smtp`（本地 Mailpit 兼容）。
- `APP_ENV=production` 时（`NODE_ENV` 保持原有 CORS/HTTPS 校验不动）：
  - 禁止 `mailpit`；
  - `resend`：必须有 `RESEND_API_KEY`、必须 `re_` 前缀且非占位，`EMAIL_FROM` 不得为
    `.local`，`SMTP_HOST` 必须为空；
  - `smtp`：必须 host/port/user/password，host 不得为 `mailpit`/`localhost`/
    `127.0.0.1`/`0.0.0.0`/`::1`/`host.docker.internal`/`*.local`/`*.example.com`，
    端口不得为 1025（本地 catcher），密码不得为占位；
  - 任何 provider 下 `EMAIL_FROM` 都不得是 `.local`（原任务只要求 resend，这里统一加固）。
- 失败信息只包含变量名与规则，从不回显密钥值（有专门测试断言）。
- `AppConfigService` 新增只读 getter `appEnv`、`emailProvider`；`isProduction`
  语义保持不变（47 处调用方零影响）。

### 2.4 Worker 邮件发送（仅邮件段）

- `createEmailSender(logger?)`，由 `createWorkerDependencies` 传入现有 logger（可选参数，
  旧调用点兼容）。
- 生产判定以 `APP_ENV` 为准；`APP_ENV` 未设置时回退 `NODE_ENV=production`，
  保持 legacy staging 原有行为。
- `EMAIL_PROVIDER=mailpit` 在 `APP_ENV=production` 直接拒绝，`fetch` 都不发。
- `EMAIL_PROVIDER=resend`：15s→20s 超时；成功返回 Resend `id`，缺 `id` 时回退
  idempotency key；日志只有 `{event, transport, status, providerId}`。
- 失败分级：5xx/408/425/429 → `EmailDeliveryError`（可重试，BullMQ 退避）；
  其余 4xx 与配置错误 → `NonRetryableEmailError extends UnrecoverableError`
  （立即 failed，不消耗 5 次重试）。错误/日志均不含响应体、不含 API key、
  不含收件人（有测试断言 provider body 里的 key 与邮箱都不外泄）。
- `smtp`：worker 镜像无 SMTP 客户端（见 §6.1），抛出明确错误而非静默走 Resend。
- 未新增任何依赖。

### 2.5 DNS 验证脚本 `tooling/scripts/check-email-dns.mjs`

- 纯只读 DNS（`node:dns/promises` Resolver），零依赖、不发信、不调 provider。
- `--domain`（必填）、`--dkim-selector`（默认 `resend`）、`--json`、
  `--timeout`、`--nameserver <ip[:port]>`、`--help`。
- 查 4 类：apex SPF（多重 SPF 判 FAIL，`+all`/`?all` 给 warning）、
  `<selector>._domainkey.<domain>` DKIM（空 `p=` = 密钥已吊销判 FAIL）、
  `_dmarc.<domain>` DMARC（`p=none` 通过但 warning，缺 `rua=` warning）、
  MX（null MX RFC 7505 判 FAIL；apex 无 MX 时回退 `send.<domain>` return-path MX）。
- 输出 PASS/FAIL + 缺失项 + overall；退出码 0 通过 / 1 记录缺失或无效 /
  2 DNS 不可用（明确报错「No network or the configured resolver is unreachable.
  Nothing was graded.」）/ 64 参数错误。

### 2.6 文档

- `docs/operations/email-production.md`：谁发什么信（API 走 nodemailer SMTP/Resend，
  worker 只有 HTTP）、配置规则表、Resend 域名验证与 DNS 记录表（全部 `example.com`
  占位）、SMTP 备选路径、DNS 验证步骤、验收清单、失败回滚、已知缺口。
- `deploy/README.md`：生产改指 `docker/compose.production.yml` +
  `/opt/roamlog/config/.env.production`；新增「Legacy staging stack (not production)」
  章节标注 `compose.staging.yml + compose.server.yml` 仅 staging、保留不删；
  Topology 表把 Mailpit 标为 legacy staging only；compose/RC/bootstrap 命令全部换为生产文件。

## 3. 验证命令与结果

| #   | 命令                                                                        | 结果                                                                                       |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | `pnpm --filter @roamlog/api exec vitest run src/config/environment.spec.ts` | ✅ 14 passed                                                                               |
| 2   | `pnpm --filter @roamlog/api exec vitest run src/config`                     | ✅ 2 files / 17 tests passed（含 app-config-two-factor 回归）                              |
| 3   | `pnpm --filter @roamlog/worker exec vitest run test/email-sender.spec.ts`   | ✅ 13 passed                                                                               |
| 4   | `pnpm --filter @roamlog/worker exec vitest run`（全量）                     | ✅ 2 files passed / 4 skipped；21 passed / 8 skipped（staging 依赖跳过）                   |
| 5   | `pnpm --filter @roamlog/worker typecheck`                                   | ✅ exit 0                                                                                  |
| 6   | `pnpm --filter @roamlog/api typecheck`                                      | ❌ 1 个错误，全部在 `packages/db/src/factories.ts:87` TS2719；本任务文件 0 错误（见 §6.2） |
| 7   | `pnpm --filter @roamlog/db typecheck`（归属验证）                           | ❌ 同样错误 → 属 `packages/db` 自身，并行 Agent 20:00 重生成 Prisma 导致                   |
| 8   | `pnpm exec prettier --check`（全部改动文件）                                | ✅ All matched files use Prettier code style                                               |
| 9   | `docker compose -f docker/compose.production.yml config`                    | ⚠️ 未执行：本机 `docker: command not found`（见 §6.3）                                     |
| 10  | PyYAML 解析 + 40 项 compose 静态断言                                        | ✅ 9 services / 18 个插值变量 / FAILURES: none                                             |
| 11  | `node --check tooling/scripts/check-email-dns.mjs`                          | ✅ syntax OK                                                                               |
| 12  | `codegraph status`（开工 + 收工）                                           | ✅ 两次 `[OK] Index is up to date`（中途各 sync 一次）                                     |

静态断言（#10）覆盖：`name`、服务集合精确相等、无 mailpit、5 个应用镜像 GHCR +
tag 守卫、5 个 env_file 路径、全部服务 `no-new-privileges`、restart 策略、所有
ports 以 `127.0.0.1:` 开头、三个数据 bind 路径、infra healthcheck、无 Resend/aws
密钥字面量、无内联密码、compose 插值变量与 env 模板键一一对应、模板含
`APP_ENV/EMAIL_*/S3_PUBLIC_BASE_URL/ROAMLOG_IMAGE_TAG` 且 `APP_ENV=production`。

## 4. 截图 / 日志 / 接口证据

### 4.1 API 配置校验

```text
✓ src/config/environment.spec.ts (14 tests) 16ms
✓ src/config/app-config-two-factor.spec.ts (3 tests) 4ms
Test Files  2 passed (2)      Tests  17 passed (17)
```

### 4.2 Worker 邮件发送

```text
✓ test/email-sender.spec.ts (13 tests) 30ms
✓ test/jobs.spec.ts (8 tests) 9ms
↓ test/queue.spec.ts (4 tests | 4 skipped)
↓ test/staging-email.spec.ts (1 test | 1 skipped)
Test Files  2 passed | 4 skipped (6)      Tests  21 passed | 8 skipped (29)
```

### 4.3 DNS 脚本真实运行（只读查询，未发信）

`node tooling/scripts/check-email-dns.mjs --domain example.com --timeout 3000` → exit 1：

```text
SPF    PASS example.com (TXT)
         v=spf1 -all
DKIM   FAIL resend._domainkey.example.com (TXT)
         DKIM record has an empty p= value (key revoked)
DMARC  PASS _dmarc.example.com (TXT)
         v=DMARC1;p=reject;sp=reject;adkim=s;aspf=s
         warning: DMARC has no rua= report address
MX     FAIL example.com (MX)
         null MX at example.com (RFC 7505): the domain accepts no mail
overall: FAIL (missing/invalid: dkim, mx)
```

`--domain google.com` → SPF/DMARC/MX PASS、DKIM(selector=resend) FAIL，overall FAIL，exit 1。
`--nameserver 127.0.0.1:53`（无本地 DNS）→ exit 2：

```text
DNS lookup failed for google.com: lookup failed for google.com (ECONNREFUSED: queryTxt ECONNREFUSED google.com)
No network or the configured resolver is unreachable. Nothing was graded.
```

`--help` → exit 0；缺 `--domain` / 非法域名 → exit 64 并打印 usage。

### 4.4 Compose 静态校验

```text
services: 9 interpolated vars: 18
FAILURES: none
```

### 4.5 敏感信息检查

- 全仓改动文件中无真实密钥/邮箱/域名：仅 `CHANGE_ME*`、`re_xxx…`、
  `example.com`、`*.roamlog.app`、`*.roamlog.test`（测试假值）。
- 测试用例 `never logs the API key or the provider response body` 断言：
  provider 响应体里的假 key 与收件人邮箱既不出现在 `error.message`，也不出现在
  日志上下文。

## 5. CodeGraph 证据

1. 开工门禁：
   - `codegraph status` → 首次非 clean（Pending: Added 15 / Modified 13，并行 Agent 造成）；
   - `codegraph sync` → `Synced 28 changed files`、`524 nodes in 5.2s`；
   - `codegraph status` → `[OK] Index is up to date`。
2. 规定查询：
   `codegraph explore "EmailDeliveryService createEmailSender environment.ts AppConfigService compose.server mailpit"`
   → 82 symbols / 8 files。关键结果：
   - `createEmailSender` (apps/worker/src/dependencies.ts:223) → `sendViaMailpit`；
     tests: `apps/worker/test/staging-email.spec.ts`。
   - `AppConfigService` 47 处调用方（bootstrap、configure-app、origin.guard、
     rate-limit 等）→ 决定只新增只读 getter、不改既有 getter 语义。
   - `EmailDeliveryService` 13 处调用方；`send` 3 处内部调用 →
     确认「SMTP 优先于 Resend」的歧义来源。
3. 收工复核：
   `codegraph explore "NonRetryableEmailError EmailDeliveryError createEmailSender emailDomainFrom AppEnvironment EmailProvider"`
   → 新符号已被索引，blast radius 显示 `createEmailSender` 有 3 个调用方、
   `EmailDeliveryError` 3 个调用方，测试挂到 `apps/worker/test/email-sender.spec.ts`。
   随后 `codegraph sync` + `codegraph status` → `[OK] Index is up to date`。

## 6. 已知风险

### 6.1 Worker 没有 SMTP 通道（设计性限制，需决策）

`nodemailer` 只在 `apps/api/package.json` 且只装进 `apps/api/node_modules`；在
`apps/worker` 下实测 `require.resolve('nodemailer')` = `MODULE_NOT_FOUND`，镜像
（`pnpm deploy --prod` 只装 worker 依赖）同样没有。因此：

- worker 生产邮件只能 `EMAIL_PROVIDER=resend`；
- 选 `smtp` 会立刻抛 `NonRetryableEmailError`（明确说明镜像不支持），不会静默降级；
- 若产品要求 worker 走 SMTP，需要新增依赖的 ADR，不属于本任务授权范围。

### 6.2 `pnpm --filter @roamlog/api typecheck` 当前红，但与本任务无关

唯一错误：`packages/db/src/factories.ts(87,3) TS2719`「Two different types with this
name exist, but they are unrelated」。证据：

- 单独 `pnpm --filter @roamlog/db typecheck` 复现同一错误 → 属 `packages/db` 内部；
- `packages/db/src/generated/prisma/` 目录 mtime 20:00（本会话期间被并行 Agent 重新生成），
  `factories.ts` mtime 18:38（早于本会话）；
- `pnpm --filter @roamlog/api typecheck` 的错误清单按文件归并后只有这 1 个文件，
  在 `src/config/**` 下 0 错误。
- `packages/db` 属本任务禁止写入范围，未修改。

结论：本任务文件类型干净；API 全量 typecheck 需 `packages/db` 负责人修复
（重新 `prisma generate` 并清理重复生成的 client 类型）后才能转绿。

### 6.3 未执行 `docker compose config`

本机 `docker: command not found`（Windows Git Bash，无 Docker Desktop/CLI），
无法执行真实 compose 校验。替代证据为 PyYAML 解析 + 40 项断言，覆盖本任务
要求的所有关键约束；但 compose 的插值/合并语义仍需在有 Docker 的主机上跑一次
`docker compose --env-file docker/production.env.example -f docker/compose.production.yml config --quiet`。

### 6.4 API 仍会「SMTP 优先」，只做了启动兜底

`apps/api/src/modules/auth/email-delivery.service.ts` 的 `deliver()` 只要
`config.smtpHost` 存在就优先 SMTP，完全忽略 `EMAIL_PROVIDER`。该文件不在本任务
可写范围，故用启动校验（`EMAIL_PROVIDER=resend` 时 `SMTP_HOST` 必须为空）兜底；
`AppConfigService.emailProvider` 已就绪但尚未被 `deliver()` 使用。

### 6.5 `APP_ENV` 默认值是 `development`

好处是 staging（`NODE_ENV=production` + Mailpit）不被误判为生产；风险是若有人
手工起生产容器却不设 `APP_ENV=production`，邮件严格校验不会触发。缓解：生产
compose 在 `environment:` 中对 5 个应用服务硬写 `APP_ENV: production`，覆盖
env_file，任何人用该文件起服务都无法绕过。

### 6.6 其他

- `compose.production.yml` 的 `minio-init` 用 `quay.io/minio/mc` 的固定 tag
  （不是 digest），与 server override 里 chainguard 构建版本不同；建议首次部署时
  在 `config/image-digests.txt` 记录并考虑改为 digest。
- 生产 env 模板复制后不填就会启动失败（`.example.com`/`CHANGE_ME` 被拒）——
  这是有意的 fail-fast，但要求部署者按文档逐项填写。
- Provider 的 bounce/complaint webhook 仍未消费，只能看 provider 面板。

## 7. 未覆盖项

1. 真实 Resend/SMTP 投递未验证（禁止使用任何真实凭据）；仅验证了代码路径与 mock。
2. `docker compose config` 未执行（无 Docker CLI，见 §6.3）。
3. API 侧按 `EMAIL_PROVIDER` 选择 transport 未实现（文件不可写，见 §6.4）。
4. staging 双文件栈未做任何修改（按要求），因此 staging 仍用 Mailpit；其
   `docker/staging.env.example` 也未加 `APP_ENV`（不在可写范围）。
5. `tooling/scripts/check-env.ts` 未同步新增变量（不在可写范围）；它仍强制
   要求 `RESEND_API_KEY`，与新模板的 resend/smtp 二选一不冲突但不够精确。
6. 未跑 API 全量测试与 e2e；只跑了 config 相关与 worker 全量单测。
7. `apps/api/src/modules/auth/email-delivery.service.ts` 的 SMTP 分支未改（无写权限），
   其 `nodemailer` 动态导入失败时只 warn 然后回退 Resend 的行为保持不变。

## 8. 建议的下一步

1. **P0**：`packages/db` 负责人修复 TS2719（重生成 Prisma client、去重），让
   `pnpm --filter @roamlog/api typecheck` 转绿；这阻塞所有 API 相关任务的验收。
2. **P0**：在有 Docker 的主机跑一次
   `docker compose --env-file docker/production.env.example -f docker/compose.production.yml config`
   并把输出存档；随后在预发布栈上用真实 Resend key 做一次端到端发信（验证/邀请各一封），
   确认 `email_log.providerId` 与 SPF/DKIM/DMARC 对齐。
3. **P1**：把 `EmailDeliveryService.deliver()` 改为按 `AppConfigService.emailProvider`
   分支（resend / smtp / mailpit），删除「SMTP 优先」的隐式行为；同时复用新的
   `NonRetryableEmailError` 语义。
4. **P1**：决定是否给 worker 增加 SMTP 能力（ADR）；在此之前生产必须
   `EMAIL_PROVIDER=resend`。
5. **P2**：把 `check-email-dns.mjs` 接入发布前检查（`release-gate.md` 或 CI），
   并在 `config/image-digests.txt` 记录 minio-init 镜像 digest。
6. **P2**：接 provider 的 bounce/complaint webhook，落到 `email_log` 状态机。
