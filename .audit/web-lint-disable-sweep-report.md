# WEB_LINT_DISABLE_SWEEP — 未注册规则 `eslint-disable` 清理报告

状态: **DONE**
任务 ID: WEB_LINT_DISABLE_SWEEP
时间: 2026-11-18 22:36 (Asia/Shanghai)
角色: web_frontend

---

## 1. 结论速览

| 项 | 结果 |
| --- | --- |
| 我负责的 `@next/next/*` 未注册规则 error | **1 处 → 0 处（归零）** |
| `pnpm --filter @roamlog/web lint` | 剩余 **1 error**，属 `trip-form`（其他 Agent，禁止目录） |
| `pnpm --filter @roamlog/web typecheck` | **0 错误**（exit 0） |
| `pnpm --filter @roamlog/web exec vitest run components/app-shell` | **13/13 通过** |
| 全仓 `pnpm lint` | 仅 `@roamlog/web#lint` 失败（同一 `trip-form` error）；`@next/next/` 相关 error 全仓为 0 |

---

## 2. 先决核查：插件是否真的未注册（任务第 3 条）

仓库只有**一份** ESLint 配置（`**/eslint.config.*` / `**/.eslintrc*` 全局 glob 仅命中这一处，无 `apps/web` 局部配置）：

`eslint.config.mjs:1-27`

```js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [ ... ] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "@typescript-eslint/no-explicit-any": "warn", "@typescript-eslint/no-unused-vars": ["error", { ... }] } },
);
```

- **没有** `import nextPlugin from "@next/eslint-plugin-next"`，**没有** `nextPlugin.flatConfig...`，`plugins` 里也没有 `"@next/next"`。
- `apps/web/package.json` 的 lint 脚本显式使用根配置：`eslint -c ../../eslint.config.mjs .`，所以不存在"某个 app 自带 next 插件"的旁路。
- 实际报错也自证：`Definition for rule '@next/next/no-img-element' was not found` —— 配置里无该规则定义，eslint 对 disable 注释里的未知规则报 error。

→ 满足任务前提，**不需要停手**，按方案删除注释。

附带事实（供根 Agent 知悉，未改动）：`react-hooks/exhaustive-deps` 在本配置里同样**未注册**，因此任何引用它的 disable 注释也会报同一类 error；本次全 `apps/web` 搜索未发现此类注释。

---

## 3. 全量搜索范围与命中

命令（任务给定口径，另加一次含 `packages/` 的全仓复核）：

```bash
grep -rn "eslint-disable" apps/web --include=*.tsx --include=*.ts \
  | grep -v "components/trip-form\|components/forms/\|edit-trip-page\|components/trip-workspace"
# → 仅 1 行命中

grep -rn "@next/next" apps packages --include=*.tsx --include=*.ts | grep -v node_modules
# → 仅 1 行命中（即同一处，删除后为 0 行）
```

命中清单（清理前）：

| 文件:行 | 引用的规则 | 处理 |
| --- | --- | --- |
| `apps/web/components/app-shell/topbar-members.tsx:62` | `@next/next/no-img-element` | **删除该行注释** |

- `apps/web` 下共扫描 207 个 `.ts/.tsx` 文件（`ops_grep` 报告 `scanComplete=true, matchedTotal=1`），**没有第二处**需要处理的 disable 注释。
- `packages/db/src/generated/prisma/**` 里的 `eslint-disable` 均属生成代码，且被根配置 `**/src/generated/**` 忽略；同时不在本任务可写范围，未触碰。

---

## 4. 逐处变更

### 4.1 `apps/web/components/app-shell/topbar-members.tsx`（唯一变更）

```diff
           {member.user.image ? (
-            // eslint-disable-next-line @next/next/no-img-element -- avatars point at tenant-uploaded URLs, so next/image cannot be configured ahead of time.
             <img src={member.user.image} alt="" loading="lazy" className="size-6 object-cover" />
           ) : (
             initialsFor(member.user.name)
```

- **删了什么**：整行注释（含 `--` 说明）。**代码一行未改**，`<img>`、`alt=""`、`loading="lazy"`、`className` 全部保留。
- **为什么该规则未注册**：见 §2，`@next/next` 插件从未在 `eslint.config.mjs` 中注册，eslint 把 disable 注释里的规则名当作未知规则 → 报 error；注释本身没有抑制任何真实规则，删除零行为影响。
- **为什么保留 `<img>` 而不改 `next/image`**：头像 URL 来自租户上传（`member.user.image` 由 API 传入的绝对地址），`next/image` 需要在 `next.config` 预配 `remotePatterns`，无法为任意租户域预知；`<img>` + `loading="lazy"` 是当前正确选择，符合任务要求。
- **删除后是否触发其它 error**：没有。配置里没有任何 JSX/a11y/next 规则作用于 `<img>`，`no-unused-vars` 等也不受影响（该文件无只被注释引用的变量）。lint/typecheck 结果见 §5。

**未改动的文件**：0。禁止目录（`trip-form`、`forms`、`edit-trip-page`、`trip-workspace`、`apps/api`、`apps/admin`、`packages`、`eslint.config.mjs`、lockfile）全部未碰；未执行 `git reset/clean/checkout/stash`，未提交，未 `pnpm install`，未安装任何 eslint 插件。

---

## 5. 验证命令与结果

### 5.1 `pnpm --filter @roamlog/web lint`

改前（基线）：

```
topbar-members.tsx  62:13  error  Definition for rule '@next/next/no-img-element' was not found  @next/next/no-img-element
trips/trip-form/currencies.ts  86:9  error  The value assigned to 'name' is not used in subsequent statements  no-useless-assignment
✖ 2 problems (2 errors, 0 warnings)   → exit 1
```

改后：

