# DASHBOARD_GRID_STRETCH — 总览页两列 grid 拉伸空白修复报告

任务 ID: `DASHBOARD_GRID_STRETCH`
日期: 2026-11-20
仓库: `C:\Users\BY9700\Desktop\UI\roamlog`
结论: **DONE**

---

## 1. 根因确认

`apps/web/components/dashboard/dashboard-page.tsx:152`（CodeGraph 命中的真实路径，非
`app/(app)/...` 下的同名文件）渲染了总览页「下一段行程」两列行：

```tsx
// 修复前
<div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]">
  <section ...>            // 左：NEXT JOURNEY 大卡
  <section ...>            // 右：UP NEXT「接下来」行程侧栏
</div>
```

- 该容器**没有 `items-start`**，CSS Grid 默认 `align-items: normal`（等价 stretch），
  两个子项都被拉伸到行高 = 较高子项的高度。
- 左卡内容是「封面 + 元信息 + 摘要 + 进度/预算」，实测 519px；右卡内容只有标题 + 2 条行程，
  ​**真实内容高 218px（含 20px 上下内边距后 258px）**，却被拉到 519px。
- 差额 **261.5px（不含 padding）/ 281.5px（含 padding，即原报告 282px 的口径）** 就是用户看到的空白带。
- 子元素构成已确认：**恰好 2 个子元素**，无第三子元素依赖 stretch
  （spec 中用 `parentElement.children.length === 2` 断言，防未来改动）。

## 2. 修复方案

**改 1 行**，在容器加 `items-start`：

```tsx
<div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]">
```

选择「容器 `items-start`」而不是「子元素 `self-start`」的理由：

1. **语义正确**：这一行的两个子项都是「贴合自身内容的卡片」，没有任何一方需要由行高补足，
   所以对齐策略属于行级属性，写在容器上而不是散落在子项上。
2. **与仓库已验收先例一致**：`apps/web/components/map/atlas-workspace.tsx:281`
   （MAP_ATLAS_LAYOUT 已合并的同一类 bug 修法）就是 `grid items-start gap-4 xl:grid-cols-[...]`，
   同类问题用同一写法，后续 review 与再排查成本最低。
3. **避免未来的第三子项静默继承 stretch**：容器级设置让整行语义显式化；若将来新增依赖等高的卡片，
   必须显式写 `self-stretch`，不会意外回归。
4. 单点改动，不改数据、文案、设计 token、布局比例（`1.65fr / 0.85fr` 与 `gap-4` 均未动）。

## 3. 另一列是否塌陷（证据）

修复后两侧的关键测量（1440px，playwright 真实浏览器）：

| 指标 | 左（下一段行程） | 右（接下来） |
| --- | --- | --- |
| 高度 | 519px | 258px |
| 内容高（减 padding） | 519px | 218px |
| 尾部空白（净） | 1px | 1px |
| `naturalHeight`（强制 `align-self:start` 后） | 519px | 258px |
| 自身内容溢出（clipped） | false | false |
| 宽度 | 739px | 381px |
| 顶部 y | 358 | 358（与左卡同一行） |

不塌陷的代码依据（实测 + 源码核对）：

- 两列子元素**都没有** `h-full` / `min-h-*` / `flex-1` / `overflow-y-auto` 依赖父级高度；
  唯一的 `h-full` 在 `aspect-[16/7]` 封面容器**内部**（`dashboard-page.tsx:163`），
  由宽度驱动高度，与行高无关；`flex-1` 只出现在右侧行程条目的文字区（`:273`），其父是条目卡片。
- 断言：左右两卡 `align-self` 生效后高度 = 自身自然高度（差 ≤ 2px）；
  左卡 > 300px、右卡 > 150px、右卡宽 > 280px；两卡 `top` 相等（同处一行）。
- 「接下来」的 2 条行程条目逐条断言 `row.bottom ≤ card.bottom + 1`，即修复后**没有被裁切**；
  卡片 `scrollHeight - clientHeight ≤ 1`（无裁切）。
- 右卡内容（标题「接下来」、两条行程：17:30 汉江边野餐 / 11:00 仁川机场送机）在 1440 截图中完整可见。

## 4. 全仓同类 grid 检查结果

