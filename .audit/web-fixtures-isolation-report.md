# WEB_FIXTURES_ISOLATION — fixture 隔离交付报告

状态: DONE（api 构建 exit 0，fixture 特征串命中 0）
任务 ID: WEB_FIXTURES_ISOLATION
角色: web_frontend
日期: 2026-11-18

---

## 1. 变更文件

新增：

- `apps/web/components/legacy-mock/mock-root.tsx`
- `apps/web/components/legacy-mock/README.md`
- `apps/web/components/__tests__/no-fixtures-in-api-mode.test.tsx`
- `.audit/web-fixtures-isolation-report.md` / `.checkpoint.md`

移动（`git mv`，内容保留）：

- `components/trip-detail/{activity,budget,itinerary,journal,overview,packing,photos,trip-map}-tab.tsx` → `components/legacy-mock/trip-detail/`
- `components/trip-detail/{budget,itinerary,packing}-tab.test.tsx` → `components/legacy-mock/trip-detail/`
- `components/trips/trip-detail.tsx` → `components/legacy-mock/trip-detail/trip-detail.tsx`（仅改 8 行相对 import）
- `components/share/demo-share.ts` → `components/legacy-mock/share/demo-share.ts`

修改：

- `components/providers.tsx`（动态化 fixture 边界）
- 路由 7 个：
  - `app/(app)/w/[workspaceSlug]/trips/[tripId]/page.tsx`
  - `app/(app)/w/[workspaceSlug]/trips/[tripId]/map/page.tsx`
  - `app/(app)/w/[workspaceSlug]/{journal,members,notifications,settings,activity}/page.tsx`
- `components/share/public-share-page.tsx`、`components/share/share-link-dialog.tsx`、`components/share/share.test.tsx`

**未改（有意）**：

- `components/trips/trip-detail-live.tsx` —— 0 改动，未 import 任何 mock tab（只 import `@/lib/demo-format` 的 `shortDate` 等纯工具）。
- `lib/demo-format.ts` —— 核实为纯函数/常量（`moodLabels`/`weatherLabels`/`formatMinor`/`shortDate`/`monthLabel`/`entryBody`/`gradientFor`），无 fixture，不改名不拆分。
- `components/map/atlas-workspace.tsx`（工作区级地图）—— 已核实 0 处 demo-store/api-mocks import，不动。
- `components/trip-detail/entry-revision-list.tsx` —— **保留原地**，理由见 §6。
- `components/forms/**`、`components/media/**`、`packages/**`、`apps/api/**`、`apps/admin/**`、`next.config.ts`、`vitest.config.ts` —— 全部未触碰。

---

## 2. 实现摘要

### 2.1 `providers.tsx`：fixture 边界动态化

```tsx
const mockModeEnabled = DATA_MODE === "mock";                          // 挂载门控：只看数据模式
const mswEnabled = mockModeEnabled && process.env.NODE_ENV !== "production";  // MSW 仍然 dev/test only
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";        // 构建门控：模块级常量

const LegacyMockRoot: MockRootComponent | undefined = isApiBuild
  ? undefined
  : dynamic(
      () => import("@/components/legacy-mock/mock-root").then((m) => m.LegacyMockRoot),
      { ssr: false, loading: () => <MockBootScreen /> },
    );

const startMockRuntime: (() => Promise<void>) | undefined = isApiBuild
  ? undefined
  : () => import("@/components/legacy-mock/mock-root").then((m) => m.startMockWorker());

// 渲染
{mockModeEnabled && LegacyMockRoot ? <LegacyMockRoot>{children}</LegacyMockRoot> : children}
```

- 关键点：`next/dynamic` 本身**总会**生成 chunk，所以 `import()` 必须放在能被 bundler 常量折叠的分支里。
  `process.env.NEXT_PUBLIC_DATA_MODE` 在构建期被内联为字面量，`isApiBuild` 因此成为 `true`/`false`，
  api 构建中整个 mock 分支（含 `import()`）被当作死代码消除。
- 刻意**不**复用 `resolveDataMode()`：函数调用会挡住 bundler 的常量折叠。
- MSW 也走同一懒边界（`startMockRuntime` → `mock-root` → `lib/msw`），否则 `lib/msw.ts` 里
  `import("@roamlog/api-mocks/browser")` 仍会生成含 fixtures 的 chunk。
