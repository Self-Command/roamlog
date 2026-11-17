# STG-SERVICES-FINISH delivery report

状态: DONE（可用范围内的真实链路已验证；存在明确未覆盖项）
任务 ID: STG-SERVICES-FINISH
角色: Staging 真实媒体/邮件链路收尾工程师
工作目录: `C:\Users\BY9700\Desktop\UI\roamlog`
结论: 已在本机真实二进制 MinIO、Mailpit、Redis 上完成 Storage、邮件、
worker media、export ZIP/7 天过期与 BullMQ 队列验证。所有相关测试、typecheck、
build 通过。未 commit、未创建分支、未停止 3000/3001 预览。

## 1. 接手状态

- `tooling/services/**` 与 7 个 staging test 已存在，未重做。
- 二进制已下载并存在：
  - MinIO community build：`runtime/bin/minio.exe`，由源码 tag
    `RELEASE.2025-09-07T16-13-09Z` 构建，运行时报告
    `DEVELOPMENT.GOGET (go1.27.3 windows/amd64)`，License `GNU AGPLv3`。
  - Mailpit：`runtime/bin/mailpit/mailpit.exe v1.34.0`。
  - Redis：`runtime/bin/redis/Redis-8.10.3-Windows-x64-msys2/redis-server.exe`，
    `Redis server v=8.10.3`。
- 接手时三个 PID 文件存在但进程已退出，`9000`、`8025`、`6379` 均连接失败。
  `pwsh -NoProfile -File tooling/services/staging-services.ps1 -Action start`
  重启后三个服务均为 healthy。
- 3000/3001 预览全程保持运行：Web `200`，Admin `307`，本任务未停止或重启。

## 2. 运行中的 staging 服务

| 服务                | 端口            | 健康检查结果                    | 版本                                                |
| ------------------- | --------------- | ------------------------------- | --------------------------------------------------- |
| MinIO API / Console | `9000` / `9001` | `/minio/health/live` = 200      | community build from `RELEASE.2025-09-07T16-13-09Z` |
| Mailpit SMTP / UI   | `1025` / `8025` | `/livez` = 200，SMTP 端口可连接 | v1.34.0                                             |
| Redis               | `6379`          | `PING` = `PONG`                 | 8.10.3                                              |

三个服务均只绑定 `127.0.0.1`。Redis 无密码、MinIO 使用本地 root 凭据，
仅适用于本地 staging 检查，不可暴露到共享主机或生产网络。

## 3. 实际验证结果

### 3.1 真实 MinIO

由 `apps/api/test/staging-storage.e2e-spec.ts` 在 `roamlog-test` bucket 上执行：

- bucket 已存在且为私有：`GetBucketPolicy` 返回 `NoSuchBucketPolicy`。
- presign PUT：返回 `X-Amz-Signature`，`Content-Type: image/png`。
- 使用 presigned URL 真实上传 PNG：HTTP 200。
- `completeUpload`：返回正确 `size`、`contentType: image/png` 与非空 `ETag`。
- signed read：HTTP 200，读回字节与上传字节完全一致。
- 匿名直读对象：HTTP 403/404，未泄露对象。
- `deleteObject` 后再次 `completeUpload`：HTTP 404。
- 测试结束后清理对象，bucket 当前对象数为 **0**。
- MinIO CORS 预检：允许来源 `http://localhost:3000` 返回 204 且
  `Access-Control-Allow-Origin: http://localhost:3000`、credentials=true；
  非允许来源返回 204 但不回显 ACAO，浏览器会拦截。
- 说明：MinIO 不支持 bucket-level CORS，`bootstrap-bucket.mjs` 会报告 warning；
  实际 allowlist 由 `MINIO_API_CORS_ALLOW_ORIGIN` 在 MinIO 进程级生效。

### 3.2 Mailpit 邮件

API 真实 SMTP 链路（`EmailDeliveryService` -> `127.0.0.1:1025` -> Mailpit）：

- 验证邮件：收件人 `verify-8c64d461@roamlog.test`，Mailpit ID
  `2UUfrKBIcksT4KtSQh0BPV`。
- 邀请邮件：收件人 `invite-8c64d461@roamlog.test`，Mailpit ID
  `6a5sGP7S8T3FOqTICj02nJ`。
- EmailLog mock 中两条记录均为 `sent`。
- 第二次 API 复跑（加入过期 export 用例后）又验证了
  `4g4kTM5tNGnuWT3U7XAvyj` 与 `6DkwcmBB8aU4EGHwvw1BQ1`。

Worker Mailpit provider 链路（`EMAIL_PROVIDER=mailpit`）：

- workspace-invite：`6b5lW1j9sSWObpW52LGEhF`
- verify-email：`6csVVZp4JSmLHbeSRvVZNY`
- mention：`5eTrgR3HD8c8vcxCjAVaXD`
- 第二次 worker 全量运行的 ID：
  `7bTbHx5lYb9SoseKYdxlrE`、`6qCF0cT45HDTSP9Bj2SfOA`、
  `5zFt5ZMCsrKCsRkGtbbwuW`。
