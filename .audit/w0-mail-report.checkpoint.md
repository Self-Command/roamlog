# W0_MAIL checkpoint

任务：把生产邮件链路从 Mailpit 拆出来，接真实 Resend/SMTP，补 SPF/DKIM/DMARC 验证。
角色：devops / data_worker。父 Agent：`session-4aa7acb1-4ebc-4449-a641-118ab8f1287e`。
时间：2026-11-18（Asia/Shanghai）。

## 状态

| 步骤              | 状态 | 证据                                                                                                                |
| ----------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| CodeGraph 门禁    | DONE | 初次 status 有 28 项 pending → `codegraph sync`（524 nodes/5.2s）→ `[OK] Index is up to date`                       |
| 规定 explore 查询 | DONE | `codegraph explore "EmailDeliveryService createEmailSender environment.ts AppConfigService compose.server mailpit"` |
| 上下文材料阅读    | DONE | audit 邮件条目、staging-deployment、compose.staging/server、release.yml、两个 Dockerfile、staging.env.example       |
| 独立生产 compose  | DONE | `docker/compose.production.yml`（9 服务，无 mailpit）                                                               |
| 生产 env 模板     | DONE | `docker/production.env.example`                                                                                     |
| 配置校验          | DONE | `environment.ts` + `app-config.service.ts` + spec                                                                   |
| Worker 邮件发送   | DONE | `apps/worker/src/dependencies.ts` 邮件段重写                                                                        |
| DNS 验证脚本      | DONE | `tooling/scripts/check-email-dns.mjs`（真实 DNS 跑通）                                                              |
| 文档              | DONE | `docs/operations/email-production.md`、`deploy/README.md`                                                           |
| 测试              | DONE | api 17 passed / worker 21 passed（8 skipped）                                                                       |
| compose config    | 部分 | 本机无 docker CLI，改用 PyYAML + 40 项断言静态校验                                                                  |

## 关键决策（后续 Agent 需要知道）

1. **`APP_ENV` 默认 `development`，不是跟随 `NODE_ENV`。**
   staging 也跑 `NODE_ENV=production` 且仍然用 Mailpit；若 `APP_ENV` 默认跟随
   `NODE_ENV`，staging 会被当成生产而在启动时被拒。生产由
   `compose.production.yml` 在 `environment:` 里硬写 `APP_ENV: production`（覆盖
   env_file），所以生产不会漏校验。

2. **Worker 不做 SMTP。** `nodemailer` 只存在于 `apps/api`，在 `apps/worker`
   下 `require.resolve('nodemailer')` = `MODULE_NOT_FOUND`（pnpm 隔离）。生产
   worker 邮件必须 `EMAIL_PROVIDER=resend`；选 `smtp` 会抛
   `NonRetryableEmailError` 并说明原因。要支持需走依赖决策（ADR）。

3. **`EMAIL_PROVIDER=resend` 时强制 `SMTP_HOST` 为空。** 因为
   `EmailDeliveryService.deliver()` 只要 `smtpHost` 存在就优先 SMTP，否则 provider
   会被静默切换。该文件不在本次可写范围，故用启动校验兜底。

4. **可重试 vs 永久失败。** 5xx/408/425/429 → `EmailDeliveryError`（BullMQ 退避重试，
   email 队列 5 次）；其余 4xx（401/403/422）与配置错误 →
   `NonRetryableEmailError extends UnrecoverableError`（立即 failed，不烧重试）。
   错误与日志只带 `transport`/`status`/`providerId`，不含响应体和密钥。

5. **YAML 合并键只允许一个。** 生产 compose 用单一 `x-app-service` 锚点
   （`<<` 重复在 YAML 里是重复键）。

## 未完成 / 交回父 Agent 的事项

- `apps/api/src/config/environment.spec.ts` 以外的 API 测试未跑（时间）。
- API `EmailDeliveryService.deliver()` 仍未读 `EMAIL_PROVIDER`（不在可写范围）。
- `pnpm --filter @roamlog/api typecheck` 当前红：`packages/db/src/factories.ts:87`
  TS2719（Prisma 生成物在 20:00 被并行 Agent 重生成导致类型身份重复）。单独跑
  `pnpm --filter @roamlog/db typecheck` 同样报错，与本任务 diff 无关；本任务文件 0 错误。
- 未跑 `docker compose config`（本机 `docker: command not found`）。
- 未使用任何真实 Resend/SMTP 凭据（禁止），故真实投递未验证。
