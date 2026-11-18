# E2E_SPEC_REFRESH — 过期 Playwright 用例修复报告

- 任务 ID：`E2E_SPEC_REFRESH`
- 角色：`qa_verifier`
- 状态：**DONE**（附带 1 项越界风险：axe 产品无障碍回归，非本任务可改范围）
- 时间：2026-11-18 22:44–23:00（Asia/Shanghai）
- 仓库：`C:\Users\BY9700\Desktop\UI\roamlog`

---

## 1. 变更文件

| 文件 | 变更 | 说明 |
|---|---|---|
| `e2e/web/dashboard.spec.ts` | 修改 | 修复 2 条确定过期断言 + 1 处脆弱的固定数字；`预算分布` 核实后保留 |
| `e2e/web/trips.spec.ts` | 修改 | `SHOWING 9 OF 9` 等固定总数改为从 fixtures 推导 |
| `e2e/support/mock-fixtures.ts` | **新增** | 从 `packages/api-mocks/src/fixtures.ts` 推导 mock 期望值 |
| `e2e/support/fixtures.ts` | 修改（9 行） | 仅 TypeScript 类型收窄，运行时行为不变 |
| `.audit/e2e-spec-refresh-report.md` / `.checkpoint.md` | 新增 | 本报告与 checkpoint |

未修改任何产品代码、未修改 `playwright.config.ts`、未跑 build、未连生产、无 git 写操作、未触碰 3000/3100/4100。

---

## 2. 逐条「旧断言 → 新断言 + 理由」

### 2.1 `e2e/web/dashboard.spec.ts` — `"dashboard renders real travel stats and next journey"`（CI grep 目标）

| # | 旧断言 | 新断言 | 理由 |
|---|---|---|---|
| 1 | `expect(page.getByText("MSW DEVELOPMENT DATA")).toBeVisible()` | `expect(page.getByText("本地演示数据（非真实）")).toBeVisible()` + `expect(page.getByText("当前数据来自本地 MSW fixtures，仅用于开发演示，不代表真实旅行记录。")).toBeVisible()` | 旧文案是被删除的开发期调试标记；现由 `dashboard-page.tsx:131-140` 在 `mode === "mock"` 时渲染用户可见的演示徽标与说明句。**测试意图保留并增强**：mock 数据必须显式标注为非真实，防止演示数据被当成真实旅行记录（原来的调试标记本身也是这个意图）。 |
| 2 | `stats.getByText("TOTAL JOURNEYS").locator("..").getByText("9", { exact: true })` | `stats.getByText("TOTAL JOURNEYS").locator("..").getByText(String(MOCK_TRIP_COUNT), { exact: true })`，其中 `MOCK_TRIP_COUNT = demoTrips.length`；并新增 `COUNTRIES VISITED` / `STOPS COLLECTED` / `DAYS ON THE ROAD` 三项的值必须匹配 `/^\d+$/` | 统计值来自真实聚合（`dashboard-page.tsx:100-105,146-151`：`trips.length`、`countries.size`、`cities.size`、`travelDays`），写死 9 会在 fixtures 变更时假红。改为**从 fixtures 常量推导**，值不变（当前 9 条 trip → 9），意图「统计卡是真实聚合而非占位符」保留。 |
| 3 | `expect(page.getByRole("heading", { name: "预算分布" })).toBeVisible()` | **保留不变**（已实测确认存在） | 任务要求核实：`dashboard-recent.tsx:76-83` 仍在渲染 `BUDGET SNAPSHOT / 预算分布` 的 `<h2>`，且 `trips.length > 0` 时该 section 一定渲染。实测页面 heading 列表含 `H2:预算分布`。故该断言未过期，**不删除、不弱化**。 |
| — | `heading "首尔，晚秋与夜航"`、`heading "最近整理"` | 保留 | 实测 heading 列表：`H1:旅行总览 / H2:首尔，晚秋与夜航 / H2:接下来 / H2:最近整理 / H2:预算分布`，均存在。 |

> 新增（可选强化但未破坏）：`STOPS COLLECTED` 也纳入 label 断言（旧用例漏了这座城市卡）。

### 2.2 `e2e/web/trips.spec.ts` — `"trip library supports text search and status filtering"`

