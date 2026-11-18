# A11Y_TOPBAR_FIX — 顶栏成员链接 `label-content-name-mismatch` 修复报告

- 任务 ID：`A11Y_TOPBAR_FIX`
- 角色：`web_frontend`
- 结论：**DONE** —— axe `label-content-name-mismatch` 由 7 条 serious 降为 0，web-a11y 套件 14/14 全绿，未引入新 violation。
- 时间：2026-11-18（Asia/Shanghai）

## 1. 问题

`a[data-testid="topbar-members"]` 的可访问名用 `member.user.name` 拼接：

```
工作区成员 4 人：林墨、Mira Chen、林晚 等，查看成员列表
```

但链接内**可见文字**是头像首字母 `林` / `MC` / `林` / `+1`（由 `initialsFor()` 生成，且包在 `aria-hidden="true"` 里）。
axe 的 `label-content-name-mismatch`（serious，WCAG 2.5.3 Label in Name）按「可见文本 token 必须是可访问名 token 的连续子序列」判定，`林墨`/`Mira Chen` 均不含可见 token `林`/`MC`，所以每个带工作区顶栏的路由各报 1 条，合计 7 条。

实测反证（在同一页面把 aria-label 换回旧字符串后跑 axe）：

```json
{
  "id": "label-content-name-mismatch",
  "impact": "serious",
  "nodes": [
    { "target": "a[data-testid=\"topbar-members\"]",
      "summary": "Text inside the element is not included in the accessible name" }
  ]
}
```

## 2. 变更文件

| 文件 | 变更 |
| --- | --- |
| `apps/web/components/app-shell/topbar-members.tsx` | `aria-label` 改为用 `initialsFor(member.user.name)` 拼接，与可见首字母同源；`+N` 逐字写入；`aria-hidden` 保留在首字母/溢出 marker 上；链接、href、结构均未动 |
| `apps/web/components/app-shell/app-shell.test.tsx` | 更新 aria-label 断言（不再断言全名，改为断言可见首字母与 `+1` 逐字出现），并补断言首字母/`+1` span 仍为 `aria-hidden="true"` |
| `.audit/a11y-topbar-fix-report.md` | 本报告 |

实现（`topbar-members.tsx:40-52`）：

```tsx
const visible = members.slice(0, max);
const overflow = members.length - visible.length;

const visibleLabels = visible.map((member) => initialsFor(member.user.name));
const ariaLabel = `工作区成员 ${members.length} 人：${visibleLabels.join("、")}${
  overflow > 0 ? `、+${overflow}` : ""
}，查看成员列表`;
```

`aria-label={ariaLabel}`；首字母 span 与 `+N` span 仍保持 `aria-hidden="true"`（名字里已包含这些字符，装饰性重复保留）。

## 3. 最终 aria-label 与可见文本对照（`/w/roamlog-crew`，1440×1000，实际运行页面抓取）

- 最终 aria-label（实际字符串）：
  ```
  工作区成员 4 人：林、MC、林、+1，查看成员列表
  ```
- 链接可见文本（`innerText`，逐行）：
  ```
  林
  MC
  林
  +1
  ```
- 子 span（全部 `aria-hidden="true"`）：`林` / `MC` / `林` / `+1`
- 对照结论：`林`、`MC`、`林`、`+1` 四个 token 在可访问名中**逐字、同序、连续**出现，因此可见文本是名字的连续子序列 → 规则通过。
- 含溢出时（单测数据：林晓/陈默/周舟/Alex Chen）：`工作区成员 4 人：林、陈、周、+1，查看成员列表`，可见 `林`/`陈`/`周`/`+1`。
- 无溢出时（单测数据：林晓/Alex Chen）：`工作区成员 2 人：林、AC，查看成员列表`。

未采用的做法（任务已禁止）：改 axe 配置 / 加 exclude / 删测试 / 改 `sr-only` / 改按钮或删链接。均未使用。

## 4. 验证命令与结果

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | `pnpm --filter @roamlog/web typecheck` | exit 0，`✓ Types generated successfully`，0 错误 |
| 2 | `pnpm --filter @roamlog/web exec vitest run components/app-shell` | `Test Files 1 passed (1) / Tests 13 passed (13)`，exit 0 |
| 3 | `pnpm --filter @roamlog/web lint` | exit 0 |
| 4 | `E2E_WEB_URL=http://localhost:3400 E2E_SKIP_WEB_SERVER=1 E2E_SKIP_ADMIN_SERVER=1 pnpm exec playwright test --config=playwright.a11y.config.ts e2e/a11y --project=web-a11y` | `14 passed (37.6s)`，exit 0（9 条 axe 路由 + 5 条键盘用例） |

