# 根 Agent 验收记录 — E2E_SPEC_REFRESH

任务 ID: E2E_SPEC_REFRESH
验收结论: **ACCEPT（并因它发现一处我漏验的产品回归）**
时间: 2026-11-18 23:50

## 通过的修复（旧 → 新 + 理由，逐条有据）

| # | 旧断言 | 新断言 | 理由 |
|---|---|---|---|
| 1 | `getByText("MSW DEVELOPMENT DATA")` | `getByText("本地演示数据（非真实）")` + 说明句 | 旧调试标记已删；现由 `dashboard-page.tsx:131-140` 在 mock 模式渲染演示徽标。**原意图「演示数据必须标注为非真实」被保留** |
| 2 | `TOTAL JOURNEYS` 固定 `9` | 从 `demoTrips.length` 推导；另三项断言 `/^\d+$/`；补上漏掉的 `STOPS COLLECTED` | 值来自真实聚合，不再写死 |
| 3 | 「预算分布」heading | **保留不动** | 核实仍存在（`dashboard-recent.tsx:76-83`，实测 H2 列表含「预算分布」）——**没有为了让测试过而删断言** |
| 4 | `SHOWING 9 OF 9` / `1 OF 9` / `2 OF 9` | 总数从 `MOCK_TRIP_COUNT`、愿望数从 fixtures 状态计数推导 | 同上 |
| 5 | `e2e/support/fixtures.ts` `message.type()` 重复调用 | 读一次复用 | 仅类型修复（TS2322），行为不变 |

新增 `e2e/support/mock-fixtures.ts`（从 `packages/api-mocks/src/fixtures.ts` 推导期望值）——把「期望数字」变成**推导**而非复制，这是对的做法。

### 全量扫描结论（有代码 + 实测证据）
- `没有生产后端写入` / `N 位协作者在线` / `9 趟` / `¥18,800` / `¥22,400` 在 e2e 中**本来就没有断言** → 无过期
- 「同行者的话」是 `journal-entry-sheet.tsx:147` 的正当文案，非假成员名 → 保留
- legacy-mock 迁移**没有**让 mock tab 断言过期：`DATA_MODE !== "api"` 时仍渲染 legacy-mock TripDetail，8 个 tab 实测全在 → `planning.spec`、`trips.spec` 详情、a11y keyboard 全绿
- app-shell 导航改动未造成 e2e 过期（e2e 未断言导航文案）

### 验证
- **CI 的 grep 目标**：`dashboard renders real travel stats and next journey` → **1 passed** ✅
- `--project=web` → **10 passed** ✅
- 改动的 3 个文件严格 tsc → exit 0
- 截图：`e2e/screenshots/web-1440-dashboard.png`、`web-1440-trips-filtered.png`

## **它发现的产品回归（我此前漏验，责任在我）**

跑全 `--project=web`（连带 a11y + visual，共 33 项）→ **26 passed / 7 failed**，7 条**全部**是 axe `label-content-name-mismatch` (serious)：

> `a[data-testid="topbar-members"]` 有 `aria-label="工作区成员 4 人：林墨、Mira Chen…"`，但链内**可见文字**是 `aria-hidden` 的首字母「林 / MC / 林 / +1」→ **可见文字不在可访问名中**。

**这是我的验收失误**：`WEB_TOPBAR` 我只看截图 + 组件测试就 ACCEPT，没有跑 axe。该回归会打挂 `e2e:a11y` 与任何含 axe 的 gate。

已派 `A11Y_TOPBAR_FIX`，方案是让 `aria-label` 用 `initialsFor()` **同源**拼接（首字母与 `+N` 逐字出现在名字里），保留 `aria-hidden`，**禁止改 axe 配置/加 exclude/删测试**。

## 未覆盖

- `e2e/live`、`e2e/staging`（需真实环境，仅做了文案静态核对）
- `e2e/admin`、`e2e/api`（端口纪律）
- api 模式下「无演示徽标」未做双模式用例

## 已知风险

- **e2e 目录没有 tsconfig.json** → CI 的 `pnpm typecheck` **不覆盖 e2e**。这意味着 e2e 的类型错误只能靠运行时暴露。建议补 `e2e/tsconfig.json` 并纳入 CI。
- `mock-fixtures.ts` 用相对路径耦合 `packages/api-mocks`，根 package.json 未声明该依赖。

## 附：端口/baseURL 的实操事实（后续必踩，记入文档）

1. `playwright` config **只认 `E2E_WEB_URL`**，`BASE_URL` 无效。
2. `pnpm --filter @roamlog/web dev -- -p 3300` **不可用**（dev 脚本写死 `--port 3000`），要用 `pnpm exec next dev -p 3300`。
3. `apps/web` 会被 `.next/dev/lock` 拒绝（3000 实例持锁）→ 需复制到影子目录再起。
4. **必须用 `http://localhost:3300`**，用 `127.0.0.1` 会被 Next 16 dev-origin 拦截 → MSW 不启动 → 页面卡在「正在准备本地旅行数据」。