**先说一个重要发现**：任务书给的 grep
`grep -rn "xl:grid-cols-\[minmax(0,1fr)_" apps/web --include=*.tsx` 实际**扫不到本次的 bug 现场**——
dashboard 的两行用的是 `minmax(0,1.65fr)` / `minmax(0,1.15fr)`，首轨不是 `1fr`。该命令只命中 3 处
（`notifications-live.tsx:166`、`atlas-workspace.tsx:69`、`atlas-workspace.tsx:281`）。
因此我把模式放宽为 `xl:grid-cols-\[minmax`（6 处）并追加 `lg:grid-cols-\[minmax`（10 处），
再用真实浏览器逐页实测，而不是靠 grep 判断。

实测方式：`e2e/web/dashboard-layout.spec.ts` 第 2 条用例遍历 12 条 workspace 路由，
对页面上**每个当前渲染为 2 个子元素的 grid** 计算 `尾部空白 = card.bottom − lastChild.bottom − paddingBottom`，
记录 `align-items` 与实际高度。**共测 11 个 grid 行，超阈值（>120px）的 offenders = 0（修完本次之后）。**

| # | 路由 | 容器 class（截断） | align-items | 两侧高度 | 最大尾部空白 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/w/roamlog-crew` | `mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]` | flow-start | 519 / 258 | **1px** | **本次修复**（修前 281.5px） |
| 2 | `/w/roamlog-crew` | `mt-5 grid gap-4 border-t ... sm:grid-cols-[1fr_auto]` | normal | 38 / 38 | 9px | 已测，无可见问题（进度条与预算的内部行，两子等高） |
| 3 | `/w/roamlog-crew` | `mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]`（最近整理 / 预算分布） | normal | 327 / 327 | **38px** | 已测，**< 120px 阈值，按任务要求不改** |
| 4 | `/w/roamlog-crew/map` | `grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]` | flow-start | 740 / 904 | 1px | 已测，无可见问题（MAP_ATLAS_LAYOUT 已修） |
| 5 | `/w/roamlog-crew/map` | `grid grid-cols-2 gap-2`（视图切换控件） | normal | 40 / 40 | 12px | 已测，无可见问题（按钮组） |
| 6 | `/w/roamlog-crew/notifications` | `grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]` | flow-start | 176 / 158 | 1px | 已测，无可见问题（已带 items-start） |
| 7 | `/w/roamlog-crew/settings` | `grid items-start gap-4 xl:grid-cols-2` | flow-start | 477 / 509 | 1px | 已测，无可见问题（已带 items-start） |
| 8 | `/w/roamlog-crew/trips/{id}/edit` | `grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:gap-12` | normal | 2337 / 486 | 0px | 已测，无可见问题（右栏末子元素贴底，无空白带） |
| 9 | 同上 | `grid gap-4 sm:grid-cols-2` | normal | 61 / 61 | 0px | 已测，无可见问题 |
| 10 | 同上 | `grid gap-4 sm:grid-cols-2` | normal | 57 / 57 | 0px | 已测，无可见问题 |
| 11 | 同上 | `grid gap-6 sm:grid-cols-2` | normal | 130 / 130 | 42px | 已测，< 120px，不改 |

未产生可测行的其余 grid 候选（逐项核对，均不构成本类用户可见空白）：

| 位置 | 结论 |
| --- | --- |
| `atlas-workspace.tsx:69` | AtlasLoading 骨架，两个子项都是固定 `h-[480px]`，等高，加载态才出现，无空白带 |
| `trip-detail-parts.tsx:74` | 同类加载骨架，两个 `h-72` 等高，无空白带 |
| `trip-detail-overview.tsx:17` | 全仓 grep 无任何调用方（遗留组件，不渲染） |
| `trip-map.tsx:137` / `map-fallback.tsx:29` | `TripMapLive` 无任何路由引用（仅单测），用户不可见 |
| `feature-placeholder.tsx:38` | `FeaturePlaceholder` 全仓 0 处使用 |
| `auth-shell.tsx:18` | `min-h-dvh` 全屏壳，按设计撑满视口；非卡片行 |
| `two-factor-security.tsx:304` | 已带 `items-start` |
| `two-factor-security.tsx:410` | `lg:grid-cols-[260px_minmax(0,1fr)]` 表单标签+输入行，非卡片 |
| `members-live.tsx:244` | 表格行（`lg:items-center`），非卡片行 |
| `/w/roamlog-crew/trips`、`/journal`、`/insights`、`/activity`、`/members`、`/ai`、旅行详情、旅行地图页 | 实测 2 子 grid 数为 0（页面已确认正常渲染，h1 分别为 旅行库 / 全部日志 / 旅行洞察 / 活动流 / 成员与邀请 / AI 旅行助手 / 首尔一周；旅行地图页按设计显示「行程地图尚未接入」空态） |

