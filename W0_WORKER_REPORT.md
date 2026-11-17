# W0-WORKER Delivery Report

状态: DONE_WITH_CONCERNS
任务 ID: W0-WORKER

## 变更文件

- `apps/worker/package.json`
- `apps/worker/tsconfig.json`
- `apps/worker/tsconfig.build.json`
- `apps/worker/vitest.config.ts`
- `apps/worker/README.md`
- `apps/worker/src/**`
- `apps/worker/test/queue.spec.ts`
- `apps/worker/.gitkeep`（删除，已由实际文件替代）
- `packages/emails/package.json`
- `packages/emails/tsconfig.json`
- `packages/emails/tsconfig.build.json`
- `packages/emails/README.md`
- `packages/emails/src/**`
- `packages/emails/.gitkeep`（删除，已由实际文件替代）
- `tooling/scripts/minio-smoke.ts`

没有修改 `apps/api/**`、`apps/web/**`、`apps/admin/**`、`packages/ui/**`、
`packages/contracts/**`、`packages/db/**`、root `package.json`、`pnpm-lock.yaml`、
`pnpm-workspace.yaml`、`turbo.json`、Docker、CI、原型或设计文档。

## 实现摘要

- 注册 BullMQ 队列：`media`、`email`、`export`、`reminders`、`maintenance`。
- 队列策略与设计一致：并发 2/10/2/5/1，重试 3/5/2/3/1，指数退避。
- 实现通用 `{ name, handle(job, context) }` 处理器契约和五个显式占位处理器。
  占位处理器会抛出 `PROCESSOR_NOT_CONFIGURED`，避免把 Wave 2 业务误报为已完成。
- `enqueueJob()` 强制要求显式 `jobId`；自定义 Redis `prefix`、`maxRetriesPerRequest: null`。
- BullMQ 自定义 job ID 负责重复入队去重；另行提供稳定 SHA-256 job ID 生成助手。
- 处理器执行前强制检查 job ID，缺少幂等键时标记失败，不执行副作用。
- `active`、`completed`、`failed`、`dead`、`stalled`、连接错误均有 JSON 结构化日志；
  作业事件包含 `queue`、`jobId`、`jobName`、处理器名和尝试次数。
- 失败作业由 BullMQ 标记 failed，worker 事件处理不会因处理器异常退出。
- 支持 SIGINT/SIGTERM 优雅关闭所有 worker 和 queue。
- React Email 模板：`workspace-invite`、`verify-email`、`reset-password`、`mention`、
  `trip-reminder`，统一布局、转义用户文本、无用户 HTML 注入。
- `renderEmailTemplate()` 同时返回 subject、HTML 和 React Email plain-text fallback。
- Mailpit smoke 使用 `POST /api/v1/send` 渲染并投递五个模板样本，打印 mailbox URL。
- MinIO smoke 验证 bucket、凭证上传、凭证读取、匿名访问被拒绝，并尽力删除临时对象。
- Worker 和 emails 均拆分为小于 300 行的实现文件。

## 新增依赖

`apps/worker/package.json`

- `@aws-sdk/client-s3`: `3.1170.0`
- `bullmq`: `6.7.7`
- `ioredis`: `5.11.1`
- `pino`: `10.4.0`

`packages/emails/package.json`

- `@react-email/components`: `1.0.12`
- `@react-email/render`: `2.0.6`
- `react`: `19.3.1`
- `react-dom`: `19.3.1`
- `@types/react`: `19.3.0`
- `@types/react-dom`: `19.3.0`

## 验证命令与结果

直接调用本地已就位二进制，未修改 lockfile：

```text
apps/worker: node node_modules/typescript/bin/tsc --noEmit
result: exit 0

apps/worker: node node_modules/typescript/bin/tsc -p tsconfig.build.json
result: exit 0

apps/worker: node -e "import('./dist/jobs/index.js')..."
result: processors=media,email,export,reminders,maintenance

packages/emails: node node_modules/typescript/bin/tsc --noEmit
result: exit 0

packages/emails: node node_modules/typescript/bin/tsc -p tsconfig.build.json
result: exit 0

packages/emails: node node_modules/vitest/vitest.mjs run
result: 1 test file passed, 3 tests passed

root: node node_modules/eslint/bin/eslint.js apps/worker packages/emails tooling/scripts/minio-smoke.ts
result: exit 0

root: node node_modules/prettier/bin/prettier.cjs --check apps/worker packages/emails tooling/scripts/minio-smoke.ts
result: all matched files use Prettier code style

template render evidence:
workspace-invite: HTML 7045 chars, text 474 chars
verify-email: HTML 6033 chars, text 487 chars
reset-password: HTML 6062 chars, text 506 chars
mention: HTML 7510 chars, text 533 chars
trip-reminder: HTML 7116 chars, text 466 chars
```

以下验证被当前机器环境阻塞：

```text
apps/worker: node node_modules/vitest/vitest.mjs run
result: FAIL in beforeAll; Redis localhost:6379 unreachable; 4 queue integration tests skipped

apps/worker: node dist/main.js
result: emitted worker.starting + structured ECONNREFUSED events for all five queues;
        never reached worker.ready; process was left in the expected reconnect loop
        until interrupted for the blocked-environment check

docker version
result: docker command not found

TCP localhost:6379 / 8025 / 9000
result: all closed
```

因此以下命令没有获得正向证据：

```bash
docker compose -f docker/compose.yml up -d redis minio mailpit
pnpm --filter @roamlog/worker test
pnpm tooling:minio-smoke
pnpm --filter @roamlog/emails email:smoke
```

测试文件本身包含四个真实 Redis 场景：重复 job ID 去重、处理器收到 `job.id`、
失败作业标记且 worker 继续运行、五队列注册与优雅关闭。当前没有用 mock 冒充通过结果。

## 过程问题

执行 `pnpm exec prettier` 时，pnpm 因工作区依赖清单变化自动触发安装流程。
该流程生成过 `pnpm-lock.yaml` 变更，并填充了本地 `node_modules`。为遵守写入边界，
`pnpm-lock.yaml` 已恢复到任务开始前的 HEAD 状态，最终 `git diff --quiet -- pnpm-lock.yaml`
通过。根 Agent 仍应按统一流程安装并重新检查 lockfile / node_modules，不应把这次自动触发
视为本任务完成的依赖锁定证据。

## 未覆盖 / 风险

- 五个处理器是明确失败的占位实现；媒体、导出、邮件发送、提醒、维护业务均未实现。
- 真实 Redis 队列测试已编写但未在当前环境运行；去重、failed 状态和生命周期尚无运行时证据。
- MinIO 和 Mailpit smoke 未连接真实本地服务验证。
- 未接入 Resend，未发送真实邮件，未验证生产送达、退信或投诉。
- 当前只实现任务要求的五个模板；设计文档中的 comment、role-changed、export-ready、
  account-suspended 模板留待后续业务 Wave。
- 没有 HTTP 健康端点；当前采用设计允许的纯进程 Worker 模式。
- 没有媒体压缩、ZIP 导出、对象清理、提醒调度等 Wave 2 逻辑。

## 建议下一步

1. 根 Agent 统一安装依赖，确认 `pnpm-lock.yaml` 与 workspace manifest 一致。
2. 启动 Redis/MinIO/Mailpit，运行 worker 集成测试、MinIO smoke、Mailpit smoke。
3. 记录真实的 minio-smoke 输出和 Mailpit 消息 URL，补齐当前缺失的运行证据。
4. Wave 2 在保留 `enqueueJob()`、显式 job ID、重试/日志约定的前提下实现真实处理器。