- 保留原有 MSW 启动中/失败界面与「重试」按钮；`MockBootScreen` 同时用作 `dynamic` 的 loading。
- `DemoDataProvider` 的挂载只由 `DATA_MODE === "mock"` 决定（api 模式不挂载：生产组件均不调用
  `useDemoStore`，已全量 grep 确认）。`NODE_ENV` 只约束 MSW，不再约束挂载。

### 2.2 路由页：Live 静态、mock 动态

统一模式（7 个路由页）：

```tsx
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";
const LegacyX = isApiBuild ? undefined : dynamic(() => import("…").then((m) => m.X));

if (DATA_MODE === "api") return <XLive … />;
return LegacyX ? <LegacyX … /> : null;
```

- **未使用 `ssr:false`**：这 7 个都是 Server Component，Next 16 明确禁止在 Server Component 里用
  `next/dynamic` 的 `ssr:false`（`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md:94-95`：
  “`ssr: false` option is not supported in Server Components”）。真实约束下改用普通 `dynamic()`；
  被导入的 mock 组件本身是 Client Component，行为不变。
- `trips/[tripId]/map/page.tsx`：**没有 Live 对应物**（核查 `components/map/` 只有工作区级的
  `TripMapLive`，且它属于工作区 `/w/[slug]/map`，不是本趟行程地图）。因此 api 模式渲染
  `@roamlog/ui` 的 `EmptyState`「行程地图尚未接入」，不渲染 mock tab、不白屏、不用演示数据伪造。

### 2.3 share：真实路径静态，演示路径动态

- `public-share-page.tsx`：`getPublicTrip`（真实 API）保持静态；mock 分支改为
  `loadDemoShare()`（模块级 `isApiBuild` 门控的 `import()`）。类型 `DemoShareResolution` 用
  `import type`（编译期擦除）。密码提交分支同样懒加载。
- `share-link-dialog.tsx`：`registerMockShare` 改为懒加载；该组件同时被生产 `trip-map-live.tsx` 使用，
  真实 `createShareLink` 路径保持静态，生产行为不变。
- `share.test.tsx`：import 指向 `legacy-mock/share/demo-share`（仅测试）。

### 2.4 防回归护栏

`apps/web/components/__tests__/no-fixtures-in-api-mode.test.tsx`（5 个用例，已确认被 vitest 拾取）：

1. 静态扫描 `apps/web` 全量源码，除 `components/legacy-mock/`、`test/`、`__tests__/`、`*.test.*`、
   以及 fixture 模块自身（`lib/demo-store.tsx`、`lib/msw.ts`）外，**不得**存在对
   `@/lib/demo-store` / `@roamlog/api-mocks` 的值 import（`import type` 放行）。
2. `KNOWN_LEGACY_VIOLATIONS` 白名单只能收缩：每条必须仍然存在且仍然违规，否则测试变红。
3. `app/**` 下任何 route 不得静态 import `@/components/legacy-mock/**` 或 5 个 mock workspace 模块。
4. `providers.tsx` 必须使用 `dynamic(`/`lazy(`；断言**正交**门控：
   `const mockModeEnabled = DATA_MODE === "mock";`（挂载只看数据模式）、
   `const mswEnabled = mockModeEnabled && process.env.NODE_ENV !== "production";`
   （`NODE_ENV` 只约束 MSW，不约束挂载）、渲染处 `{mockModeEnabled && LegacyMockRoot ?`、
   模块级 `isApiBuild` 折叠条件；同时不得有 fixture 静态 import。
5. `legacy-mock/README.md` 存在且写明生产禁用与删除计划。

---

## Gating 语义（正交，验收后修正）

两个门控解决两个不同问题，互不替代：

| 常量 | 表达式 | 求值时机 | 作用 |
| --- | --- | --- | --- |
| `mockModeEnabled` | `DATA_MODE === "mock"` | 运行时 | **是否挂载** `DemoDataProvider` |
| `mswEnabled` | `mockModeEnabled && NODE_ENV !== "production"` | 运行时 | 是否启动 MSW（与界面文案「MSW 只在 development / test 环境启动」一致） |
| `isApiBuild` | `process.env.NEXT_PUBLIC_DATA_MODE === "api"` | **构建期常量折叠** | 是否把 mock 分支 + `import()` **从产物中消除** |

- `DATA_MODE` 决定「演示模式跑不跑」，`isApiBuild` 决定「fixture 代码进不进 bundle」。
- `NEXT_PUBLIC_DATA_MODE=mock` + 生产 `next build && next start` → **挂载 demo store**、产物含 fixture（预期）；
  `NEXT_PUBLIC_DATA_MODE=api` + 生产构建 → 不挂载、产物 0 fixture。