> 注意：`playwright test` 默认读 `playwright.config.ts`（projects: web/admin/api），必须显式 `--config=playwright.a11y.config.ts` 才能选中 `web-a11y`；config 只认 `E2E_WEB_URL`。

### axe violation 前 / 后对比

| 时点 | `label-content-name-mismatch`（serious） | web-a11y 套件 |
| --- | --- | --- |
| 修复前（全量 e2e 已确诊） | **7 条**，7 个带工作区顶栏的路由各 1 个节点，全部指向 `a[data-testid="topbar-members"]` | 7 failed |
| 修复后（本次实测，同一套件） | **0 条**；9 条路由均无 serious/critical violation | 14 passed |

同页面反证（`playwright` + `axe-core@4.14.1`，`runOnly: label-content-name-mismatch`）：

- 当前（修复后）aria-label：`violations.length === 0`
- 临时把 aria-label 换回旧的全名版本：`violations.length === 1`（serious，命中同一元素）
- 反证完成后已把 DOM 恢复，不改服务端状态。

### dev server（3400）隔离手法（复现要点）

- port 3000 被另一 Agent 的实例占用且持有 `apps/web/.next/dev/lock`，直接在 `apps/web` 起 3400 会报 `Another next dev server is already running`。
- 做法：把 `apps/web`（排除 `node_modules`、`.next`、`.turbo`、`*.tsbuildinfo`）复制到 `.data/a11y-runtime/web`，并对 `node_modules` 建 junction；复制后 `tsconfig.json` 的 `extends: "../../tsconfig.base.json"` 因目录多一层而解析失败（`An issue occurred while parsing a tsconfig.json file` → 500），按 `e2e/live-support/prepare-next-runtime.ts` 的做法把 base `compilerOptions` 内联合并、去掉 `extends`，重启后首页 200。
- 启动：`cd .data/a11y-runtime/web && node node_modules/next/dist/bin/next dev -p 3400`（`dev` 脚本写死 `--port 3000`，不能用 `dev -- -p 3400`）。
- 必须用 `http://localhost:3400`；`127.0.0.1` 被 Next 16 dev-origin 拦截。
- 运行完已删除 `.data/a11y-runtime`，未遗留产物。

## 5. CodeGraph 证据

- `codegraph status`（`C:\Users\BY9700\Desktop\UI\roamlog`）：无 stale 提示，索引可用；1,481 files / 22,686 nodes / 49,854 edges（改文件后 watcher 增量同步到 22,703 nodes）。
- `codegraph_explore "TopbarMembers topbar-members aria-label initialsFor"`：
  - 命中 `apps/web/components/app-shell/topbar-members.tsx`（`TopbarMembers`）、`topbar-utils.ts`（`initialsFor`/`roleLabelFor`），动态链路 `AppShellView → TopbarMembers → /w/:workspaceSlug/members`。
  - blast radius：`initialsFor` 3 个 caller 全在本文件；`TopbarMembers` 仅 2 个 caller（`app-shell-view.tsx`），测试入口 `app-shell.test.tsx`；`packages/ui` 的 `Topbar` 是另一路径，不受影响。

## 6. 已知风险

- 成员头像存在 `member.user.image` 时，该 span 的可见文字为空（`<img alt="">`），aria-label 仍会列出该成员的首字母（多出的描述性文字不影响 axe，只要求可见文本被名字包含）。未改变图片分支。
- 可访问名不再包含成员全名，屏幕阅读器只听到首字母 + 人数。这是为通过 2.5.3 的必然取舍（可见文本即首字母）；若产品希望保留全名，需要同时把全名作为可见文本或改用 `aria-describedby` 补充，属于另一个任务。
- 断言更新在 `app-shell.test.tsx`（任务允许），未触碰 `e2e/a11y/**` 或 axe 配置。

## 7. 未覆盖项

- 只跑了 `--project=web-a11y`；`admin-a11y` / visual 项目未在本任务范围内重跑。
- 未在移动端（390px）单独做 axe 扫描：该链接在顶栏，移动端顶栏结构不同（此链接是否渲染未验证）。
- 未跑全量 `e2e`；本次结论只覆盖 a11y 套件与 typecheck/lint/单测。

## 8. 建议的下一步

1. 由 QA 跑一次全量 `pnpm e2e`（或 `playwright test --config=playwright.a11y.config.ts` 全 projects）确认 CI a11y gate 恢复，并确认 admin 侧不再复用同类「可见文字 vs aria-label」写法。
2. 如产品要求屏幕阅读器保留成员全名，另立任务：将全名放入可见（或 `aria-describedby` 指向的名字）并同步 axe 规则验证。