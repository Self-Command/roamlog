# 根 Agent 验收记录 — W0_MAIL

任务 ID: W0_MAIL
验收结论: **ACCEPT（条件：docker compose config、真实投递延后到 G6）**
时间: 2026-11-18 21:05
交付: `.audit/w0-mail-report.md`、`docker/compose.production.yml`、`docker/production.env.example`、`docs/operations/email-production.md`、`tooling/scripts/check-email-dns.mjs`

## 通过

- 独立生产栈 `docker/compose.production.yml`：`name: roamlog`，9 服务，**无 mailpit**；镜像全部 GHCR + `${ROAMLOG_IMAGE_TAG:?}` 守卫；端口仅 127.0.0.1（web 13000 / admin 13001 / api 14000 / minio 19000-19001）；数据卷 bind `/opt/roamlog/data/*`；`no-new-privileges`、`cap_drop: ALL`、日志轮转。
- `docker/production.env.example`：52 键、全占位、零真实密钥，标注 [deployer]/[secret]/[fixed]。
- 配置校验：新增 `APP_ENV`、`EMAIL_PROVIDER`；production 下禁 mailpit、resend 需 `re_` key 且 SMTP_HOST 必须空、smtp 需真实 relay（拒 mailpit/localhost/example.com/*.local/1025）、EMAIL_FROM 不得 .local；报错只含变量名不回显密钥。
- Worker 邮件段：生产判定以 `APP_ENV` 为准；`NonRetryableEmailError` 分级（4xx 不重试、429/5xx 可重试）；日志只含 event/transport/status/providerId。
- DNS 检查脚本真跑：example.com → SPF PASS / DKIM FAIL（空 p=）/ DMARC PASS+警告 / MX FAIL（null MX）；离线 → exit 2 且明确“Nothing was graded”。
- 测试：api config 2 files / 17 tests；worker 21 passed；worker typecheck exit 0；prettier 全过；compose 静态断言 40 项无失败。

## 条件项 / 后续

1. **P0 阻塞已定位**：`packages/db/src/factories.ts` TS2719 阻断 api typecheck（非本任务引入），已派 `DB_FACTORY_FIX`。
2. 未跑 `docker compose config`（本机无 Docker）→ G5/G6 在有 Docker 主机复跑。
3. **Worker 无 SMTP 客户端**（nodemailer 仅存在于 api）：生产 worker 必须 `EMAIL_PROVIDER=resend`，选 smtp 会明确报错。这是设计性限制，需 ADR 决定是否给 worker 加 SMTP。
4. **API 侧仍“SMTP 优先”**：`apps/api/src/modules/auth/email-delivery.service.ts` 只在 smtpHost 存在时优先 SMTP、忽略 `EMAIL_PROVIDER`；已用启动校验兜底（provider=resend 时 SMTP_HOST 必须空），但代码语义仍需后续修。
5. `tooling/scripts/check-env.ts` 未同步新变量（不在可写范围）。
6. 真实 Resend/SMTP 投递未验证（禁止用真实凭据）→ G6 部署后用测试账号端到端验证。
7. 遗留 staging 双文件 + Mailpit 未删除（按要求保留）；deploy/README.md 已标注 legacy，避免误当生产。

## 剩余风险

- minio-init 用固定 tag 而非 digest。
- 未消费 provider bounce/complaint webhook。
- 未设 `APP_ENV` 手起生产会跳过严格校验；已用 compose 硬写 `APP_ENV: production` 缓解。