- 本轮修正：此前把 `NODE_ENV !== "production"` 混进**挂载**门控，会导致「本地/预发用生产构建跑
  mock 模式」时所有 `useDemoStore` 页面白屏/抛错。已改为只由 `DATA_MODE` 决定挂载；MSW 仍 dev/test only。

**实测对照（顺序构建，`.next` 互相覆盖，已标注每次产物时间戳）**：

| # | `NEXT_PUBLIC_DATA_MODE` | 命令 | exit | `.next/required-server-files.json` | `demoFixtureState` 命中 |
| --- | --- | --- | --- | --- | --- |
| 1 | `api` | `next build` | **0** | 22:11:00 | **0 files / 0 matches** |
| 2 | `mock`（对照组） | `next build` | **0** | 22:11:38 | **4 files / 20 matches** |
| 3 | `api`（还原交付产物） | `next build` | **0** | 22:12:16 | **0 files / 0 matches** |

对照组证明：mock 的生产构建仍然把 fixture 打进产物、demo store 仍会挂载，未被误杀；
第 3 次构建把 `.next` 还原为 api 产物，避免交付时留下 mock 产物。

## 3. 验证命令与结果

### 3.1 TypeScript

```
$ pnpm --filter @roamlog/web typecheck
$ next typegen && tsc --noEmit
```

- 最终状态：`pnpm --filter @roamlog/web typecheck`（`next typegen && tsc --noEmit`）**exit 0，0 error**。
- 我的文件在历次 `tsc --noEmit` 中 **0 error**。
- 过程中出现过 3 类外部错误（均属其他 Agent 的在途 untracked 文件，我未修改）：
  `components/forms/searchable-combobox.tsx` TS6196（已由 owner 于 22:01:49 删除）、
  `components/media/cover-uploader.tsx` TS2724 ×2、`components/media/use-cover-upload.ts` TS2304
  （已由 owner 修复）。我全程没有写入 `components/forms/**` 或 `components/media/**` 任何文件。

### 3.2 测试

```
$ pnpm --filter @roamlog/web test
 ✓ components/__tests__/no-fixtures-in-api-mode.test.tsx (5 tests) 39ms
 Test Files  23 passed (23)
      Tests  114 passed (114)
TEST_EXIT=0
```

新护栏测试在**全量 `pnpm test` 输出里被真实拾取**（上面第一行即证据，不是单独指定路径跑出来的）。

移动后的 mock tab 测试与 share 测试：

```
$ pnpm --filter @roamlog/web exec vitest run components/__tests__ components/share components/legacy-mock
 Test Files  5 passed (5)
      Tests  13 passed (13)
```

### 3.3 生产构建（api 主证据 + mock 对照组）

三次构建顺序执行，`.next` 互相覆盖，均已标注产物时间戳：

**构建 #1 — `NEXT_PUBLIC_DATA_MODE=api`（主证据）**

```
$ rm -rf apps/web/.next
$ NEXT_PUBLIC_DATA_MODE=api pnpm --filter @roamlog/web build
✓ Compiled successfully in 13.6s
  Finished TypeScript in 14.7s ...
✓ Generating static pages using 15 workers (10/10) in 661ms
BUILD_API_EXIT=0
```

`.next/required-server-files.json` = **22:11:00**

**构建 #2 — `NEXT_PUBLIC_DATA_MODE=mock`（对照组，验收新增要求）**

```
$ rm -rf apps/web/.next
$ NEXT_PUBLIC_DATA_MODE=mock pnpm --filter @roamlog/web build
✓ Compiled successfully in 11.6s
  Finished TypeScript in 10.2s ...
✓ Generating static pages using 15 workers (10/10) in 394ms
BUILD_MOCK_EXIT=0
```

`.next/required-server-files.json` = **22:11:38**

**构建 #3 — `NEXT_PUBLIC_DATA_MODE=api`（还原交付产物）**

```
$ rm -rf apps/web/.next
$ NEXT_PUBLIC_DATA_MODE=api pnpm --filter @roamlog/web build
✓ Compiled successfully in 9.8s
  Finished TypeScript in 9.4s ...
✓ Generating static pages using 15 workers (10/10) in 407ms
BUILD_API_RESTORE_EXIT=0
```

`.next/required-server-files.json` = **22:12:16**（交付时 `.next` 中的是 api 产物）

### 3.4 `.next` fixture 特征串检索

命令：