| # | 旧断言 | 新断言 | 理由 |
|---|---|---|---|
| 1 | `getByText("SHOWING 9 OF 9")` | `` getByText(`SHOWING ${MOCK_TRIP_COUNT} OF ${MOCK_TRIP_COUNT}`) `` | `trips-library.tsx:212` 渲染 `SHOWING {filteredTrips.length} OF {trips.length}`，总数来自真实分页数据，写死 9 属同一类「固定数字」脆弱断言。 |
| 2 | `getByText("SHOWING 1 OF 9")`（搜索「京都」） | `` `SHOWING ${KYOTO_MATCH_COUNT} OF ${MOCK_TRIP_COUNT}` ``，`KYOTO_MATCH_COUNT = 1` 带注释说明「京都」只命中一条 fixture 标题/摘要/目的地 | 保留「搜索会缩小结果集」的意图，只去掉总数硬编码；命中数属于该搜索词的语义，保留字面量并注释。 |
| 3 | `getByText("SHOWING 2 OF 9")`（愿望筛选） | `` `SHOWING ${WISHLIST_COUNT} OF ${MOCK_TRIP_COUNT}` ``，`WISHLIST_COUNT = MOCK_TRIP_COUNT_BY_STATUS.wishlist` | 筛选计数同样应跟随 fixtures。 |

### 2.3 `e2e/support/fixtures.ts`（类型修复，非过期断言）

- 旧：`if (message.type() !== "warning" && message.type() !== "error") return;` 后再次调用 `message.type()` → TS 无法收窄，`ConsoleIssue.type` 被推成 Playwright 的全部 console 级别，导致 `tsc --noEmit` 报 `TS2322`。
- 新：`const type = message.type();` 读一次并复用。**运行时行为完全一致**，只是让类型可收窄。
- 这是 e2e 目录原本就存在的类型债务（e2e 无 `tsconfig.json`，CI 类型检查从未覆盖它），本次借「必须交付无类型错误」一并修掉，未改任何断言逻辑。

---

## 3. 全量扫描结果：确认「未过期、无需改」的项（附证据）

任务点名的重点风险逐项核对，结论如下（**不是猜测，均为代码 + 实测 DOM 双重确认**）：

| 扫描项 | 结论 | 证据 |
|---|---|---|
| `MSW DEVELOPMENT DATA` 残留 | 仅 dashboard 一处，已修 | `grep -rn "MSW DEVELOPMENT" e2e/` → 仅原 dashboard.spec:8 |
| `没有生产后端写入` | e2e 中不存在 | 全量 grep 无命中 |
| 固定数字 `9 趟` / `¥18,800` / `¥22,400` | e2e 断言中不存在（只存在于 fixtures 数据） | 全量 grep 无命中；`¥18,800`/`¥22,400` 仅出现在 trips 页渲染数据中，未被断言 |
| 假成员名 `同行者` / `编辑者` | `e2e` 中唯一命中是 `journal.spec.ts` 的 **「同行者的话」**，它是日志详情评论区的正当产品文案（`journal-entry-sheet.tsx:147`、`journal-comments.tsx:82`），不是顶栏假头像 | 顶栏假人已由 `topbar-members.tsx` 移除，`app-shell.test.tsx:126-131` 断言不得出现「同行者/编辑者/位协作者在线」 |
| 顶栏 `aria-label`「N 位协作者在线」 | e2e 中**从未**断言过该文案，无过期断言 | 全量 grep `协作者在线` → 仅 `app-shell.test.tsx`（单测，产品侧保证移除） |
| `components/trip-detail/**` 移入 `legacy-mock/` 导致的 mock tab 过期 | **未过期**：mock 模式下 trip detail 路由仍渲染 `legacy-mock/trip-detail`（`app/(app)/w/[workspaceSlug]/trips/[tripId]/page.tsx` 中 `DATA_MODE === "api"` 才走 `TripDetailLive`）。实测页面 tabs 仍是「概览/日志/行程/相册/地图/预算/打包/活动」，`按日期整理`/`花费明细`/`出发前清单`/`添加行程`/`记一笔`/`完成<标题>` checkbox 全部存在 | 实测 DOM dump（见 §6）；`planning.spec.ts`、`trips.spec.ts` 详情用例、`a11y/web/keyboard.spec.ts` 全部实跑通过 |
| `app-shell` 导航结构改动 | 导航仍是 总览/旅行/日志/地图/洞察 + 成员/活动/通知/设置，e2e 未直接断言导航项文案（视觉/axe 仅断言 heading），无过期断言 | `app-shell-nav.ts:45-139`；`a11y/support.ts` `WEB_ROUTES` 的 heading 全部实测存在 |
| `e2e/a11y` 路由 heading | 全部存在：旅行总览/旅行库/全部日志/京都红叶慢行/世界足迹/路线与停靠点/设置/账号安全 | 实测 dump + 33 项运行结果（visual 全绿） |
| `e2e/live/web.spec.ts` 的 `同行者的话`/`NEW JOURNAL ENTRY`/`VERSION 1`/`旅行库还是空的` | 静态确认文案仍存在（journal-entry-sheet、journal-compose-dialog、workspace-header、trips-library） | 本机无真实 API，未执行（见未覆盖项） |

