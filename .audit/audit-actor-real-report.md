# 审计页 Actor 筛选：消除 api 模式 fixture 泄漏（审计 P1-07）

- 任务 ID: `AUDIT_ACTOR_REAL`
- 角色: `admin_frontend`
- 日期: 2026-11-19
- 状态: **DONE**
- 依据: CodeGraph v1.6.3（`codegraph status` → `[OK] Index is up to date`）+ 逐文件读取 + 组件测试（8/8）+ typecheck / lint 实跑

## 1. 变更文件

| 文件 | 改动 |
| --- | --- |
| `apps/admin/components/audit/audit-view.tsx` | 新增 `actorOptions`（api 模式从已加载条目推导 / fixture 模式保留 `MOCK_ADMIN_USERS`）；Actor 下拉改为渲染 `actorOptions`；`actorName()` 分支顺序调整为「fixture 分支显式门控 `MOCK_ADMIN_USERS`」 |
| `apps/admin/components/audit/audit-view.test.tsx` | 新增 4 个测试：api 两条目推导、api 空条目、fixture 保留、选中值保持 |

未修改：`apps/admin/lib/**`（`fixtures.ts` 原样）、其它 admin 组件、`apps/web/**`、`apps/api/**`、`packages/**`、`e2e/**`、playwright/compose/lockfile、其它 `.audit`。
`git status --short` 只有上述两个 `M` 文件；`git diff --stat` = 2 files changed, 173 insertions(+), 8 deletions(-)。

## 2. 实现摘要

### 2.1 api 选项从哪推导

`apps/admin/components/audit/audit-view.tsx:103-139` 新增 `actorOptions` useMemo：

- 输入是当前已加载的审计条目 `sourceEntries`（即页面传入的 `entries`，api 模式下为 Admin API 当前页结果），**没有新增任何网络请求**。
- 遍历 `sourceEntries`：跳过 `actorType === "system"` 与 `actorId` 为空（`null`）的条目；其余按 `actorId` 用 `Map` 去重。
- 选项文案直接复用既有 `actorName(actorId, actorType, mode)`，api 模式下即 `actor <id8>`，与时间线行 `:403` 显示完全一致。
- 排序：`label.localeCompare(..., "zh-CN")`，文案相同时用 `value.localeCompare(...)` 做确定性 tie-break（稳定）。
- 若当前页推导不出任何 actor（空列表 / 全 system / actorId 全空），数组为空，下拉只剩 JSX 里的 `全部操作者`（value `all`）与 `System worker`（value `system`）。

### 2.2 选中值兜底（避免空显示）

`audit-view.tsx:125-133`：当 `actorFilter` 不是 `all`/`system`，且不在当前推导结果里（例如翻页后该 actor 不在本页），把当前选中值追加为一个选项，文案仍由 `actorName(actorFilter, "admin", mode)` 生成（api 模式 → `actor <id8>`）。追加后统一排序，因此顺序仍按文案。这样 `value={actorFilter}` 始终能在 `<select>` 里找到对应 option，不会出现空白选中。

### 2.3 fixture 分支如何保留

`audit-view.tsx:104-106`：`if (mode === "fixture") return MOCK_ADMIN_USERS.map((user) => ({ value: user.id, label: user.name }));`
——原顺序、原 id、原姓名，行为与改动前一致（不加排序，避免改变演示顺序）。

### 2.4 `actorName()` 分支顺序（行为不变，仅让门控可静态校验）

改动前：

```tsx
if (mode === "api") { return actorId ? `actor ${actorId.slice(-8)}` : "未知操作者"; }
return MOCK_ADMIN_USERS.find(...)?.name ?? "未知管理员";
```

改动后（`:47-50`）：

```tsx
if (mode === "fixture") { return MOCK_ADMIN_USERS.find((user) => user.id === actorId)?.name ?? "未知管理员"; }
return actorId ? `actor ${actorId.slice(-8)}` : "未知操作者";
```

api 分支返回值完全相同（`actor <id8>` / `未知操作者`），fixture 分支返回值完全相同（姓名 / `未知管理员`）。改为正向 `mode === "fixture"` 后，`MOCK_ADMIN_USERS` 的每一处使用都**字面处于** fixture 分支内，满足本任务要求 5 的静态判据。

### 2.5 下拉 JSX

`audit-view.tsx:304-310`：