```
$ cd apps/web
$ for s in 林知夏 demoFixtureState "MSW DEVELOPMENT DATA" lib/demo-store api-mocks legacy-mock demo-store; do
    printf '%-24s files=%s matches=%s\n' "[$s]" \
      "$(grep -rl --binary-files=text -F "$s" .next --exclude-dir=cache | wc -l)" \
      "$(grep -ro --binary-files=text -F "$s" .next --exclude-dir=cache | wc -l)"; done
```

原始输出：

```
[林知夏]              files=0 matches=0
[demoFixtureState]       files=0 matches=0
[MSW DEVELOPMENT DATA]   files=0 matches=0
[lib/demo-store]         files=0 matches=0
[api-mocks]              files=2 matches=2
[demo-store]             files=0 matches=0
[legacy-mock]            files=4 matches=7
```

**判定：fixture 数据命中 = 0。** 两个非零项均不包含 fixture 数据，逐条说明：

**同一条命令在 mock 对照组（构建 #2）上的结果**（证明这些特征串本身是可被检出的，不是永远为 0）：

```
[demoFixtureState]       files=4  matches=20
[demo-store]             files=41 matches=69
[legacy-mock]            files=25 matches=59
[林知夏]                 files=0  matches=0
[MSW DEVELOPMENT DATA]   files=0  matches=0
```

- `林知夏` 在 mock 构建里也是 0，因为它根本不在 web fixture 里：它是 **admin** 的 fixture 字串
  （`apps/admin/lib/fixtures.ts`、`apps/admin/lib/ops-fixtures.ts` 及其测试），web 包内不含。
- `MSW DEVELOPMENT DATA` 在整个仓库中**不存在**（全仓 grep 0 命中），把它列为检索词只是防御性检查。
- 因此 web 侧的有效判据是 `demoFixtureState` / `demo-store` / `api-mocks` / `legacy-mock`，
  前三者在 api 构建为 0、在 mock 构建 > 0 —— 方向正确。

**(A) `api-mocks` ×2 —— Next 配置元数据，不是代码**

文件：`.next/required-server-files.js`、`.next/required-server-files.json`

上下文（前 180 字符）：

```json
"bundlePagesRouterDependencies": false,
"configFileName": "next.config.ts",
"transpilePackages": [
  "@roamlog/api-mocks",
  "@roamlog/contracts",
  "@roamlog/ui"
],
```

来源是 `apps/web/next.config.ts:7` 的 `transpilePackages`，Next 会把解析后的配置序列化进这两个
manifest。它是**配置文件名的字符串**，不含任何 fixtures 代码或数据，也不对应任何 chunk；
真正装进 bundle 的模块图已由 `lib/demo-store`/`demo-store`/`林知夏` = 0 证明为空。
要清零只能改 `next.config.ts`（本任务禁止），且该字段是 mock 开发模式打包所必需。

**(B) `legacy-mock` ×7（4 个文件）—— server source map 的 `sourcesContent`**

文件：

```
.next/server/chunks/ssr/apps_web_components_share_public-share-page_tsx_1t9s6qpzad3hj._.js.map
.next/server/chunks/ssr/_04wo7x9fwvpp5._.js.map
.next/server/chunks/ssr/_0o9_7vv617gw3._.js.map
.next/server/chunks/ssr/_1jz1q0da4p493._.js.map
```

上下文：

```js
// public-share-page map
"import type { DemoShareResolution } from \"@/components/legacy-mock/share/demo-share\";"
// tripId page map
"* Fixture boundary: the legacy demo trip detail lives in `legacy-mock/` ..."
// tripId/map page map
"const LegacyTripMapTab = isApiBuild\n  ? undefined\n  : dynamic(() => import(\"@/components/legacy-mock/trip-detail/trip-map-tab\") ..."
// providers map
"const LegacyMockRoot ... isApiBuild\n  ? undefined\n  : dynamic(() => import(\"@/components/legacy-mock/mock-root\") ..."
```

这是 source map 保存的**源码原文**，不是编译产物。同一批 chunk 的 `.js` 文件实测：

```
_0o9_7vv617gw3._.js      legacy-mock=0  demo-store=0
_1jz1q0da4p493._.js      legacy-mock=0  demo-store=0
_04wo7x9fwvpp5._.js      legacy-mock=0  demo-store=0
```

且行程地图页编译后的全部函数体为：

