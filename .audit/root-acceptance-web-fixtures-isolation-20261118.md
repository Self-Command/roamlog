# 根 Agent 验收记录 — WEB_FIXTURES_ISOLATION

任务 ID: WEB_FIXTURES_ISOLATION
验收结论: **ACCEPT（最终，条件项已闭环）**
时间: 2026-11-18 22:45

## 最终复核（gating 修正后，根 Agent 独立复跑）

`.next` 时间戳 22:12（api 模式还原构建）：

| 检索串 | 命中文件 |
|---|---|
| `demoFixtureState` | **0** |
| `demo-store` | **0** |
| `legacy-mock` | **0** |

**对照组已由 Agent 补齐，证明 0 不是"检索词永远为 0"**：

| # | `NEXT_PUBLIC_DATA_MODE` | build | `demoFixtureState` |
|---|---|---|---|
| 1 | api | exit 0 (22:11:00) | 0 files / 0 matches |
| 2 | **mock（对照）** | exit 0 (22:11:38) | **4 files / 20 matches** |
| 3 | api（还原交付产物） | exit 0 (22:12:16) | 0 files / 0 matches |

门控已修正为**正交**语义（我的要求已落实）：
```tsx
const mockModeEnabled = DATA_MODE === "mock";                                 // 挂载：只看数据模式
const mswEnabled = mockModeEnabled && process.env.NODE_ENV !== "production";  // MSW：仍 dev/test only
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";               // 产物消除：构建期常量
```
护栏测试新增 4 条断言锁死这组语义（`mockModeEnabled` 只含 `DATA_MODE`、渲染用 `mockModeEnabled`、`NODE_ENV` 只出现在 `mswEnabled`、`isApiBuild` 为构建门控）。

**Agent 纠正了我的检索口径（我承认并采纳）**：
- `林知夏` 是 **admin** fixture，web 包里本就不存在；web 侧有效判据是 `demoFixtureState`/`demo-store`。我此前把它当 web 判据是错的。
- `MSW DEVELOPMENT DATA` 在生产源里不存在；我复跑全仓发现 4 处命中，**全部是测试里的 `expect(...).not.toBeInTheDocument()` 回归断言**（`trips-library.test.tsx`、`dashboard-page.test.tsx`×2、`insights-workspace.test.tsx`）——这是正面证据，不是残留。

## 通过（首次交付即成立）

- `providers.tsx`：`isApiBuild` **模块级常量** + `isApiBuild ? undefined : dynamic(...)`，目标 `legacy-mock/mock-root`（DemoDataProvider + MSW 同一边界），保留启动/失败/重试 UI。
- 8 个 mock tab + 3 个 tab 测试 + `trips/trip-detail.tsx` 已 `git mv` 到 `components/legacy-mock/trip-detail/`；`share/demo-share.ts` → `legacy-mock/share/`。
- 7 个路由页：Live 静态、mock 侧 dynamic；**trip map 无 Live 对应物 → api 模式渲染 `EmptyState`「行程地图尚未接入」**（正确，不白屏、不渲 mock）。
- 防回归测试 `components/__tests__/no-fixtures-in-api-mode.test.tsx`（5 tests）被 `pnpm test` 真实拾取（`✓ ... (5 tests)` 出现在全量输出）。
- `pnpm --filter @roamlog/web typecheck` exit 0；`pnpm --filter @roamlog/web test` **23 files / 113 tests 通过**。
- 决定性技术证据：编译后的 `_0o9_7vv617gw3._.js`（trip map 页）函数体只剩 `EmptyState` 分支，`legacy-mock=0 / demo-store=0` → 动态导入被常量折叠**完全消除**。
- 其余命中已合理解释：`api-mocks` 2 处来自 `next.config.ts` 的 `transpilePackages` 配置元数据；`legacy-mock` 4 处来自 server sourcemap 的 `sourcesContent`（部署不含 sourcemap 语义问题，但建议 G6 关闭生产 sourcemap）。

## Agent 的两个正确判断（值得记录）

1. **拒绝盲从指令**：`components/trip-detail/entry-revision-list.tsx` 被要求随 tab 一起移动，但它核查出生产链路 `journal-live.tsx → journal-editor-sheet.tsx:32` 静态依赖它，且其无 fixture → **留在原地**。避免了一次生产日志页断裂。
2. **指出我的规格错误**：`lib/demo-format.ts` 名字像 demo，实为纯函数/常量（`formatMinor`/`shortDate`/`moodLabels` 等），无需拆分。我此前要求「若含 fixture 则拆分」的条件前提不成立。

## 条件项（已回派，Agent 修完我再最终验收）

**设计缺陷**：mock root 门控写成 `DATA_MODE === "mock" && NODE_ENV !== "production"`。
后果：任何本地/预发用 `next build` + `next start` 跑 mock 模式的场景会**不挂载 DemoDataProvider** → 页面崩或空屏，毁掉本地生产构建冒烟与未来"真生产演示站"可能。

要求改为**只**用 `DATA_MODE === "mock"`（`!isApiBuild`）。安全性由常量折叠保证，且新增**对照组构建**要求：
- `NEXT_PUBLIC_DATA_MODE=api` build → `.next` fixture 命中 **0**
- `NEXT_PUBLIC_DATA_MODE=mock` build → `.next` 命中 `demoFixtureState` **> 0**（证明 mock 生产构建仍可用，没被误杀）

## 未覆盖 / 后续

- 未起 dev server，mock 模式无浏览器级回归 → G3 补。
- `KNOWN_LEGACY_VIOLATIONS` 白名单仍列 7 个 mock `*-workspace`（已只经路由 dynamic 懒加载，不在 api 入口图）。判据是 bundle，不是 lint；迁移后必须删条目。
- **残留 demo 硬编码**（既有问题，非本次引入）：`roamlog-crew` 出现在 `components/app-shell/workspace-app-shell.tsx:122`、`app/not-found.tsx:16`、mock `settings-workspace.tsx:226` → 另开清理。
- 建议 G6 关闭生产 sourcemap，避免 `legacy-mock` 源码文本随 map 进镜像。