```tsx
<option value="all">全部操作者</option>
<option value="system">System worker</option>
{actorOptions.map((option) => (
  <option key={option.value} value={option.value}>{option.label}</option>
))}
```

未删除筛选能力、未新增字段、未改动 `filteredEntries` 的匹配逻辑（`actorFilter === "system"` 仍匹配 `actorType === "system"`，否则匹配 `entry.actorId`）。

## 3. 静态证据：`MOCK_ADMIN_USERS` 仅存在于 fixture 分支

命令：`grep -n "MOCK_ADMIN_USERS" apps/admin/components/audit/audit-view.tsx`

```text
13:import { MOCK_ADMIN_USERS, type AdminConsoleRole } from "../../lib/fixtures";
48:    return MOCK_ADMIN_USERS.find((user) => user.id === actorId)?.name ?? "未知管理员";
105:      return MOCK_ADMIN_USERS.map((user) => ({ value: user.id, label: user.name }));
```

命中 1（`:39-50`）——在 `actorName()` 内，`mode === "fixture"` 分支：

```tsx
function actorName(
  actorId: string | null,
  actorType: AuditLog["actorType"],
  mode: AdminDataMode,
): string {
  if (actorType === "system") {
    return "System worker";
  }
  if (mode === "fixture") {
    return MOCK_ADMIN_USERS.find((user) => user.id === actorId)?.name ?? "未知管理员";
  }
  return actorId ? `actor ${actorId.slice(-8)}` : "未知操作者";
}
```

命中 2（`:103-106`）——在 `actorOptions` 内，`mode === "fixture"` 分支：

```tsx
  const actorOptions = useMemo<readonly AuditActorOption[]>(() => {
    if (mode === "fixture") {
      return MOCK_ADMIN_USERS.map((user) => ({ value: user.id, label: user.name }));
    }
```

命中 0 是 import 语句（`:13`），非渲染路径。结论：**不存在第二处泄漏**；api 模式渲染路径上没有任何 fixture 姓名进入 DOM。

## 4. 验证命令与结果

### 4.1 TypeScript

```text
$ pnpm --filter @roamlog/admin typecheck
$ tsc --noEmit
TYPECHECK_EXIT=0
```

0 错误（改代码前、改测试后各跑一次，均 0 错误）。

### 4.2 组件测试

```text
$ pnpm --filter @roamlog/admin exec vitest run components/audit

 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/admin

 ✓ components/audit/audit-view.test.tsx (8 tests) 297ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Duration  2.37s (import 29%, transform 26%, environment 23%, tests 14%, setup 8%)
```

回归（全量 admin 套件，额外自检）：

```text
$ pnpm --filter @roamlog/admin test
 Test Files  16 passed (16)
      Tests  86 passed (86)
   Duration  7.97s
ADMIN_SUITE_EXIT=0
```

新增 4 个测试（`audit-view.test.tsx`）：

| 测试 | 行 | 断言要点 |
| --- | --- | --- |
| derives the actor filter from loaded API audit entries, not fixture users | `:133` | `mode="api"` + 4 条目（2 个不同 actorId，1 个重复 actorId，1 个 system/null）→ 选项文案严格等于 `全部操作者` / `System worker` / `actor 000000aa` / `actor 000000bb`；value 等于 `all`/`system`/两个 UUID；`queryByText("林知夏")` 与 `queryByText("陈墨")` 均为 null |
| offers only the generic actor options when API mode has no loaded entries | `:147` | `mode="api"` + `entries={[]}` → 只有 `全部操作者` + `System worker`；fixture 姓名 null |
| keeps fixture admin users in the actor filter in fixture mode | `:155` | fixture 模式 → 选项严格等于 `全部操作者` + `System worker` + `MOCK_ADMIN_USERS` 全部姓名（含 `林知夏`） |
| keeps a selected API actor filter visible after the loaded page changes | `:167` | 选中 `ACTOR_ALPHA` 后 rerender 为空条目 → 选项仍含该 value、`select.value` 保持、文案 `actor 000000aa` |

### 4.3 Lint

```text
$ pnpm --filter @roamlog/admin lint
$ eslint .
LINT_EXIT=0
```

exit 0，无警告输出。

### 4.4 Git 边界

```text
$ git status --short
 M apps/admin/components/audit/audit-view.test.tsx
 M apps/admin/components/audit/audit-view.tsx
?? .audit/audit-actor-real-report.md
```