- 三条 EmailLog mock 均为 `sent`，均有非空 `providerId`。

Email template smoke（真实 Mailpit HTTP send + API 校验）：

- `workspace-invite` -> `0T5S3Eebtyhm6V6Bhuh5LL`
- `verify-email` -> `4KGMc4uoeLlT8PYiw098wE`
- `reset-password` -> `6fQ6ARUIFHJY6eH75S3cEH`
- `mention` -> `3Z7t2ZmFWC3Oxxm4Ceelfs`
- `trip-reminder` -> `3S0fxnVTqteJMPpOR0wv2N`
- 5 封均按 ID、主题、收件人 `local@roamlog.test` 从 Mailpit API 读回并校验；
  smoke 结束时 `mailboxTotal=12`；随后的 worker 全量套件和最终 API 复跑又新增
  5 封，当前 Mailpit 共 17 封。

本任务未使用 Resend，也未向真实外部邮箱发信。

### 3.3 Worker media（sharp + blurhash）

`apps/worker/test/staging-media.spec.ts` 使用真实 MinIO 与 sharp：

- 生成并上传 1600x900 JPEG。
- 直接调用 `handleMediaJob("media.process", ...)`（不经过 BullMQ）。
- 结果：`status: "ready"`，`width=1600`，`height=900`，`blurhash` 非空且长度 > 10。
- 变体共 7 个：
  `original`、`thumb`、`thumbJpeg`、`medium`、`mediumJpeg`、`large`、`largeJpeg`。
- 每个变体都从 MinIO 读回并校验：
  - 实际字节数等于记录 `size`；
  - WebP 变体 `format=webp`，JPEG 变体 `format=jpeg`；
  - 非 original 变体宽度不超过记录宽度。
- 最终数据库更新包含 `status: "ready"`、`width`、`height`、`error: null`。
- 测试产生的 original 与所有变体均已清理。

### 3.4 Export ZIP 与 7 天过期

`apps/worker/test/staging-export.spec.ts` 使用真实 MinIO：

- trip ZIP 包含：
  `trip.json`、`journal.md`、`itinerary.csv`、`expenses.csv`、
  `packing.csv`、`README.txt`、`photos/<mediaId>-original.png`。
- workspace ZIP 包含：
  `workspace.json`、`members.csv`、`README.txt`，
  以及每个 trip 的 `trips/<title>-<tripId>/...` 目录。
- `journal.md` 内容包含真实日志标题；`trip.json` 标题与 `workspace.json`
  workspace 名称均校验通过。
- ZIP 由测试内解析 central directory + 解压条目内容验证，不是只看文件大小。
- `expiresAt - completedAt` 精确等于
  `7 * 24 * 60 * 60 * 1000` 毫秒。

`apps/api/test/staging-export-download.e2e-spec.ts` 使用真实 MinIO：

- ready 且未过期：返回含 `X-Amz-Signature` 的下载 URL，真实 GET 返回 200，
  字节与 ZIP 一致。
- 本次新增过期用例：`expiresAt = now - 1ms` 时：
  - 返回 `status: "expired"`；
  - `downloadUrl: null`；
  - 调用 `markExpired(exportId)`；
  - 对象匿名直读仍为 403/404。

### 3.5 BullMQ 与真实 Redis

`ROAMLOG_TEST_REDIS_URL=redis://127.0.0.1:6379` 下运行
`apps/worker/test/queue.spec.ts`，4/4 真实 Redis 集成用例通过：

- 相同显式 jobId 的重复任务只消费一次（幂等去重）。
- 自定义 jobId 正确传入 idempotent processor contract。
- 失败任务标记 failed 且 worker 继续处理后续任务。
- 五个队列全部注册并可优雅关闭。

说明：media/email/export staging 套件是直接调用 processor handler，
没有执行“BullMQ enqueue -> Redis -> worker consume -> processor”的完整媒体链路。
BullMQ 与 Redis 的可用性已由上述独立集成套件证明。

## 4. 验证命令与真实输出

```text
ROAMLOG_STAGING_SERVICES=1 pnpm --filter @roamlog/api exec vitest run \
  test/staging-storage.e2e-spec.ts \
  test/staging-email.e2e-spec.ts \
  test/staging-export-download.e2e-spec.ts
  -> 3 test files passed / 5 tests passed

ROAMLOG_STAGING_SERVICES=1 ROAMLOG_TEST_REDIS_URL=redis://127.0.0.1:6379 \
  pnpm --filter @roamlog/worker test
  -> 5 test files passed / 16 tests passed

ROAMLOG_TEST_REDIS_URL=redis://127.0.0.1:6379 \
  pnpm --filter @roamlog/worker exec vitest run test/queue.spec.ts --reporter=verbose
  -> 4/4 BullMQ queue integration passed

pnpm --filter @roamlog/api exec vitest run \
  src/modules/exports/__tests__/export-rules.spec.ts \
  src/modules/media/__tests__/media-rules.spec.ts \
  src/modules/invitations/__tests__/invitations.service.spec.ts \
  test/storage.e2e-spec.ts
  -> 4 test files passed / 21 tests passed

pnpm --filter @roamlog/emails test
  -> 1 test file passed / 3 tests passed

pnpm --filter @roamlog/emails email:smoke
  -> status ok, 5 templates verified, mailboxTotal=12 at smoke time

pnpm --filter @roamlog/api typecheck       -> PASS
pnpm --filter @roamlog/worker typecheck    -> PASS
pnpm --filter @roamlog/emails typecheck    -> PASS
pnpm --filter @roamlog/api build           -> PASS
pnpm --filter @roamlog/worker build        -> PASS
pnpm --filter @roamlog/emails build        -> PASS

pwsh -NoProfile -File tooling/services/staging-services.ps1 -Action status
  -> status ok; minio/mailpit/redis all healthy

curl http://localhost:3000                  -> 200（未停止）
curl http://localhost:3001                  -> 307（未停止）
```

