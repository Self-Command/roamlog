# ADMIN_OPS_TRUTH — Checkpoint

状态: DONE
更新: 2026-11-18 22:30 (+08:00)
报告: `.audit/admin-ops-truth-report.md`

## 完成
- A 队列/Worker：Redis 发现队列名（`SCAN roamlog:*` + 状态后缀白名单）、5 分钟窗口吞吐（`:completed` ZSET `ZCOUNT`/`ZRANGE` 时间戳）、`workerHealth` 改为 `CLIENT LIST` 阻塞消费者（`flags=b` + `bzpopmin|blmpop|brpoplpush`）→ active → waiting/无消费者 down → 近期活动 degraded → unavailable；BullMQ v6 Worker 不 SETNAME（旧实现永久误报 DOWN 的根因）。
- B 举报：确无 Report 模型/端点 → API 模式 badge/列/详情一律「未接入」、`flagged` 禁用 + aria 说明 + 页面最小设计；内容删除/恢复保持真实 mutation。
- C 开关：新增 `POST/DELETE /v1/admin/flags`（key 正则 2-80 唯一、描述 1-500、灰度 0-100 整数、白名单 UUIDv7、审计、P2002→409）；UI 新建/删除/空状态/beforeunload + 站内 anchor 拦截 + 未保存 banner + 放弃更改。
- D 邮件：API 仅 `failed|bounced` 可重发（409 `EMAIL_NOT_RESENDABLE`），UI disabled + title + aria；测试邮件入口移除；6 项真实计数（`/v1/admin/metrics.emails` 全库聚合）；收件人 `a***@domain`；最近错误原因块。
- E 系统：删除硬编码 `Up · 2 ms` / `key prefix` / `4 queues`；版本/构建时间缺失 → 未接入（contract `buildTime` nullable，`unconfigured` 哨兵）；Worker 观测信号 + 推导口径；队列注册真实发现。
- F 一致性：无固定数字；不可用控件移除或 disabled + title + aria。

## 验证（全绿）
- `pnpm --filter @roamlog/admin typecheck` → exit 0
- admin vitest（content/flags/emails/queues/system）→ Test Files 5 passed / Tests 32 passed
- `pnpm --filter @roamlog/api exec vitest run src/modules/admin src/modules/feature-flags` → Test Files 11 passed / Tests 91 passed
- `pnpm --filter @roamlog/api typecheck` → exit 0
- 全量 admin：Test Files 16 passed / Tests 82 passed
- `codegraph status` → `[OK] Index is up to date`（Files 1,440）

## 待根 Agent 处理
1. `contracts:generate` + `api-client:generate`（新字段与新端点），随后移除 Admin 侧本地类型/断言。
2. Report 模型是否落库（需迁移，我未改 `schema.prisma`）。
3. Worker heartbeat（`apps/worker/src` 不可写）。
4. env 注入：`ROAMLOG_API_VERSION` / `ROAMLOG_WORKER_VERSION` / `ROAMLOG_BUILD_TIME` / `NEXT_PUBLIC_WEB_BASE_URL`。
5. `permissions.ts` 增 `admin:flags:create|delete`（当前复用 `admin:flags:update`，仅 super_admin，不阻塞功能）。

## 风险要点
- `CLIENT LIST` 判据耦合 BullMQ v6 blocking primitive（升版需同步）。
- 每次读取/变更做一次 SCAN（键空间大时应加缓存）。
- Redis 不可用时队列 mutation 返回 404 而非 503（fail-closed，待改语义）。
- 吞吐为 5 分钟窗口推算，非 `getMetrics()`；UI 已标注窗口。