## 5. 修复前后空白实测（同一构建内复现，非引用旧报告）

spec 里在**当前构建**上临时把该行 `align-items` 改回 `normal` 测一帧再还原，因此 before/after 来自同一次运行：

| 口径 | 修复前 | 修复后 | 收窄 |
| --- | --- | --- | --- |
| 右卡高度 | 519px | **258px** | −261px |
| 右卡尾部空白（不含 padding） | **261.5px** | **1px** | −260.5px |
| 右卡尾部空白（含 20px padding，即原报告「282px」口径） | 281.5px | 20px | −261.5px |
| 左卡高度 | 519px | 519px | 不变（本来就定义行高） |
| 页面总高（1440） | — | 1259px | — |

> 说明：原报告写「282px」是把卡片内 20px `padding-bottom` 也算进空白带；本 spec 的净口径是 261.5px，
> 两者换算一致（261.5 + 20 ≈ 281.5）。任何一种口径下，修复后都远低于 120px 阈值。

## 6. 测试清单

| # | 名称 | 结果 |
| --- | --- | --- |
| 1 | `DASHBOARD_GRID_STRETCH — 1440px next-trip row hugs its content on both sides` | ✅ PASS（2.0s） |
| 2 | `DASHBOARD_GRID_STRETCH — every two-child grid in the app, measured in the browser` | ✅ PASS（26.6s，11 行，offenders=0） |
| 3 | `DASHBOARD_GRID_STRETCH — 390px stacks the same cards without overflow` | ✅ PASS（2.1s） |
| 4 | `apps/web` vitest `components/dashboard/dashboard-page.test.tsx` | ✅ 2/2 PASS |
| 5 | `tsc -p apps/web/tsconfig.json --noEmit` | ✅ 0 error |
| 6 | `eslint`（改动的 2 个文件） | ✅ 0 problem |
| 7 | `prettier --check`（改动的 2 个文件） | ✅ all files match |
| 8 | `codegraph status` | ✅ Index is up to date |

用例 1 断言：行 `align-items ∈ {start, flow-start}`（Chromium 把 `start` 计算为 CSS Box Alignment 别名 `flow-start`）；
左右尾部空白 < 120px；两侧高度 = 自身 naturalHeight（差 ≤ 2px）；右卡内容逐条在卡内；两卡同排；
强制 stretch 后的「修复前」空白 > 120px（证明根因）。
用例 2 断言：至少测到 5 行 grid（实际 11），并输出全部行数据与 offenders。
用例 3 断言：390px 单列下右卡 `top > 左卡底部`（确实堆叠）、无水平溢出（`scrollWidth - innerWidth ≤ 1`）、无裁切。

复跑命令：

```bash
cd /c/Users/BY9700/Desktop/UI/roamlog
E2E_SKIP_WEB_SERVER=1 E2E_SKIP_ADMIN_SERVER=1 \
  node node_modules/@playwright/test/cli.js test e2e/web/dashboard-layout.spec.ts --project=web --reporter=list
```

（服务沿用已在运行的 Web :3000 / API :4000，未重启；`npx playwright` 在本 shell 会 exit 126，故用上述 node 入口。）

## 7. 截图

桌面 1440（全页）：右卡已贴合内容，不再有 282px 空白带，左卡高度不变。

![dashboard-layout-1440](./dashboard-layout-1440.png)

移动 390（全页）：单列堆叠，两卡各自贴内容，无水平溢出。

![dashboard-layout-390](./dashboard-layout-390.png)

