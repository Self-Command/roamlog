# STG-RELEASE-GATE Report

状态: DONE — 本地隔离 staging gate PASS

日期: 2026-11-17（Asia/Shanghai）

任务 ID: STG-RELEASE-GATE

## 1. 范围与边界

本轮在 `C:\Users\BY9700\Desktop\UI\roamlog` 执行真实服务隔离链路：

| 组件       | 实际使用                                            |
| ---------- | --------------------------------------------------- |
| Web        | `http://127.0.0.1:3100`                             |
| Admin      | `http://127.0.0.1:3101`                             |
| API        | `http://127.0.0.1:4100`                             |
| PostgreSQL | `localhost:55432`，PostgreSQL 18.6，隔离 schema     |
| Redis      | `redis://127.0.0.1:6379`，Redis 8.10.3              |
| MinIO      | `http://127.0.0.1:9000`，bucket `roamlog-test`      |
| Mailpit    | SMTP `127.0.0.1:1025`，HTTP `http://127.0.0.1:8025` |
| k6         | 官方 Windows amd64 v2.4.0                           |

Playwright 使用 schema `staging_release_gate` 与 Redis prefix
`roamlog-staging-release`。k6 使用独立 schema
`staging_release_gate_k6_20261117235126` 与 prefix
`roamlog-staging-release-k6`。API 的 `TRUST_PROXY=true`，限流探针使用
独立的合成 `X-Forwarded-For`，以免不同测试之间共享同一限流窗口。

3000/3001 用户预览未被停止或重启。最终检查：

```text
http://localhost:3000 -> 200
http://localhost:3001 -> 307
```

这是**本机真实二进制服务上的隔离 staging harness**，不是远端 staging
部署；没有 TLS、DNS、OAuth 凭据或真实 Resend。

## 2. k6 二进制下载

官方 release 与资产：

```text
https://github.com/grafana/k6/releases/download/v2.4.0/k6-v2.4.0-windows-amd64.zip
```

下载成功，解压到：

```text
tooling/k6/runtime/k6-v2.4.0-windows-amd64/k6.exe
```

版本与校验：

```text
k6.exe v2.4.0 (commit/dd9395906d, go1.26.11, windows/amd64)
ZIP SHA256:   AAA90B3AFC336FAF90172C7ADDF45C4F41305F6F188E3D564F79466E80AC68E3
EXE SHA256:   6B68DBAE8DE12AE761DA8722F1A182EE3FF47FE68E829B89E74A2796DED83FCB
```

`tooling/k6/runtime/.gitignore` 忽略整个 runtime 目录，二进制和 ZIP 不会进入
Git。

## 3. 实际执行命令

```powershell
# 静态检查
pnpm exec tsc -p e2e/staging/tsconfig.json
# exit 0

pnpm k6:staging:check
# exit 0

pnpm exec prettier --check <release-gate files>
# All matched files use Prettier code style!

# 完整真实 API/浏览器/Admin E2E
pnpm e2e:staging
# 13 passed (1.2m), exit 0

# 独立 PostgreSQL schema、真实 Redis/MinIO/Mailpit、k6
pwsh -NoProfile -File tooling/k6/run-staging-release.ps1
# exit 0
```

`run-staging-release.ps1` 会应用 Prisma migration、生成 fixture、启动只属于该
任务的 4100 API、验证 Mailpit 真实收件、创建真实 trip/share、运行两套 k6，
最后停止该 API 并清理 fixture。它不启动或替换 3000/3001。

## 4. 修复后 P1 安全门禁

| Gate                           | 实际结果                                     | 结论 |
| ------------------------------ | -------------------------------------------- | ---- |
| `GET /v1/auth/get-session` x15 | `200` x15，无 429                            | PASS |
| Auth mutation x12              | 前 10 次非 429，第 11 次 429                 | PASS |
| 未认证 Admin metrics           | `401`，无 session cookie                     | PASS |
| 分享读取                       | 60 x `404`，第 61 次起 429                   | PASS |
| 分享密码                       | 20 x `401`，第 21 次起 429                   | PASS |
| 媒体 presign                   | 20 x `201`，第 21 次起 429                   | PASS |
| 恶意 Origin 自定义写           | `403 CSRF_ORIGIN_REJECTED`                   | PASS |
| 恶意 Origin Better Auth        | `403`                                        | PASS |
| 可选 origin 创建 trip          | `201`，响应 `origin: "未填写"`               | PASS |
| 429 `Retry-After`              | 由统一 Problem Details / rate-limit 响应验证 | PASS |