---

## 4. 验证命令与结果

### 4.1 端口与 baseURL 的真实覆盖方式（先看配置，未猜）

`playwright.config.ts` 读取 `process.env.E2E_WEB_URL ?? "http://localhost:3000"`，并支持 `E2E_SKIP_WEB_SERVER=1` / `E2E_SKIP_ADMIN_SERVER=1` 跳过自启服务。因此 **`BASE_URL` 无效**，正确覆盖是 `E2E_WEB_URL`。`playwright.config.ts` 未被修改。

两个必须知道的坑（已在本次实测确认，供后续同学复用）：

1. `pnpm --filter @roamlog/web dev -- -p 3300` **不可用**：`apps/web/package.json` 的 dev 脚本已写死 `next dev --port 3000`，追加参数会变成非法目录。正确写法是 `pnpm --filter @roamlog/web exec next dev -p 3300`。
2. 但从 `apps/web` 再起第二个 dev server 会被 Next 拒绝：`⨯ Another next dev server is already running.`（`.next/dev/lock` 被占用 3000 的 PID 20148 持有）。
3. 而且 **不能用 `http://127.0.0.1:3300`**：Next 16 的 dev origin 防护会把 `127.0.0.1` 当 cross-origin（`allowedDevOrigins`），`/_next/hmr`、字体等 dev 资源被 block → 客户端不 hydrate → 页面永远停在「正在准备本地旅行数据」（MSW 未启动）→ 用例超时。必须用 `http://localhost:3300`（dev server 自身 origin）。

本任务的落地方式（不碰 3000、不改产品代码）：在 gitignore 的 `.data/e2e-shadow-3300/` 下创建 `apps/web` 影子副本（无 lockfile，Turbopack root 解析回真实仓库），`node_modules` 用 junction 指向真实依赖，在 3300 端口起 dev server；验证结束后**已删除影子目录并停止 server**。产品代码零改动，被测源码与仓库当前源码逐字节一致（同一份源码复制）。

### 4.2 命令与结果

```bash
# 1) CI quality-gate 目标用例（修复后）
E2E_WEB_URL=http://localhost:3300 E2E_SKIP_WEB_SERVER=1 E2E_SKIP_ADMIN_SERVER=1 \
  pnpm exec playwright test e2e/web --grep "dashboard renders real travel stats and next journey"
# → 1 passed (3.1s)   ✅

# 2) 全量 e2e/web（我改过 + 相邻用例，确认无连带破坏）
E2E_WEB_URL=http://localhost:3300 E2E_SKIP_WEB_SERVER=1 E2E_SKIP_ADMIN_SERVER=1 \
  pnpm exec playwright test e2e/web --project=web
# → 10 passed (19.1s) ✅
#   dashboard / dashboard-sidebar / journal / members / mobile / planning×3 / trips×2

# 3) 类型检查
pnpm exec tsc --noEmit --strict --skipLibCheck --module esnext --moduleResolution bundler \
  --target es2022 --lib es2023,dom --types node --esModuleInterop \
  e2e/web/dashboard.spec.ts e2e/web/trips.spec.ts e2e/support/mock-fixtures.ts
# → exit 0 ✅（仓库无 e2e/tsconfig.json，根目录也无 tsconfig.json，仅有 tsconfig.base.json；
#    故用显式 flags 覆盖本次改动的 spec/helper。全仓 `pnpm typecheck` 不含 e2e 目录。）
```