> 注：移动端全页截图里中部被固定底部导航覆盖，是 fullPage 截图对 `fixed` 元素的固有效果，非布局问题。
> 两张截图均来自最终代码版本的这次运行（`16:37` 生成）。

## 8. 改动文件

- `apps/web/components/dashboard/dashboard-page.tsx` — `:152` 容器加 `items-start`（唯一产品代码改动）
- `e2e/web/dashboard-layout.spec.ts` — 新增，3 条用例（验收 + 全仓诊断 + 移动端）
- `.audit/dashboard-layout/` — 本报告 + 2 张截图

未触碰 `apps/api/**`、`packages/**`、`apps/admin/**`；未新增依赖；未 `git add` / `commit` / `push`。

## 9. 已知风险

1. **「接下来」无行程时会更矮**：`EmptyState`（`px-4 py-8`）内容更短，在 `items-start` 下右卡不再被撑到左卡高度。
   这是期望行为（贴合内容），但视觉上会比左卡明显矮——若设计要求两卡等高，需要在产品层显式决定，
   而不是靠 Grid 的隐式 stretch。
2. **未来新增第三张卡片**：该行已显式 `items-start`，任何新卡片若依赖行高撑满需自行写 `self-stretch`，
   否则会立刻暴露为「矮卡」；这属于预期保护，但需要 reviewer 知道。
3. **左卡封面图为破图**：本次截图中 `NEXT JOURNEY` 封面位置显示破图图标（`<img src>` 的签名 URL/媒体资源不可用）。
   属于既有的数据/媒体问题，本次未改数据、未改 `<img>` 逻辑；不影响高度测量（`aspect-[16/7]` 由 CSS 固定）。
4. **`trip-edit` 右栏**（2337 / 486，空白 0）当前无可见空白，但其内容一旦变短会出现同类问题；
   该文件不在本任务可写范围，未改，仅记录。
5. 本次只放宽了 `minmax` 首轨模式做全仓实测；更通用的「任意 `grid` + 2 子项」扫描已由用例 2 覆盖，
   但只覆盖**已登录路由**（不含 auth/2FA 页面——`auth-shell` 为全屏壳、`two-factor-security` 已带 `items-start`，静态核对无风险）。

## 10. CodeGraph 证据

- `codegraph status` → `[OK] Index is up to date`（编辑后 watcher 自动增量，复查仍 OK）
- `codegraph_explore`（MCP，`projectPath: C:\Users\BY9700\Desktop\UI\roamlog`）查询
  `"dashboard-page.tsx DashboardPage next-trip grid grid-cols"`：
  - 命中**真实路径** `apps/web/components/dashboard/dashboard-page.tsx`（任务书写的
    `apps/web/app/(app)/w/[workspaceSlug]/(dashboard)/dashboard-page.tsx` 不存在——该目录下的
    `page.tsx` 只是包装，故按 CodeGraph 结果定位）。
  - `DashboardPage`（:63）→ 3 个调用方于 `apps/web/app/(app)/w/[workspaceSlug]/page.tsx`，
    测试 `dashboard-page.test.tsx`；blast radius 覆盖 `NextTripCard` / `DashboardRecent` / `getNextTrip`，
    确认改动只影响该行容器，不影响数据入口。
  - 渲染链：`WorkspaceDashboardPage → DashboardPage → Skeleton/Button/Progress/ErrorState/PageGlow`。

## 11. 移植来源

本任务是**回归修复**，非新功能，实现来源为本仓库已验收的同构先例 + 平台规范，无第三方代码引入：

- **同构先例**：`apps/web/components/map/atlas-workspace.tsx:281`
  `className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"`——
  MAP_ATLAS_LAYOUT 已合并的同类 bug 修法，本次逐字沿用 `items-start` 的位置与写法。
- **平台规范**：CSS Grid 规范中 `align-items` 的初始值为 `normal`，对 grid item 表现为 `stretch`
  （CSS Box Alignment Level 3, §5.4 `align-items` / `normal` 行为）；Tailwind CSS 4 `items-start`
  → `align-items: start`。因此显式 `items-start` 是取消隐式 stretch 的标准手段。
- **适配层**：无（未改 token、比例、间距、文案、数据）。