```
trips/trip-form/currencies.ts
  86:9  error  The value assigned to 'name' is not used in subsequent statements  no-useless-assignment
✖ 1 problem (1 error, 0 warnings)   → exit 1
```

- **`topbar-members.tsx` 已从输出中消失；输出中不再含任何 `@next/next/` error。**
- 剩余 1 error 位于 `apps/web/components/trips/trip-form/currencies.ts:86`，属**其他 Agent 的禁止目录**（本次任务开始前的基线里也存在，非我引入）。
- 注：任务简报提到"同期 4 条 error 在 `trip-form`/`trip-workspace`"，实际在我两次运行中均为 **1 条**（`trip-form/currencies.ts`）——期间其他 Agent 已修掉其余几条，`trip-workspace` 当前为 0 条。

### 5.2 `pnpm --filter @roamlog/web typecheck`

```
$ next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully            → exit 0
```

0 错误，删除注释未引入任何语法/类型问题。

### 5.3 `pnpm --filter @roamlog/web exec vitest run components/app-shell`

```
RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/web
✓ components/app-shell/app-shell.test.tsx (13 tests) 251ms
Test Files  1 passed (1)
     Tests  13 passed (13)               → exit 0
```

全绿；`TopbarMembers` 的渲染路径（含用户带 `image` 的分支）未受影响。

### 5.4 全仓 `pnpm lint`（额外证据，非本任务验收项）

```
@roamlog/web:lint:   86:9  error  The value assigned to 'name' is not used in subsequent statements  no-useless-assignment
@roamlog/web:lint: ✖ 1 problem (1 error, 0 warnings)
 Tasks: 9 successful, 11 total
Failed: @roamlog/web#lint
```

- 全仓只有这 1 条 error，**无任何 `@next/next/` 相关 error**；
- admin/api/worker/contracts 无 error（worker 仅 19 条 `no-explicit-any` warning，属既有 warning）。

---

## 6. CodeGraph 证据

- 查询：`codegraph_explore(projectPath: "C:\\Users\\BY9700\\Desktop\\UI\\roamlog", query: "TopbarMembers topbar-members avatars member.user.image")`
- 关键结果：
  - `TopbarMembers` — `apps/web/components/app-shell/topbar-members.tsx:27`（function），**blast radius：2 callers 均在 `apps/web/components/app-shell/app-shell-view.tsx`**，测试覆盖点 `apps/web/components/app-shell/app-shell.test.tsx`；
  - 动态分发链：`AppShellView → TopbarMembers`（renders `<TopbarMembers>`），`TopbarMembers → /w/:workspaceSlug/members`（next link @ line 45）；
  - 数据来源链：`listWorkspaceMembers → apps/web/lib/api/real.ts`，服务端 `presentMember` (`apps/api/src/modules/workspaces/workspace-presenter.ts:99`) 把 `user.image` 透传到 `WorkspaceMemberWithUserSchema`，证实头像 URL 是运行期租户数据 → 进一步支持"保留 `<img>`、不预配 `remotePatterns`"的判断。
- CodeGraph 状态：`codegraph status` 显示索引 `Files: 1,459 / Nodes: 22,423`，本文件改动被 watcher 增量同步（explore 返回当前磁盘源码并标注 "changed since last index sync"）。

---

## 7. 已知风险

1. **规则语义缺口（非本任务引入）**：`@next/next` 完全未注册意味着 `next/image` 强制、`no-html-link-for-pages` 等 Next 专属规则**全仓都不生效**；本项目因此对 `<img>`/`<a>` 的用法没有任何自动约束。清理注释不会让问题变多，但这些违规也无法靠 lint 兜住——建议后续以 ADR 决定是否注册 `@next/eslint-plugin-next`（需装依赖，本次明确禁止）。
2. **同类隐患复现**：其他 Agent 若继续写 `// eslint-disable-next-line <未注册规则>`，会重新引入同类 error。建议在 Code Review 检查项里加一条"禁止引用未注册规则"。
3. 剩余 `trip-form/currencies.ts:86` error 会让 `pnpm lint` 与可能的 CI gate 仍以 exit 1 结束；本任务不能也不会代修。

---

## 8. 未覆盖项（明确属于其他 Agent）

| 文件:行 | 规则 | 归属 |
| --- | --- | --- |
| `apps/web/components/trips/trip-form/currencies.ts:86` | `no-useless-assignment`（`The value assigned to 'name' is not used in subsequent statements`） | 并行 Agent（`trip-form` 禁止目录），本任务开始基线即存在 |
| `apps/web/components/trips/trip-workspace/**` | 简报提到的另外几条 error | 并行 Agent；**当前运行时该目录已 0 error**，无需我处理 |

- 未覆盖：`apps/api`、`apps/admin`、`packages/**` 的 lint 清理（不在可写范围）。当前全仓 lint 显示这些包 0 error，仅 `@typescript-eslint/no-explicit-any` warning。

---

## 9. 建议的下一步

1. 根 Agent 验收本变更（单行删除，零行为影响），并确认 `topbar-members.tsx` 的 `<img>` 用法符合产品/性能基线。
2. 把 `trip-form/currencies.ts:86` 的 `no-useless-assignment` 派回其 owner 修复，之后 `pnpm lint` 才可能整体 exit 0。
3. 立 ADR：**是否注册 `@next/eslint-plugin-next`**。若注册，则应恢复本处 `no-img-element` disable（或改为配置 `remotePatterns` 后使用 `next/image`）；若决定长期不注册，则应在 AGENTS.md 或 lint 规范中写明"Next 规则不参与 lint"，避免同类注释再次制造 error。
4. 在 CI 里加一条 guard：`grep -rn "eslint-disable.*@next/next" apps` 命中即失败（或在 PR 模板加检查项），防止复发。