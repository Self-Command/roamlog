# STG-FULL-CHAIN delivery report

状态: DONE
任务 ID: STG-FULL-CHAIN
角色: Roamlog 完整队列 -> Worker -> MinIO 链路工程师
工作目录: `C:\Users\BY9700\Desktop\UI\roamlog`
最终证据: `e2e/staging-full/evidence/staging-full-chain-mwkvc1nc-31b232.json`

## 1. 结论

已在本机真实服务上跑通一条完整链路：

```text
Better Auth HTTP
  -> API media presign
  -> presigned MinIO PUT
  -> API complete
  -> Redis jobs:ingress
  -> BullMQ media queue
  -> Worker sharp/blurhash
  -> PostgreSQL ready
  -> API signed media read
```

同一轮还验证了：

- API Admin email resend -> Redis ingress -> BullMQ email queue -> Worker ->
  Mailpit，EmailLog 的 `providerId` 与 Mailpit message id 完全一致。
- API export create -> Redis ingress -> BullMQ export queue -> Worker ZIP ->
  MinIO -> API signed download URL -> 实际下载并解析 ZIP。
- Export `expiresAt - completedAt` 精确等于 `604800000ms`（7 天）。
- 媒体首次上传坏数据被 Worker 拒绝，同一 BullMQ job 在自动 backoff 后重试成功。
- 媒体重复 complete 与 export 重复 create 均保持幂等。

最终运行 22.0 秒（22,044ms）完成，状态 `passed`。3000/3001 预览全程保持运行，最终分别返回
`200` / `307`。

## 2. 隔离环境

本轮没有污染用户已有数据库或共享 Redis key：

| 项目       | 本轮值                                                         |
| ---------- | -------------------------------------------------------------- |
| PostgreSQL | 临时 PostgreSQL 17.11，`127.0.0.1:55439`                       |
| 数据库     | `roamlog_mwkvc1nc_31b232`（每轮唯一，public schema）           |
| Prisma     | 2 个真实 migration 全部 apply                                  |
| API        | `127.0.0.1:4300`，`/v1/ready` 三项依赖均 `up`                  |
| Worker     | 真实 `tsx src/main.ts`，五队列全部 ready                       |
| Redis      | 真实 `127.0.0.1:6379`，隔离前缀 `staging-full-mwkvc1nc-31b232` |
| MinIO      | 真实 `127.0.0.1:9000`，私有 bucket `roamlog-test`              |
| Mailpit    | 真实 `127.0.0.1:8025` / SMTP `1025`                            |

API 的 readiness 证据：

```json
{
  "database": { "status": "up" },
  "redis": { "status": "up" },
  "storage": { "status": "up" }
}
```

完成后只清理了本轮对象和 Redis 前缀：8 个 MinIO 对象删除成功，26 个隔离 Redis
key 删除成功。

## 3. 真实成功项

### 3.1 Media + BullMQ 失败重试 + sharp + blurhash

- Presigned PUT 首次上传故意使用非图片字节，HTTP 200。
- API complete 真实入队，Worker 第一次 attempt 以
  `Uploaded object is not a supported image (magic bytes mismatch)` 失败。
- 同一 jobId `media-process-794b3c91d791516288cb9768af8da94b` 在自动重试
  attempt 2 处理有效 1600x900 PNG 并成功。
- Worker 产出 7 个 variants：
  `original`, `thumb`, `thumbJpeg`, `medium`, `mediumJpeg`, `large`,
  `largeJpeg`。
- PostgreSQL 最终 `status=ready`、`width=1600`、`height=900`、
  `blurhashLength=27`。
- API 返回带 `X-Amz-Signature` 的 signed URL；original 下载 HTTP 200，
  SHA-256 `3e881da78c81447062f7441e538c4917c4a43f25e839292b47dc24287e4f6340`，
  字节与重试上传完全一致。
- thumbnail 下载 HTTP 200，`Content-Type: image/webp`。
- 匿名 MinIO 直读为 HTTP 403。
- 再次 complete 返回 `ready`，该 media 只有一个 completed BullMQ job。

### 3.2 邮件队列 -> Worker -> Mailpit

- 通过真实 Admin API 触发 EmailLog resend，API 返回 `queued`。
- Worker completed job：
  `email-resend-436e1ecda90a4614c096fc9fb18863e5`。
- EmailLog 更新为 `sent`，`providerId=0oYGu3QS88tZUzQV2HgUiQ`。
- Mailpit 保留同 id 消息，收件人为
  `staging-full-mwkvc1nc-31b232-worker@roamlog.test`，subject 为
  `验证你的 Roamlog 邮箱`。

这验证了 API -> Redis ingress -> BullMQ email queue -> Worker renderer ->
Mailpit provider，而不是直接调用 processor。

### 3.3 Export ZIP、signed URL、7 天过期

- `POST /v1/exports` 两次使用同一 Idempotency-Key，返回同一 exportId。
- Worker completed export job：
  `export-968d02bc1e056fa8f64d3534bb3ab015`。
- 通过 API 获取 signed URL，HTTP 200，真实下载 3,514,504 bytes ZIP。
- ZIP 实际解压并校验：
  `trip.json`, `journal.md`, `itinerary.csv`, `expenses.csv`,
  `packing.csv`, `README.txt`,
  `photos/<mediaId>-original.png`。
- `trip.json` 标题、`journal.md` 日志内容、ZIP 内照片字节均与 fixture 一致。
- `ttlMilliseconds=604800000`，`ttlDays=7`。
- 匿名直读 export 对象为 HTTP 403。

### 3.4 队列证据

同一轮通过 Worker 结构化日志和 Admin jobs API 观察到：