令牌枚举改为 20 个随机 token 的语义采样；完整 61 次阈值由独立 IP 的
rate-limit 探针执行，避免把“枚举 64 次”和“60/min 阈值”混在同一个测试中。

证据：

- `test-results/staging-release/evidence/rate-limit-probes.json`
- `test-results/staging-release/evidence/csrf-probe.json`
- `test-results/staging-release/evidence/optional-origin.json`
- `test-results/staging-release/evidence/share-and-media-gates.json`

## 5. Admin 真实操作 E2E

Admin 测试使用独立 Playwright project `admin-staging`，baseURL 为
`http://127.0.0.1:3101`，会话为真实 TOTP 登录，数据与 mutation 均走 4100
真实 API。

| 操作                        | 结果                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Flags update                | UI 开启开关并将 rollout 设为 35%，API 读回一致；随后复位                                                               |
| Content delete              | journey trip 软删除 200，Admin API 读回 `deletedAt` 非空                                                               |
| Content restore             | 恢复 200，Admin API 读回 `deletedAt: null`                                                                             |
| Queue retry                 | 失败 job 重试 200，进入 `email:wait`                                                                                   |
| Queue manage                | `email` 暂停、恢复均为 200，metrics `paused` 状态同步                                                                  |
| Email resend                | 200，新 EmailLog 为 `queued`；Redis `jobs:ingress` 中 `email.send` 信封包含该 EmailLog ID；审计含 `admin.email.resent` |
| Audit                       | 成功记录 flags/content/retry/queue/email 全部动作                                                                      |
| Web owner 访问 Admin        | 403 `ADMIN_ACCESS_DENIED`                                                                                              |
| Admin 角色执行 flags update | 403 `ADMIN_ACCESS_DENIED`                                                                                              |
| Admin 角色执行 queue pause  | 403 `ADMIN_ACCESS_DENIED`                                                                                              |

Admin 审计动作已读回：

```text
admin.feature_flag.updated
admin.content.deleted
admin.content.restored
admin.job.retried
admin.queue.paused
admin.queue.resumed
admin.email.resent
```

证据：

- `test-results/staging-release/evidence/admin-operations.json`
- `test-results/staging-release/admin-flags.png`
- `test-results/staging-release/admin-content.png`
- `test-results/staging-release/admin-queues.png`
- `test-results/staging-release/admin-emails.png`

## 6. k6 结果

### Smoke

`tooling/k6/staging-smoke.js`：4 场景、12 max VUs、15 秒。

| Metric                             |             实际结果 |  Threshold | 结论 |
| ---------------------------------- | -------------------: | ---------: | ---- |
| HTTP requests                      |               38,160 |          — | —    |
| `http_req_failed`                  |                0.00% |     `< 1%` | PASS |
| `unexpected_response`              |                    0 |     `< 1%` | PASS |
| checks                             | 100% (78,536/78,536) |          — | PASS |
| overall p95                        |             22.01 ms |          — | —    |
| health p95                         |              3.96 ms | `< 300 ms` | PASS |
| authenticated Workspaces/Trips p95 |             29.58 ms | `< 300 ms` | PASS |
| public share p95                   |             36.96 ms | `< 300 ms` | PASS |

### Security

`tooling/k6/staging-security.js`：4 场景，165 请求/检查。

| Gate                        |       实际结果 | Threshold | 结论 |
| --------------------------- | -------------: | --------: | ---- |
| auth rate limited           |           100% |     `> 0` | PASS |
| share read rate limited     |           100% |     `> 0` | PASS |
| share password rate limited |           100% |     `> 0` | PASS |
| upload presign rate limited |           100% |     `> 0` | PASS |
| checks                      | 100% (165/165) |         — | PASS |
| `http_req_failed`           |          0.00% |         — | PASS |
| overall p95                 |       84.13 ms |         — | —    |

JSON summaries：