补充（越界但必须上报的发现）：把 `--project=web` 跑全（该项目 testMatch 是 `/web\/.*\.spec\.ts/`，会连带命中 `e2e/a11y/web/*` 与 `e2e/visual/web/*`，共 33 项）：

```
26 passed, 7 failed
失败全部是 axe: label-content-name-mismatch (serious)
目标: a[data-testid="topbar-members"]
原因: apps/web/components/app-shell/topbar-members.tsx 给链接设了 aria-label="工作区成员 4 人：…"，
      但链接内可见文字是 aria-hidden 的首字母头像（林 / MC / 林 / +1），可见文字未进入可访问名称。
```

这是**产品代码的无障碍回归**（本轮 app-shell 顶栏重构引入），不是过期断言，也不是我可以在本任务权限内修的（禁止改产品代码）。**未削弱该 axe 断言**，仅记录并升级。涉及 7 条：dashboard / trips / journal / trip-detail / atlas-map / trip-map / workspace-settings。`e2e/a11y/web/keyboard.spec.ts`（5 条）与 `e2e/visual/web/visual.spec.ts`（9 条）全绿。

---

## 5. 截图

- `e2e/screenshots/web-1440-dashboard.png`（214 KB，22:58 由通过的用例重写；全页、animations disabled）
- `e2e/screenshots/web-1440-trips-filtered.png`（136 KB）
- 其余由既有用例产出：`web-1440-trip-detail-packing.png`、`web-1440-journal-sheet.png`、`web-1440-members.png`、`web-390-*.png`、`web-1440-itinerary.png`、`web-1440-budget.png`

---

## 6. CodeGraph 证据

```
$ codegraph status
Project: C:\Users\BY9700\Desktop\UI\roamlog
Index Statistics: Files 1,466 / Nodes 22,522 / Edges 49,496
[OK] Index is up to date

$ codegraph explore "DashboardPage dashboard-page.tsx dashboard-recent.tsx insights-workspace trips-library"
→ DashboardPage (apps/web/components/dashboard/dashboard-page.tsx:64)，3 callers in app/(app)/w/[workspaceSlug]/page.tsx，
  tests: dashboard-page.test.tsx
→ DashboardRecent (apps/web/components/dashboard/dashboard-recent.tsx:13)，2 callers（dashboard-page.tsx）
→ 关系：DashboardPage → DashboardRecent / Progress / formatDateRange / getTripStatusLabel / AvatarGroup；
  DashboardRecent → /w/:workspaceSlug/trips/:tripId（navigates）
→ 关键源码（当次读取即当前磁盘内容）：
  · dashboard-page.tsx:131-140  mode === "mock" → <Badge tone="green">本地演示数据（非真实）</Badge> + fixtures 说明句
  · dashboard-page.tsx:146-151  [["旅行", trips.length, "TOTAL JOURNEYS"], ["国家", countries.size, "COUNTRIES VISITED"],
                                ["城市", cities.size, "STOPS COLLECTED"], ["在册天数", travelDays, "DAYS ON THE ROAD"]]
  · dashboard-recent.tsx:76-83   <h2>预算分布</h2> 仍存在（未删除/未改名）
  · trips-library.tsx:212        SHOWING {filteredTrips.length} OF {trips.length}

$ codegraph explore "app-shell workspace-nav top-bar command palette nav items"
→ buildShellNavigation (app-shell-nav.ts:45)，primaryNav 总览/旅行/日志/地图/洞察，secondaryNav 成员/活动/通知/设置
→ TopbarMembersProps (topbar-members.tsx:10)；TopbarMembers 无在线 presence（注释明确「no realtime presence channel」）
→ WorkspaceAppShell (workspace-app-shell.tsx:49) 2 callers in layout.tsx

路由证据：apps/web/app/(app)/w/[workspaceSlug]/trips/[tripId]/page.tsx
  DATA_MODE === "api" → TripDetailLive；否则 → dynamic(legacy-mock/trip-detail/TripDetail)
  ⇒ mock 模式下 trip detail 仍是 legacy workbench，planning/trips/a11y 的 tab 断言未过期（实测印证）。
```

