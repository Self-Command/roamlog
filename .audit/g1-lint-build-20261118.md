# G1 门禁记录 — Lint / Build 进度

时间: 2026-11-18 22:35

## `pnpm lint`（全仓）

```
Tasks: 7 successful, 11 total
Failed: @roamlog/contracts#lint   (2 errors)
@roamlog/worker:lint             (0 errors, 19 warnings — 不阻断)
```

**唯一 error**：
```
packages/contracts/src/entities/trip.ts
  13:32  Unnecessary escape character: \-   no-useless-escape
  13:53  Unnecessary escape character: \-   no-useless-escape
```
来源：W0_CONTRACTS 新增的 `IanaTimeZoneSchema`：
```ts
.regex(/^[A-Za-z][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+)*$/)
```
`\-` 在字符类里不需要转义。

**处置**：已派最小修复（把 `\-` 改为类末尾的 `-`，语义等价），要求：
1. 逐样本证明正则行为**改前改后完全一致**（含 `Etc/GMT-5`、`Etc/GMT+8`、`America/Argentina/Buenos_Aires`、超长、`1abc` 拒绝等 11 个样本）；
2. `contracts lint/test/typecheck` + 全仓 `pnpm lint` 全绿；
3. 不重新生成 openapi（由根 Agent 统一处理）。

**影响**：`pnpm lint` 是 `.github/workflows/ci.yml` 的 quality job 步骤 → 此 error 会让 Release gate 失败 → 零镜像。必须在打 tag 前修掉。

## `pnpm build`（全仓）

**未执行**。原因：`WEB_TRIP_FORM` 与 `WEB_TRIP_WORKSPACE` 正在写 `apps/web`，此时构建结果不可信（会制造假失败）。两者落盘后统一执行。

## 已完成的门禁（可复核）

| 检查 | 结果 | 证据 |
|---|---|---|
| API 全量（真实 PG） | 66 passed / 4 skipped，443 tests，exit 0 | `g1-api-gate-20261118.md` |
| `contracts:check` | fresh（94 paths / 203 schemas / 609 schemas） | 同上 |
| api / web / admin typecheck | 全 0 错误 | 同上 |
| web test | 23 files / 114 tests | 同上 |
| admin test | 16 files / 64 tests | 同上 |
| api 模式 web build | exit 0，fixture 0 命中 | 同上 |
| mock 模式 web build（对照） | exit 0，`demoFixtureState` 4 files / 20 matches | 同上 |

## 剩余 G1 清单

- [x] contracts:check
- [x] typecheck（三端）
- [ ] lint（待 contracts 正则修复）
- [x] test（api/web/admin）
- [ ] build（待两个 web Agent 落盘）
- [ ] e2e（Playwright，G3）
- [ ] a11y / 视觉回归（G3）