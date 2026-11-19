# Stage A：生产表面清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `apps/web` 与 `apps/admin` 里不再存在任何开发语义文案、mock 数据模式或不可用功能入口，只剩真实 API 路径。

**Architecture:** 删除 `NEXT_PUBLIC_DATA_MODE` 概念本身——路由不再分支，只渲染 live 组件；`providers.tsx` 变为纯 React Query provider；`legacy-mock/` 与 MSW 启动逻辑整体移除；`packages/api-mocks` 降级为 Playwright 专用测试夹具（不进任何 app bundle）。后台删除 fixture 模式，`/admin/content` 在 B4 完成前从导航移除（不留死链）。

**Tech Stack:** Next.js 16 App Router、React 19、TanStack Query、Playwright 1.65、NestJS（只读，不改）。

**Spec:** `docs/superpowers/specs/2026-11-19-roamlog-production-completion-design.md`（§4 工作流 A）

## Global Constraints

- 生产环境禁止出现：`MSW`、`mock`、`fixture`、`demo`、`data mode`、`LIVE API`、`演示`、`3001`、`ADMIN API ERROR` 等开发者语义（测试文件除外）。
- 不得为了通过测试而保留假数据；测试若依赖 mock 模式，改为依赖真实 API 或改为断言"该文案不存在"。
- 不改变任何真实业务逻辑与契约；本阶段只删与改文案。
- 每个 Task 结束必须 `pnpm --filter @roamlog/web typecheck` 或 `@roamlog/admin typecheck` 通过。
- 所有改动必须可在本地验证，不部署生产（Stage A 完成后本地验收，不单独上生产）。

## Review Focus

- **无 API 时的行为**：删除 mock 模式后，本地不启动 API 直接打开页面——用户会看到加载失败/错误态，而不是白屏或崩溃。
- **深链接**：直接访问 `/w/{slug}/trips/new` 等 URL（不经导航）仍能正确渲染。
- **后台无会话**：直接访问 `/admin/users` 应跳登录，而不是停在骨架屏。
- **已登录用户刷新**：刷新后仍保持会话，不因 provider 改动丢失。
- **构建产物**：`next build` 输出的 bundle 里不能残留 `demo-store` / `api-mocks` 字符串（用 grep 验证，不是靠肉眼）。

---

### Task 1: 删除 web 的数据模式分支

**Files:**
- Delete: `apps/web/lib/data-mode.ts`
- Delete: `apps/web/components/legacy-mock/**`
- Modify: `apps/web/components/providers.tsx`
- Modify: `apps/web/app/(app)/w/[workspaceSlug]/{page.tsx,journal/page.tsx,members/page.tsx,notifications/page.tsx,settings/page.tsx,activity/page.tsx,map/page.tsx}`
- Modify: `apps/web/app/(app)/w/[workspaceSlug]/trips/[tripId]/{page.tsx,map/page.tsx}`
- Test: `apps/web/components/__tests__/no-fixtures-in-api-mode.test.tsx`（改写为 `no-demo-surface.test.tsx`）

**Interfaces:**
- Consumes: 各路由的 live 组件（`JournalLive`、`MembersLive`、`NotificationsLive`、`SettingsLive`、`ActivityLive`、`AtlasWorkspace`、`TripDetailLive`）
- Produces: 路由不再导出 `DATA_MODE` 判断；`providers.tsx` 导出 `Providers({children})` 单一签名

- [ ] **Step 1: 写失败测试**