另有运行时 DOM dump（Playwright + 3300）作为事实核对：dashboard 统计区文本 `TOTAL JOURNEYS | 9 | 旅行 | COUNTRIES VISITED | 9 | 国家 | STOPS COLLECTED | 21 | 城市 | DAYS ON THE ROAD | 79 | 在册天数`；heading `旅行总览 / 首尔，晚秋与夜航 / 接下来 / 最近整理 / 预算分布`；trips 页 `SHOWING 9 OF 9` 与状态计数 `全部9/愿望2/计划中1/即将出发1/在途中1/已归来4`。

---

## 7. 已知风险

1. **axe 7 条 serious 失败（产品问题）**：`topbar-members` 的 `aria-label` 未包含可见首字母文字。会打挂 `e2e:a11y` / 任何包含 axe 的 gate；本任务无权修产品代码。修复建议：去掉该链接的 `aria-label`，改为链接内加 visually-hidden 文本「工作区成员 N 人，查看成员列表」；或让 `aria-label` 包含可见字母（不推荐，读屏体验差）。
2. **e2e 目录无 `tsconfig.json`**：CI 的 `pnpm typecheck`（turbo 按包）不覆盖 `e2e/`，本次只能显式 flags 检查我改动的文件。若 CI 以后加 e2e 类型门禁，会先扫出若干存量问题。
3. **fixture 相对路径耦合**：`e2e/support/mock-fixtures.ts` 用 `../../packages/api-mocks/src/fixtures`（根 workspace 未把 `@roamlog/api-mocks` 声明为依赖，别名不可解析）。若该包目录/导出改动，spec 会在收集阶段报 import 失败（不是断言失败），需同步更新路径。导入会解析整个 demo 数据集（zod parse），实测 <0.5s。
4. **mock 徽标断言只在 mock 模式成立**：默认 `NEXT_PUBLIC_DATA_MODE` 未设置为 mock；若日后 CI 以 `api` 模式跑 `e2e/web`，第 1 条断言需按模式分支（本次未加分支，保持简单可读，因为 CI 当前固定 mock）。
5. `预算分布` 断言依赖 `DashboardRecent` 在 `trips.length > 0` 时渲染；若未来 fixtures 空集，该 heading 会消失（与「首尔，晚秋与夜航」同理，属数据集前提）。
6. 3300 验证是**影子副本**（同一份源码）而非直接跑 `apps/web`：因为 `.next/dev/lock` 被 3000 占用。副本内没有写入任何仓库文件（`.data/` gitignore），验证后已删除。

## 8. 未覆盖项

- `e2e/live/*` 与 `e2e/staging/*`：需要真实 API / staging 环境、Redis、数据库与 fixture 脚本，本机未执行；仅做了文案静态核对（`同行者的话`、`NEW JOURNAL ENTRY`、`VERSION 1`、`旅行库还是空的` 均仍存在于当前组件）。
- `e2e/admin/*`、`e2e/api/*`：需要 admin/api dev server（3001/4000），与本任务无关且端口纪律不允许，未跑。
- api 模式下的 dashboard「无演示徽标」语义：单构建只能验一种模式，未加双模式用例。
- 未按 CI 原样执行 `pnpm e2e:web`（该脚本会让 playwright 自起 webServer 走 3000，与端口纪律冲突）；改以等价环境变量组合执行，命令见 §4.2。

## 9. 建议的下一步

1. **前端修复 `topbar-members` 的可访问名称**（P0，影响 axe gate）。
2. 复跑 `pnpm e2e:web --grep "dashboard renders real travel stats and next journey"`（在真正空闲的 3000 或 CI 环境）做最终一把确认。
3. 打 tag 前在 staging 环境跑 `e2e:staging`、live 环境跑 `e2e:live`，补齐本轮重构对这两套用例的影响。
4. 建议为 `e2e/` 增加 `tsconfig.json`（参照 `e2e/staging/tsconfig.json`），把类型检查纳入 CI，避免同类类型债务累积。
5. 把「本机自定义端口跑 e2e」的注意事项写进 `e2e/README` 或 CONTRIBUTING：用 `E2E_WEB_URL`、用 `localhost` 而非 `127.0.0.1`、避开 `.next/dev/lock`。