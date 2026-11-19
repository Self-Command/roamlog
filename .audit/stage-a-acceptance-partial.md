# Stage A 验收记录（部分：A1 / A2 / A3）

时间: 2026-11-19 11:45
计划: `docs/superpowers/plans/2026-11-19-stage-a-production-surface.md`

## A1_DROP_MOCK_MODE —— ACCEPT

提交 `58ab4be`（41 文件，+372/−2913）

| 门禁 | 结果 |
|---|---|
| web typecheck | exit 0 |
| `no-demo-surface` 守卫 | 5/5 通过 |
| web 全量测试 | 29 files / 198 tests |
| web lint | exit 0 |
| `rg legacy-mock\|data-mode`（非测试） | **0 命中** |
| web build | exit 0，24 条路由全出 |

我独立复核：`legacy-mock`/`data-mode` 非测试引用 0；`DataMode` 当时仍为 `"api"\|"mock"` 联合（见 A3 处理）。

## A2_BUILD_FLAGS —— ACCEPT

提交 `77ffa3f`（10 文件，仅 `docker/`、`.env.example`、`README.md`、`deploy/`、`tooling/`）

| 门禁 | 结果 |
|---|---|
| 构建标志**定义**门禁（ARG/ENV/compose/env） | **三条全部 0 命中**（我独立复跑确认） |
| YAML 解析（production + staging） | ok |
| production services 数 | 9（未变） |
| `pnpm staging:validate` | exit 0 |
| `check-env --help` | exit 0 |
| 反向断言（仍设置旧变量） | 只 WARN、exit 0（实测） |
| api typecheck | 被 `B1A` 的并行新文件阻断，非本任务引入 |

**重要更正（我的验收标准写错了）**：原标准是「字符串 0 命中」，与「保留迁移说明 + 退役守卫」自相矛盾。已改为**只禁止定义**（`ARG|ENV|键|赋值`），文档说明与 `RETIRED_DATA_MODE_KEYS` 保留。Agent 拒绝为让 grep 变绿而删文档，处理正确。

## A3_DEAD_BRANCHES —— ACCEPT

提交 `9d973bd`（48 个 web 文件，+78/−4594；另含 A2 的 README 2 行，见事故记录）

| 门禁 | 结果 |
|---|---|
| web typecheck | exit 0 |
| 守卫测试 | 6/6 通过 |
| web 全量测试 | 26 files / **190 tests**（减少的是被删 demo 测试） |
| web lint | exit 0 |
| `rg useDataMode\|DataMode\|mode === "mock"`（非测试） | **0 命中** |
| web build | exit 0 |
| `.next` 产物 `demo-store\|api-mocks\|demoFixtureState\|legacy-mock` | **0 命中**（我独立复跑） |
| `.next` 产物 `本地演示数据\|LIVE API\|MSW` | **0 命中**（我独立复跑） |

删除规模：`lib/api/mock.ts`(480) / `lib/demo-store.tsx`(749) / `lib/msw.ts` / `public/mockServiceWorker.js` / 7 个 demo workspace 组件及其测试。

**四页空状态实测存在**（我逐一 grep 确认）：
- dashboard：`还没有旅行` + 新建 CTA
- insights：`还没有足够的旅行数据`
- atlas：`还没有旅行足迹` / `还没有可显示的地图坐标`
- trips-library：`旅行库还是空的` / `没有匹配的旅行`

→ 删掉 mock 后**没有留下白屏**，这是 Stage A 的 Review Focus 之一，已达成。

## 未完成

- `A4_ADMIN_FIXTURE_MODE`：进行中（Task 5 完成，Task 4 修 JSX 中）
- `B1A_SETTINGS_BACKEND`：进行中（`apps/api/src/modules/settings/**` 未跟踪，导致 api typecheck 红）
- Task 6（`api-mocks` 移出依赖）：A3 已清 `next.config` transpile；仍需把 6 个测试的 fixtures 依赖迁出
- Task 7（全量验收 + 真机检查）：等 A4/B1A 完成

## 事故

`9d973bd` 是跨任务提交（web 清理 + README 修文档），源自 `git commit --amend` 误落到他人提交。内容零丢失，已记录 `.audit/incident-2026-11-19-git-amend.md`，不回滚历史；已向所有 Agent 下发「禁止 amend/rebase/reset、禁止 `git add -A`」。