## 5. 未执行 / 未覆盖

- 没有真实 PostgreSQL / 真实 Nest HTTP 服务参与本轮 media/export/email 验证；
  API staging 套件中的 Prisma 边界使用 mock。数据库迁移、租户查询和 API
  端到端仍需要在 staging PostgreSQL 上复验。
- 没有执行完整 BullMQ media/export/email 消费链路；本轮是 processor 直接调用
  - 独立 BullMQ/Redis 集成测试。
- 没有使用 Resend、真实 DNS、TLS、OAuth 凭据或外部邮箱；Mailpit 只是本地 sink。
- 没有 Docker/MinIO 容器、k6 负载、备份恢复或生产安全复验；这些仍受
  Docker/Quay 镜像、staging 凭据和 k6 环境限制。
- 没有做桌面/移动端截图；本任务为后端媒体/邮件/队列链路，不涉及 UI 改动。

## 6. 已知风险与建议

1. **MinIO 二进制来源**：本机使用的是从 pinned AGPL 源码 tag 构建的
   `DEVELOPMENT.GOGET`，不是官方发布二进制。它适合本地验证，但 staging
   仍应使用可复现的固定 digest 镜像/构建流水线，并确认 AGPL 合规与供应链来源。
2. **本地服务安全边界**：MinIO root 凭据、无密码 Redis、Mailpit 均只绑定
   loopback。不得在共享主机上直接暴露；staging 必须使用独立应用身份、Redis
   认证/TLS 和 Mailpit/Resend 的网络边界。
3. **测试默认跳过**：staging 套件只有设置 `ROAMLOG_STAGING_SERVICES=1` 才执行。
   建议 CI 增加一个显式 staging-services job，避免“测试通过”实际是全部 skip。
4. **数据库 mock 漂移**：API staging 用例 mock 了 Prisma 边界，不能替代真实
   schema 迁移与约束验证。
5. **MinIO bucket CORS 限制**：进程级 allowlist 已验证；若未来要求 bucket
   级 CORS，需要改用支持该能力的 S3 实现或确认 MinIO 版本行为。

## 7. 文件与边界

本任务直接修改：

- `apps/api/test/staging-export-download.e2e-spec.ts`
  - 新增过期 export 的真实 MinIO 下载 URL 抑制用例。
- `tooling/services/README.md`
  - 修正 CORS 描述；补充 loopback / Redis 无密码风险提示。
- `STG_SERVICES_REPORT.md`（本文件）。

接手时既有、本任务未重做的内容：

- `tooling/services/staging-services.ps1`
- `tooling/services/bootstrap-bucket.mjs`
- `tooling/services/README.md` 的其余部分
- `apps/api/test/staging-*.e2e-spec.ts`
- `apps/worker/test/staging-*.ts`
- `apps/worker/src/dependencies.ts` 的 Mailpit provider
- `packages/emails/src/smoke.ts` 的 Mailpit 回读校验

工作区还包含其他并行/既存改动（例如 media presign rate-limit guard）。
本任务未二次修改这些文件，也未修改 Web/Admin、contracts、DB schema、
migration、root `package.json` 或 lockfile，未新增依赖。

`tooling/services/runtime/**` 下的二进制、日志、PID、Mailpit/Redis/MinIO 数据
由 `runtime/.gitignore` 忽略，不会进入 Git。

未 commit、未创建分支、未推送。3000/3001 预览与三个 staging 服务在任务结束时
仍保持运行。

## 8. 结论

本任务范围内，真实 MinIO 私有存储、presign/complete/signed read/匿名拒绝/删除、
Mailpit 的 SMTP 与 HTTP 邮件投递、sharp 变体与 blurhash、trip/workspace ZIP、
7 天过期规则，以及 BullMQ + 真实 Redis 均已取得可复现通过证据。

这不等于 staging/production-ready：真实 PostgreSQL、Resend/TLS/OAuth、
Docker 镜像、k6、备份恢复和生产安全门禁仍未在本轮执行。下一步应把当前
staging 套件接入真实 staging PostgreSQL 与容器化 MinIO/Mailpit，并让 CI
显式运行而不是默认 skip。