```tsx
// apps/web/components/__tests__/no-demo-surface.test.tsx
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "app");
const FORBIDDEN = [/data-mode/i, /DATA_MODE/, /legacy-mock/, /api-mocks/];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

describe("app routes carry no data-mode switch", () => {
  it("imports no data-mode module", () => {
    for (const file of walk(ROOT)) {
      const source = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) {
        expect(source, `${file} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @roamlog/web exec vitest run components/__tests__/no-demo-surface.test.tsx`
Expected: FAIL（`page.tsx` 命中 `DATA_MODE`）

- [ ] **Step 3: 删除 `apps/web/lib/data-mode.ts`，把每个路由改为直接渲染 live 组件**

每个路由从：
```tsx
return DATA_MODE === "api" ? <XLive .../> : <XWorkspace .../>;
```
改为：
```tsx
return <XLive .../>;
```
`trips/[tripId]/map/page.tsx` 原本 api 分支渲染 `EmptyState`，改为直接渲染该 `EmptyState`。
`providers.tsx` 删掉 `mockModeEnabled` / `mswEnabled` / `isApiBuild` / `LegacyMockRoot` / `MockBootScreen`，只保留 `QueryClientProvider`。

- [ ] **Step 4: 删除 `legacy-mock/` 目录并移除所有 `@/components/legacy-mock` 引用**

Run: `rg -l "legacy-mock" apps/web --glob '!**/*.test.*'`
Expected: 无输出

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @roamlog/web exec vitest run components/__tests__/no-demo-surface.test.tsx`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add -A apps/web
git commit -m "refactor(web): drop the mock data mode and render only the live routes"
```

---

### Task 2: 从构建链里摘掉 `NEXT_PUBLIC_DATA_MODE`

**Files:**
- Modify: `docker/web.Dockerfile`、`docker/admin.Dockerfile`
- Modify: `docker/compose.production.yml`、`docker/compose.staging.yml`、`docker/production.env.example`、`docker/staging.env.example`
- Modify: `.env.example`、`README.md`、`deploy/README.md`
- Modify: `tooling/scripts/check-env.ts`
- Test: `apps/web/components/__tests__/no-demo-surface.test.tsx`（新增一条断言）

**Interfaces:**
- Consumes: Task 1 删除的 `data-mode` 模块
- Produces: 构建参数只剩 `NEXT_PUBLIC_APP_ENV`

- [ ] **Step 1: 写失败测试**

```ts
it("no build input mentions the data mode flag", () => {
  const dockerfiles = ["../../docker/web.Dockerfile", "../../docker/admin.Dockerfile"];
  for (const file of dockerfiles) {
    expect(readFileSync(join(process.cwd(), file), "utf8")).not.toMatch(/NEXT_PUBLIC_DATA_MODE/);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @roamlog/web exec vitest run components/__tests__/no-demo-surface.test.tsx`
Expected: FAIL

- [ ] **Step 3: 删除每个文件里的 `NEXT_PUBLIC_DATA_MODE` / `NEXT_PUBLIC_ADMIN_DATA_MODE`**

Dockerfile 里删 `ARG` 与 `ENV` 两行；compose 里删 `environment` 条目；env 示例里删对应行并把注释改成「数据源固定为真实 API」；`check-env.ts` 删校验项。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @roamlog/web exec vitest run components/__tests__/no-demo-surface.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A docker .env.example README.md deploy tooling apps/web
git commit -m "build: remove the data mode build flag now that the app only has live routes"
```

---

### Task 3: 清掉 web 里的开发者语义文案

**Files:**
- Modify: `apps/web/components/settings/settings-live.tsx:119`
- Modify: `apps/web/components/dashboard/dashboard-page.tsx:134`
- Modify: `apps/web/components/charts/insights-workspace.tsx:56`
- Modify: `apps/web/components/map/atlas-workspace.tsx:61`
- Modify: `apps/web/components/trips/trips-library.tsx:136`
- Test: `apps/web/components/__tests__/no-demo-surface.test.tsx`

**Interfaces:**
- Consumes: 无
- Produces: 无（纯文案）

- [ ] **Step 1: 写失败测试**

```ts
const DEMO_COPY = ["LIVE API", "本地演示数据（非真实）", "MSW", "fixture", "local fixture"];
it("renders no developer-facing copy", () => {
  for (const file of walk(join(process.cwd(), "components"))) {
    if (file.includes(".test.")) continue;
    const source = readFileSync(file, "utf8");
    for (const phrase of DEMO_COPY) {
      expect(source, `${file} contains ${phrase}`).not.toContain(phrase);
    }
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @roamlog/web exec vitest run components/__tests__/no-demo-surface.test.tsx`
Expected: FAIL（5 处命中）

- [ ] **Step 3: 替换文案**

- `settings-live.tsx` 的 `<Badge>LIVE API</Badge>` 删除（页面标题已表达）。
- 四个 mock 模式的 `本地演示数据（非真实）` 徽标随 Task 1 的 mock 分支一起删除；若徽标在 live 组件里仍存在，改为不渲染。
- `trips-library.tsx` 的 `当前数据来自本地 MSW fixtures…` 整段删除。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @roamlog/web exec vitest run components/__tests__/no-demo-surface.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A apps/web
git commit -m "fix(web): remove developer-facing copy from production surfaces"
```

---

### Task 4: 后台删除 fixture 模式与开发者文案

**Files:**
- Modify: `apps/admin/lib/admin-data-mode.ts`（删除）
- Modify: `apps/admin/lib/admin-data-source.ts`
- Modify: `apps/admin/components/admin-ui/admin-mode-banner.tsx`
- Modify: `apps/admin/components/users/users-view.tsx:724`
- Modify: `apps/admin/components/workspaces/workspaces-view.tsx:784`
- Modify: `apps/admin/lib/fixtures.ts`（仅保留测试需要的类型）
- Test: `apps/admin/lib/admin-data-source.test.ts`

**Interfaces:**
- Consumes: `useGetMe`、`/v1/admin/*`
- Produces: `getAdminDataMode()` 删除；`AdminDataSource` 只保留 api 实现

- [ ] **Step 1: 写失败测试**

```ts
it("has no fixture mode switch", () => {
  const source = readFileSync(join(__dirname, "admin-data-source.ts"), "utf8");
  expect(source).not.toMatch(/fixture/i);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @roamlog/admin exec vitest run lib/admin-data-source.test.ts`
Expected: FAIL

- [ ] **Step 3: 删除 fixture 分支**

`admin-data-source.ts` 里所有 `mode === "fixture"` 分支、`fixtureResource()`、`MOCK_*` 引用删除；`admin-mode-banner.tsx` 删掉「3001 演示预览 · 不发送后台数据请求」整块，只保留真实数据源提示（或无提示）。
`users-view.tsx` / `workspaces-view.tsx` 的 `ADMIN API ERROR` 改为「加载失败，请稍后重试」，并把错误码放进 `<details>`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @roamlog/admin exec vitest run lib components`
Expected: PASS（同步修掉因删除 fixture 而失效的断言）

- [ ] **Step 5: 提交**

```bash
git add -A apps/admin
git commit -m "refactor(admin): drop fixture mode and surface real errors in user language"
```

---

### Task 5: 内容审核入口在 B4 前从导航移除

**Files:**
- Modify: `apps/admin/components/admin-shell/admin-nav.ts`
- Delete: `apps/admin/app/admin/content/page.tsx`
- Modify: `apps/admin/components/admin-shell/admin-shell.test.tsx`

**Interfaces:**
- Consumes: Task 4 的 api-only 数据源
- Produces: 导航项数量减少 1；不存在指向 `/admin/content` 的链接

- [ ] **Step 1: 写失败测试**

```ts
it("does not link to the unfinished moderation page", () => {
  const nav = readFileSync(join(__dirname, "../../components/admin-shell/admin-nav.ts"), "utf8");
  expect(nav).not.toContain("/admin/content");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @roamlog/admin exec vitest run components/admin-shell`
Expected: FAIL

- [ ] **Step 3: 从 `admin-nav.ts` 删除该项，删除 `app/admin/content/page.tsx`**

删除后 `grep -rn "admin/content" apps/admin` 必须无输出（含测试）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @roamlog/admin exec vitest run components/admin-shell`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A apps/admin
git commit -m "feat(admin): hide the moderation entry until the report model ships"
```

---

### Task 6: `packages/api-mocks` 降级为测试专用夹具

**Files:**
- Modify: `packages/api-mocks/package.json`（`"private": true`，明确 `description: "Playwright fixtures only"`）
- Modify: 所有 web 内 `@roamlog/api-mocks` 引用（`apps/web/components/share/demo-share.ts` 已删除；检查剩余）
- Test: `apps/web/components/__tests__/no-demo-surface.test.tsx`

**Interfaces:**
- Consumes: Task 1 删除的 mock 组件
- Produces: web 生产代码零 `@roamlog/api-mocks` 引用

- [ ] **Step 1: 写失败测试**

```ts
it("ships no test fixture package into the app", () => {
  for (const file of walk(join(process.cwd(), "components"))) {
    if (file.includes(".test.")) continue;
    expect(readFileSync(file, "utf8"), file).not.toContain("@roamlog/api-mocks");
  }
});
```

- [ ] **Step 2: 运行测试确认失败或通过**

Run: `pnpm --filter @roamlog/web exec vitest run components/__tests__/no-demo-surface.test.tsx`
若已通过，记录「Task 1 已顺带清理」，跳到 Step 4。

- [ ] **Step 3: 删除 web 内剩余引用，把需要的常量搬到 `e2e/support/`**

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @roamlog/web exec vitest run components/__tests__/no-demo-surface.test.tsx`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A packages/api-mocks apps/web e2e
git commit -m "test: keep the mock fixtures strictly for Playwright"
```

---

### Task 7: 全量验证与本地真机检查

**Files:** 无（验证任务）

**Interfaces:** 无

- [ ] **Step 1: 静态门禁**

```bash
pnpm --filter @roamlog/web typecheck
pnpm --filter @roamlog/admin typecheck
pnpm lint
pnpm --filter @roamlog/web build
pnpm --filter @roamlog/admin build
```

Expected: 全部 exit 0

- [ ] **Step 2: 文案门禁**

```bash
rg -nEi "msw|fixture|local fixture|data mode|演示|LIVE API|ADMIN API ERROR" apps/web/components apps/web/app apps/admin/components apps/admin/app --glob '!**/*.test.*'
```

Expected: 无输出

- [ ] **Step 3: 构建产物门禁**

```bash
rg -l "demo-store|api-mocks|demoFixtureState" apps/web/.next --glob '!cache/**'
```

Expected: 无输出

- [ ] **Step 4: 本地真机检查（不部署生产）**

启动本地栈（embedded PG + API + web，见 `.audit/local-verify/`），逐项确认：
1. 未登录访问 `/w/x` → 跳登录，不是白屏
2. 登录后 `/w/{slug}`、`/trips`、`/trips/new`、`/insights`、`/map`、`/settings` 均可渲染
3. 断掉 API（停进程）后刷新 → 显示错误态与重试，不崩
4. `/admin/users` 无会话 → 跳登录
5. 截图存 `.audit/evidence/stage-a/`

- [ ] **Step 5: 提交验收记录**

```bash
git add .audit
git commit -m "docs: record the stage A production-surface acceptance"
```

---

## Self-Review

- **Spec coverage**：§4「工作流 A」的 4 条要求（删开发文案、删 mock 代码路径、删数据模式开关、后台清理）分别由 Task 1/2/3/4/6 覆盖；§4 提到的「不重构页面」由 Task 3 的「只改文案」约束保证。
- **缺口**：§4 说「`/admin/content` 二选一（做完整或下线）」，本计划选下线（Task 5），做完整留在 B4——这是有意的分期，不是遗漏。
- **类型一致性**：`Providers({children})`、`getAdminDataSource()`（无 mode 参数）、`AdminDataSource`（单一实现）在 Task 1/4 定义，Task 7 使用，名称一致。
- **Proportion**：本计划约 300 行，spec 的 A 节约 12 行；计划更长是因为它是删除型改动，必须逐文件点名，属必要精度而非转录代码。