```text
media : job.active attempt 1 -> job.failed -> job.active attempt 2 -> completed
email : completed
export: completed
```

因此不是“processor 直接调用”或“只有 DB 状态”的间接证据。

## 4. 实现内容

新增：

- `tooling/scripts/staging-full-run.mjs`
  - 检查/必要时单次启动 staging 服务；
  - 启停隔离 PostgreSQL；
  - 执行真实 Prisma migration；
  - 启动真实 API 与 Worker；
  - Better Auth 建号、登录和真实 HTTP 请求；
  - 全链路媒体、邮件、导出验证；
  - 保存 sanitized JSON evidence；
  - 清理本轮对象、Redis key 和临时 PG 数据。
- `e2e/staging-full/README.md`
- `e2e/staging-full/.gitignore`
- `e2e/staging-full/evidence/latest.json`
- `e2e/staging-full/evidence/staging-full-chain-mwkvc1nc-31b232.json`

修改：

- `apps/worker/src/dependencies.ts`
  - 修复真实 Worker runtime 下 `@roamlog/emails` 的 React JSX 渲染：
    tsx 以 classic JSX 方式加载共享模板时缺少全局 `React`，此前真实 email job
    会失败为 `React is not defined`。
  - 现在从已声明的 `@roamlog/emails` 依赖解析 React，再加载模板。
  - 该文件在任务开始前已包含其他并行任务的 Mailpit/export helper 改动；本任务
    只新增上述两行 runtime 处理，未回滚或改写既有内容。

未修改：

- Web/Admin
- contracts
- Prisma schema/migration
- Docker/CI
- root `package.json`
- lockfile
- API media/exports 业务代码

没有新增依赖、没有 commit、没有创建分支。

## 5. 验证命令与结果

```text
node --check tooling/scripts/staging-full-run.mjs
  -> PASS

node tooling/scripts/staging-full-run.mjs
  -> status=passed, 22.0s, 14 evidence check groups

$env:ROAMLOG_STAGING_SERVICES='1'
$env:ROAMLOG_TEST_REDIS_URL='redis://127.0.0.1:6379'
pnpm --filter @roamlog/worker test
  -> 5 test files / 16 tests PASS

ROAMLOG_STAGING_SERVICES=1
pnpm --filter @roamlog/api exec vitest run \
  src/modules/media/__tests__/media-rules.spec.ts \
  src/modules/exports/__tests__/export-rules.spec.ts \
  test/staging-storage.e2e-spec.ts \
  test/staging-export-download.e2e-spec.ts
  -> 4 test files / 11 tests PASS

pnpm --filter @roamlog/emails test
  -> 1 test file / 3 tests PASS

pnpm --filter @roamlog/worker typecheck   -> PASS
pnpm --filter @roamlog/api typecheck      -> PASS
pnpm --filter @roamlog/emails typecheck   -> PASS

pnpm --filter @roamlog/worker build       -> PASS
pnpm --filter @roamlog/api build          -> PASS
pnpm --filter @roamlog/emails build       -> PASS

Web  http://localhost:3000                -> HTTP 200
Admin http://localhost:3001               -> HTTP 307
```

## 6. 未执行 / 未覆盖

1. 未使用 Resend、真实域名、TLS、DNS 或外部邮箱；邮件仍由 Mailpit sink 接收。
2. 未在 Docker Compose 容器中运行 PostgreSQL/MinIO；本轮是真实本机二进制服务 +
   隔离临时 PostgreSQL 17.11 数据库。
3. 未执行跨主机网络、对象存储独立 IAM 身份、OAuth 或生产 Cookie/CORS/CSP/HSTS。
4. 未执行 k6、备份/恢复、回滚、监控告警或 GitHub Actions 实跑。
5. 未进行 Web/Admin 桌面与移动端视觉检查；本任务不修改 UI。
6. 未清理 Mailpit 历史消息；只验证了本轮消息存在。清理 MinIO 与 Redis 已完成。

## 7. 风险与建议

1. **Worker 邮件渲染 fix 应进入 CR。** 该修复依赖 `@roamlog/emails` 的
   `react` 传递依赖仍存在；若未来重构 package exports 或改用预编译 dist，应同步
   增加 Worker 真实 runtime 回归测试。
2. **staging harness 依赖本机 embedded PostgreSQL 二进制。** 当前自动发现
   `.data/bootstrap-e2e/**/native/bin`；clean host 需设置 `ROAMLOG_PG_BIN`。
   后续建议把 PostgreSQL 纳入与 MinIO/Mailpit/Redis 同一套服务脚本。
3. **本地 loopback 服务安全边界不变。** MinIO root 凭据、无密码 Redis 和 Mailpit
   只适用于本机 staging 验证，不可暴露到共享网络。
4. **Admin email resend 不保存原始 template data。** 本轮证明了 delivery、job
   与 provider id 一致；但 `EmailLog` 只有 template/subject，Worker 无法重建原
   邀请或验证链接。若 resend 必须产生可操作邮件，需要后续单独设计模板数据持久化，
   或让 API 重新生成 action URL。
5. 建议后续把 `node tooling/scripts/staging-full-run.mjs` 作为显式 staging job
   接入 CI/staging runner，并提供容器化 PostgreSQL 与固定 digest MinIO。

## 8. 交接

可重复运行：

```powershell
node tooling/scripts/staging-full-run.mjs
```

预期输出：

```text
status: passed
evidence: e2e/staging-full/evidence/staging-full-chain-<runId>.json
```

最终成功 evidence 已写入 `latest.json`，可直接交给 QA/根 Agent 验收。