仅两个被允许的产品文件被修改；`.audit/audit-actor-real-report.md` 为本任务唯一新增的本报告。

## 5. CodeGraph 证据

1. `codegraph status`（repo root）→ `Files: 1,485 / Nodes: 22,729 / Edges: 50,137`，`[OK] Index is up to date`；改完后复跑仍为 `[OK] Index is up to date`（watcher 已增量同步）。
2. `codegraph_explore`（MCP，`projectPath: C:\Users\BY9700\Desktop\UI\roamlog`，query = `AuditView actorName MOCK_ADMIN_USERS actorFilter 审计页操作者下拉`）关键结果：
   - blast radius：`actorName`（`audit-view.tsx:34`，当前 `:39`）**仅 1 个 caller，且在同一文件**；`AuditView` 的 3 个 caller 全部在 `apps/admin/app/admin/audit/page.tsx`；`AuditViewProps` 仅同文件使用 → 改动影响面被限制在本组件。
   - `MOCK_ADMIN_USERS`（`apps/admin/lib/fixtures.ts:86`）→ 7 callers，分布在 `audit-view.tsx`、`admin-data-source.ts`、`fixtures.ts`；关系 `actorName -> MOCK_ADMIN_USERS`、`AuditView -> MOCK_ADMIN_USERS` 即本次唯一需要切断的两条渲染路径（现已各自落在 fixture 分支）。
   - 调用链 `AuditView -> actorName`、`AuditView -> Select` 与动态渲染关系确认 Actor 下拉就在 `AuditView` 内渲染，无需改动父页面。
   - 测试定位：`apps/admin/components/audit/audit-view.test.tsx`。
3. explorer 提示 `actorFilter` 未被索引——它是组件内 `useState` 局部变量（非模块级符号），属预期；其取用点由本次读取确认（`:85` 声明、`:126-132` 兜底、`:155-156` 过滤、`:196-199` 导出参数、`:301` 绑定）。

## 6. 已知风险

1. **只覆盖当前页**：选项来自页面已加载的 `entries`（上游固定 `limit: 100`，页面无分页），所以当前页之外的操作者不可被选择。这是「不新增网络请求」约束的直接结果；已用「保留已选值」兜底避免空显示。真正的跨页操作者筛选需要后端聚合接口（见 §8）。
2. **同 id8 前缀冲突**：文案取 `actorId.slice(-8)`，两个 UUID 后 8 位相同就会显示同一文案；选项按 `value` 去重，仍可分别选择，且 tie-break 用 `value` 排序，顺序稳定，但用户可能难以区分（与表格显示一致，属既有展示口径，未扩大范围）。
3. **api 模式传入 fixture 条目时**（仅测试场景）会显示 `actor <fixture id8>`，不会出现 fixture 姓名；生产路径 entries 来自 Admin API，无此问题。
4. **`actorName` 分支重排**：纯等价重写，api/fixture 两条路径返回值逐一对应；由既有测试（时间线渲染、api 导出）与新增 4 个测试共同覆盖。
5. 未改动 `targetTypeOptions`（同样从 `sourceEntries` 推导），也不属于 P1-07。

## 7. 未覆盖项

- 未启动 Admin/API 服务（任务明确禁止起服务），因此 api 模式的真实 API 响应未做真机验证；验证方式是向组件注入与契约 `AuditLog` 同形的条目。
- 未做浏览器视觉检查（同样因为不允许起服务）；下拉是原生 `<select>`，结构未变，仅选项来源变化。
- 未覆盖跨页/跨筛选的操作者枚举（需要后端支持）。

## 8. 建议的下一步

1. 后端提供只读聚合端点（例如 `GET /v1/admin/audit/actors?` 带当前筛选参数，返回 `{ id, label }` 列表），前端把 `actorOptions` 的 api 分支换成该资源；在资源未接入前，本实现保证零泄漏、零额外请求。
2. 审计页补分页/游标（P1-07 报告同时提到「页面没有分页，固定 limit 100」）；分页落地后，选项推导需按「全部已选筛选条件」调用上述聚合端点，而不是单页推导。
3. 按同一判据抽查其它 admin 页面是否仍把 fixture 常量渲染进 api 模式（本次只修 P1-07 指定位置，未顺手改）。