```js
async function d({params:a}){let{tripId:e}=await a;return(0,b.jsx)("div",{className:"mx-auto w-full max-w-6xl",children:(0,b.jsx)(c.f,{title:"行程地图尚未接入",description:"真实行程地图还在开发中。…"})})}
```

——只剩 api 分支的 `EmptyState`，mock 分支与 `import()` 已被**完全消除**。这是“构建期常量折叠生效”的直接证据，
而不是“代码里没有静态 import”的间接推断。

**(C) `.next/cache/.tsbuildinfo`**（被 `--exclude-dir=cache` 排除）内含 `api-mocks` 字符串，
是 tsc 增量缓存里的**类型声明文件路径**。`.next/cache` 不进部署产物（`turbo.json` build outputs
已声明 `!.next/cache/**`），无运行时影响。

非 fixture 的次要命中（已核实，不属泄漏）：

- `roamlog-crew`（5 文件）：既有硬编码，来自 `components/app-shell/workspace-app-shell.tsx:122`
  的兜底 slug、`app/not-found.tsx:16` 的返回链接、mock `settings-workspace.tsx:226` 的只读输入。
  不来自 `@roamlog/api-mocks`；本任务未触碰，作为残留 demo 硬编码上报。
- `guestNames`：`packages/contracts/src/entities/trip.ts` 的真实 Trip 字段名，非 fixture。

---

## 4. CodeGraph 证据

1. 门禁：`codegraph status` 初始为脏（Added 3 / Modified 5）→ `codegraph sync`（8 文件 / 223 nodes / 3.0s）
   → `codegraph status` = `[OK] Index is up to date`。
2. 主查询：

```
codegraph explore "DemoDataProvider providers.tsx demo-store trip-detail.tsx overview-tab packing-tab photos-tab budget-tab"
```

结果摘要：105 symbols / 8 files；blast radius：

- `DemoDataProvider`（`lib/demo-store.tsx:189`）— 4 callers，全部在 `components/providers.tsx`；
  测试 `apps/web/test/demo-render.tsx`。
- `Providers`（`components/providers.tsx:27`）— 2 callers（`app/layout.tsx`）。
- 调用链 `Providers → DemoDataProvider → createDemoState → demoFixtureState`
  （`lib/demo-store.tsx:112-114`，fixture 入口），以及 `Providers → startMockWorker → @roamlog/api-mocks/browser`。

3. 依赖核查（CodeGraph + grep 交叉验证）：

- `EntryRevisionList` 的真实消费者是 `components/journal/journal-editor-sheet.tsx:32`，
  而非只被 mock tab 使用 → 决定不移动（见 §6）。
- `trip-detail-live.tsx` 的 import 列表只含 `@/lib/demo-format`（`shortDate`）、`@/lib/query`、
  `@/lib/api`、`@/lib/trip-presentation`，**不含**任何 mock tab 或 demo-store → 不触发停手条件。

---

## 5. 已知风险

1. **（已修正）mock root 挂载门控不再混入 `NODE_ENV`。** 验收指出的设计缺陷：此前
   `mocksEnabled = DATA_MODE === "mock" && NODE_ENV !== "production"` 会让「生产构建 + mock 模式」
   不挂载 `DemoDataProvider`，所有 `useDemoStore` 页面抛错/白屏。
   现为：`mockModeEnabled = DATA_MODE === "mock"` 控制挂载；`mswEnabled = mockModeEnabled && NODE_ENV !== "production"`
   只控制 MSW；`isApiBuild` 控制产物消除（见「Gating 语义」节的三次构建对照）。
   剩余限制：生产 mock 构建**不启动 MSW**，只挂载本地 demo store —— 依赖 MSW 的 mock 页面（若有）
   仍需真实 API；这与界面文案「MSW 只在 development / test 环境启动」一致。
2. **`ssr: false` 在 Server Component 不可用**，7 个路由页使用了普通 `dynamic()`。
   由于被导入的 mock 组件都是 Client Component，实际仍是客户端懒加载；但与任务书字面要求不同，已在此说明。
3. **白名单未清零**：7 个 mock `*-workspace` 仍静态 import demo-store（见 §7）。它们已不在 api 构建的
   入口图里（fixture 命中 0 已证明），但静态 lint 层面仍需后续迁移。
4. `.next` 里 `api-mocks`（配置元数据）与 `legacy-mock`（source map 原文）无法在不动
   `next.config.ts` / 不关 source map 的前提下清零；二者均不含 fixture 数据，理由见 §3.4。

## 6. 关于 `entry-revision-list.tsx`（未按字面指令移动）