- `test-results/staging-release/k6/staging-smoke-summary.json`
- `test-results/staging-release/k6/staging-security-summary.json`
- `test-results/staging-release/k6/k6-environment.json`

### Mailpit

API 通过真实 SMTP `127.0.0.1:1025` 触发密码重置邮件，Mailpit API 读回：

```text
status: delivered
messageId: 4Y3Rcz7WMxWs38jlJxoxLT
subject: 重置你的 Roamlog 密码
```

证据：`test-results/staging-release/k6/mailpit-probe.json`。

## 7. 未执行 / 剩余风险

- 本地 PostgreSQL 是真实协议实例，但不是托管远端 staging；没有备份/恢复、
  跨主机网络或生产连接池演练。
- MinIO、Mailpit、Redis 均为 loopback 本地开发服务。MinIO root 凭据只在
  本地测试使用；不能作为生产 IAM/TLS 证据。
- 未使用真实 Resend、OAuth、TLS、域名、Cookie domain、CSP/HSTS 边缘配置。
- 未启动 Worker 消费 admin email resend 的入队任务；本任务验证的是
  `queued` EmailLog、Redis enqueue 与审计。Mailpit 收件由 API 密码重置链路
  独立验证，不等同于 Worker/Resend 投递门禁。
- 本轮 k6 smoke 为模拟多客户端，使用合成 XFF 分散公开分享的 60/min 限流；
  它不是单 IP 容量测试。security k6 则刻意固定每个场景的合成 IP 来断言 429。
  部署时必须只信任单一反向代理并剥离客户端伪造的 XFF。
- 未做真实对象字节上传 round-trip；Media gate 验证了真实 MinIO presign
  端点、MIME/size/SSRF 输入拒止和 429。对象处理链路仍由既有 worker/storage
  套件和 staging 服务报告覆盖。
- Admin UI 在 API 模式下仍显示 `MOCK DATA` 徽标（截图可见），与实际
  API/审计行为不一致；这是观察到的 UI/文案问题，按文件边界未修改。

## 8. 变更文件

- `playwright.staging.config.ts`
  - 切换真实 Redis/MinIO/Mailpit；
  - 增加独立 `admin-staging` project 和 3101 Admin webServer；
  - API 直接连接真实 Redis，不再启动无关的 Redis protocol stub。
- `e2e/staging/env.ts`
  - 真实服务端点、隔离 schema/prefix、Admin operations fixture 类型。
- `e2e/staging/request.ts`
  - staging Admin fixture/role helper。
- `e2e/staging/staging.setup.ts`
  - 链接 Admin operations fixture。
- `e2e/staging/security-gates.spec.ts`
  - 真实限流阈值、恶意 Origin 403、可选 origin 201、MinIO 端点断言。
- `e2e/staging/journey.spec.ts`
- `e2e/staging/public-share.spec.ts`
  - 证据路径统一到 `test-results/staging-release/`。
- `e2e/staging/prepare-admin-operations.ts`
  - 真实 Prisma flag/email/queue/role fixture。
- `e2e/staging/admin-operations.spec.ts`
  - Admin UI + API mutation、审计、权限拒绝 E2E。
- `tooling/k6/staging-smoke.js`
- `tooling/k6/staging-security.js`
- `tooling/k6/run-staging-release.ps1`
- `tooling/k6/README.md`
- `tooling/k6/runtime/.gitignore`
- `STG_RELEASE_GATE_REPORT.md`

未修改产品代码、contracts、数据库 schema/migration、Docker、CI 或 root
lockfile；未 commit、未创建分支、未 push。`package.json` 和 `.gitignore`
工作区中仍有其他 Agent 的既有改动，本任务未修改。

## 9. 结论

**本地隔离 staging release gate：PASS。**

修复后的 P1 安全项（get-session 误限流、share/upload 限流、恶意 Origin、
可选 origin 500）均取得真实运行证据；k6 smoke/security 均通过阈值；Admin
关键操作、审计与权限拒绝在真实 API 模式下通过。

该结论**不能**直接等同远端 staging/production-ready。上线前仍需在具备
TLS、真实 PostgreSQL/Redis/对象存储、Resend/OAuth 凭据和单一边缘代理的
staging 环境重跑同一门禁，并补充 Worker 消费、对象上传、备份恢复与告警证据。
