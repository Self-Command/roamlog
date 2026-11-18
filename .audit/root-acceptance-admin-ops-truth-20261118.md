# 根 Agent 验收记录 — ADMIN_OPS_TRUTH

任务 ID: ADMIN_OPS_TRUTH
验收结论: **ACCEPT（条件：真实 Redis/PG 端到端、举报模型需产品决策）**
时间: 2026-11-18 22:50

## 根 Agent 主持的串行操作

```
pnpm contracts:generate  → 94 paths / 203 schemas
pnpm api-client:generate → 23 endpoint files / 614 schemas（609 → 614）
pnpm contracts:check     → 两侧 fresh
```
生成后复验：`admin typecheck` **0 错误**；`admin test` **16 files / 82 tests 全通过**（原 64，新增 18）。

## 本轮最有价值的发现（根因级）

**「Worker 永久假 DOWN」的真因**：
> BullMQ **v6 的 Worker 不调用 `CLIENT SETNAME`**（只有 `QueueEvents` 会），所以旧代码按客户端名匹配 `CLIENT LIST` **永远命中不到** → 无论 worker 是否健康都显示 DOWN。

这直接解释了审计 P1-10「健康状态与 Worker 实际状态冲突」。不是文案问题，是**探测机制本身失效**。

修后的判据（有序）：
1. `CLIENT LIST` 中 `flags=b` 且 `cmd ∈ {bzpopmin, blmpop, brpoplpush}` > 0 → `up(consumer-clients)`
2. `active` 总和 > 0 → `up(activity-derived)`
3. 非暂停队列 `waiting>0 && active=0 && blocked=0` → `down`
4. 最近完成/失败 ≤ 10min → `degraded(activity-derived)`
5. 其余 / `CLIENT LIST` 失败 → `unavailable` → UI 显示「未接入」

并且**在队列页与系统页都印出推导口径**（「推导口径：Redis CLIENT LIST（阻塞消费者）+ 队列计数」）——这符合「不伪造」原则：拿不到 heartbeat 就诚实地标为推导。

## 逐项结果

| 能力 | 原状态 | 现在 | 数据来源 |
|---|---|---|---|
| 队列吞吐 | 假值 `0.0` | `ZCOUNT roamlog:<queue>:completed (now-300s) +inf` ÷ 5 → jobs/min；`ZCOUNT` 抛错 → `null` → 「未接入」 | 真实 BullMQ 键 |
| 最近完成/失败 | 无 | `ZRANGE <key> -1 -1 WITHSCORES` | 真实 |
| Worker 健康 | 永久假 DOWN | 5 级有序判据 + 口径标注 | 真实推导 |
| 举报 badge | 固定 `0` | API 模式一律「未接入（需 Report 模型）」+ `flagged` 筛选 disabled + aria 说明；fixture 模式保留 demo 数并标 mode 徽标 | 无数据源 → 诚实 |
| 功能开关创建 | 页面空白、无法创建 | `POST /v1/admin/flags`（201）+ `DELETE /v1/admin/flags/{key}`，**均写审计**；key 正则 + 唯一（预检 + P2002→409 `FEATURE_FLAG_EXISTS`）+ 灰度 0–100 + 白名单 UUIDv7；UI 有新建/删除确认/空态/`beforeunload` + 站内拦截 + 未保存 banner | 真实 |
| 系统 buildTime | 用容器启动时间冒充 | 改为 nullable（不再冒充） | 真实或空 |

## 测试债闭环（关键：没有把实现改回假值）

```
pnpm --filter @roamlog/api exec vitest run src/modules/admin src/modules/feature-flags
  → 11 files / 91 tests passed
```
三个 spec 是**按真实 Redis key 形状重写替身**（`scan`/`ZCOUNT`/`ZRANGE WITHSCORES`/`CLIENT LIST`），而不是放宽断言。这正是我要求的纪律。

## 条件项 / 风险

1. **举报/审核队列需要产品决策**：无 `Report`/`Moderation` 模型、无端点。Agent 按要求**未改 schema.prisma**，给出了最小设计（模型/端点/权限/队列）。→ 需你决定是否本轮做；不做则 UI 保持「未接入」。
2. `CLIENT LIST` 判据耦合 BullMQ v6 的 blocking primitive（`BULLMQ_BLOCKING_COMMANDS`），**BullMQ 升版需同步**。
3. `listQueues()` 每次读/变更都 SCAN（上限 200×500）；键空间大时建议加 5–10s 缓存。
4. Redis 不可用时队列 mutation 返回 **404 而非 503**（fail-closed），语义待改。
5. 未做真实 Redis/PG 端到端（仅单测替身 + tsc），未跑 build → 我负责的集成阶段补。
6. 建议 devops 注入 `ROAMLOG_API_VERSION` / `ROAMLOG_WORKER_VERSION` / `ROAMLOG_BUILD_TIME` / `NEXT_PUBLIC_WEB_BASE_URL`；`permissions.ts` 增 `admin:flags:create|delete`（当前复用 update，仅 super_admin，不阻塞）。

## 未覆盖

- 真实 Redis 的 `CLIENT LIST` 在 Docker 中的实际输出形态（不同 redis 版本 flags 表示可能不同）→ G5 必须在真实 staging Redis 上验证，否则健康判据可能仍有偏。
- 分页/排序仍固定 `limit 100`（不属本任务）。
- Admin 侧在 regen 前用的本地类型（`AdminQueueMetricsRow`/`AdminSystemSnapshotDetail`）与 raw fetch **应在 regen 后收敛为 generated hooks**——已记录为可选重构。