任务书要求「9 个 tab + entry-revision-list 整体移动」。核实后**不移动**：

- 依赖链：生产路由 `journal/page.tsx → journal-live.tsx → components/journal/journal-editor-sheet.tsx:32
  → @/components/trip-detail/entry-revision-list`。
- 该文件只 import `@roamlog/contracts` 与 `@roamlog/ui`，**零** fixture / demo-store 依赖，不是 mock tab。
- 移动它会打断生产日志页（journal-editor-sheet 不在我的可写范围），并会让生产组件反向依赖
  `legacy-mock/`，违背隔离目标。
- 处理：保留原地，在 `legacy-mock/README.md` 的「不在此目录的文件」中写明原因。

## 7. 白名单：边界外的 7 个 mock 模块（后续动作）

| 文件 | 现状 | 建议动作 |
| --- | --- | --- |
| `components/activity/activity-workspace.tsx` | 静态 `useDemoStore`，仅被 `activity/page.tsx` 动态加载 | 迁入 `legacy-mock/` 或由 `WEB_TRIP_WORKSPACE` 替换 |
| `components/journal/journal-workspace.tsx` | 同上（`journal/page.tsx`） | 同上 |
| `components/journal/journal-compose-dialog.tsx` | journal-workspace 依赖 | 随 journal-workspace 一起迁移 |
| `components/journal/journal-entry-sheet.tsx` | journal-workspace 依赖 | 同上 |
| `components/members/members-workspace.tsx` | 同上（`members/page.tsx`） | 同上 |
| `components/notifications/notifications-workspace.tsx` | 同上（`notifications/page.tsx`） | 同上 |
| `components/settings/settings-workspace.tsx` | 同上（`settings/page.tsx`） | 同上 |

护栏测试对每条做「仍存在 且 仍违规」断言，迁移后必须同步删条目，否则 CI 变红。

## 8. 未覆盖项

- 未启动 dev server，未做浏览器级 mock 模式回归（任务禁止起 dev server）。mock 模式的
  providers 组合逻辑目前只有类型检查与静态审查，建议 E2E（`pnpm e2e:web`）跑一次冒烟。
- 未修改/未验证 `components/forms/**`、`components/media/**` 等并行 Agent 文件。
- 未做 admin / api 侧 fixture 隔离（不在本任务范围）。

## 9. 过程中的外部阻断（已全部解除，不影响结论）

本任务执行期间，全项目 tsc 先后被 3 条其他 Agent 的在途文件错误阻断，我未修改它们：

1. `components/forms/searchable-combobox.tsx(65,11) TS6196` — 22:01:49 由 `WEB_TRIP_FORM` 自行删除。
2. `components/media/cover-uploader.tsx` TS2724 ×2、`components/media/use-cover-upload.ts` TS2304 —
   由 `WEB_COVER_UPLOAD` 修复。
3. `components/media/cover-uploader.test.tsx(106,7) TS2554` — 22:02:23 由 owner 修复。

全部解除后已复跑 `tsc --noEmit`（0 error）与 `NEXT_PUBLIC_DATA_MODE=api next build`
（exit 0；最新产物 22:12:16）。我全程对 `components/forms/**`、`components/media/**` **零写入**。

## 10. 建议的下一步

1. root 复跑一次 `NEXT_PUBLIC_DATA_MODE=api pnpm --filter @roamlog/web build` + §3.4 检索（预期 exit 0、
   fixture 命中 0），作为 G3 验收证据；如需验证演示能力，再跑一次 `NEXT_PUBLIC_DATA_MODE=mock` 对照（
   `demoFixtureState` 应 > 0）。
2. 把 §7 的 7 个 workspace 文件纳入 `WEB_TRIP_WORKSPACE` 或后续 `WEB_LEGACY_MOCK_SWEEP`，
   迁入 `legacy-mock/` 并删除白名单条目。
3. 清理残留 demo 硬编码 `roamlog-crew`（属既有问题，不在本任务范围）：
   `apps/web/components/app-shell/workspace-app-shell.tsx:122`（兜底 slug）、
   `apps/web/app/not-found.tsx:16`（返回链接）、
   `apps/web/components/settings/settings-workspace.tsx:226`（只读输入值）。
   前两处在生产 shell/404 页面里，建议改为由真实 workspace 数据或 `/w` 根路由推导。
4. （可选）若希望生产 mock 构建也具备完整 mock API，需单独评估 MSW 在生产环境的安全与缓存策略，
   不应直接放开——当前行为与产品文案一致。