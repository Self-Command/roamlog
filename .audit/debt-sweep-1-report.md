# DEBT_SWEEP_1 — 三处技术债修补报告

状态：**DONE**
任务 ID：`DEBT_SWEEP_1`
执行者：Roamlog 全栈修补手（子 Agent）
日期：2026-11-19
工作区：`C:\Users\BY9700\Desktop\UI\roamlog`（Windows Git Bash）

---

## 变更文件

| 文件 | 变更 |
| --- | --- |
| `packages/contracts/src/permissions.ts` | 删除幽灵项 `admin:workspaces:transfer`（仅 1 行） |
| `packages/contracts/src/__tests__/permissions.test.ts` | 新增两条一致性断言 |
| `apps/web/lib/api/media.ts` | `COVER_MAX_BYTES` 改为 `25_000_000` + 同步注释 |
| `apps/web/components/media/cover-upload-validation.ts` | `formatBytes` 改为十进制 |
| `apps/web/components/media/cover-upload-validation.test.tsx` | 十进制断言 + 25 MB 防回归 |
| `apps/web/components/media/cover-uploader.tsx` | 删除重复 `formatMegabytes`，复用共享 `formatBytes` |
| `apps/web/components/media/cover-uploader.test.tsx` | 空状态文案断言 `25 MB`，禁止 `23.8` |
| `apps/web/components/trip-workspace/format.ts` | `providerLabel` 补 `geoapify` + 未知值兜底 |
| `apps/web/components/trip-workspace/format.test.tsx` | 新建 providerLabel 测试 |
| `apps/web/components/trip-workspace/__tests__/tabs.test.tsx` | 消费者断言更新为 `Photon 搜索` |
| `.audit/debt-sweep-1-report.md` | 本报告 |

未修改：`apps/api/**`、`apps/admin/**`、`packages/db/**`、`apps/web/components/media/live-photo.tsx`、其它 contracts 源文件、其它 web 组件。

---

## 任务 1：幽灵权限项一致性测试

### 1.1 先红（新增断言后、修数据前）

命令：`pnpm --filter @roamlog/contracts test`

```text
 ❯ src/__tests__/permissions.test.ts (12 tests | 1 failed) 26ms
   ...
   ❯ platform permission matrix (6)
     ✓ separates read-only operators from administrators 1ms
     ✓ fails closed for unknown platform actions 0ms
     ✓ reserves queue lifecycle management for super admins 1ms
     ✓ reserves platform settings read and write for super admins 1ms
     × every non-grantable action is a real action 8ms
     ✓ every role action is a real action 4ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/__tests__/permissions.test.ts > platform permission matrix > every non-grantable action is a real action
AssertionError: expected [ 'admin:metrics:read', …(31) ] to include 'admin:workspaces:transfer'
 ❯ src/__tests__/permissions.test.ts:101:29
     99|   it("every non-grantable action is a real action", () => {
    100|     for (const action of NON_GRANTABLE_ADMIN_ACTIONS) {
    101|       expect(ADMIN_ACTIONS).toContain(action);
       |                             ^
    102|     }
    103|   });

 Test Files  1 failed | 12 passed (13)
      Tests  1 failed | 115 passed (116)
```

失败点精确指向幽灵项：`ADMIN_ACTIONS` 共 32 项，不包含 `admin:workspaces:transfer`。同时 `every role action is a real action` 先绿，说明角色矩阵本身没有漂移，问题只在“不可授予”列表。

### 1.2 判断与证据

判断命令：

```text
rg -n "workspaces:transfer|workspace.*transfer" apps/api apps/admin packages/contracts
```

关键命中：

```text
packages/contracts/src/permissions.ts:547:  "admin:workspaces:transfer",   ← 全仓库唯一一处
apps/api/src/modules/admin/admin-workspaces.service.ts:190:  updated = await this.transferOwnership(actor, record, body.ownerId, data);
apps/api/src/modules/admin/admin-workspaces.service.ts:314:  action: "admin.workspace.ownership_transferred",
apps/api/src/modules/admin/admin-workspaces.controller.ts:72-73:  @Patch(":id") @RequireAdminAction("admin:workspaces:read")
apps/api/src/modules/admin/admin-workspaces.service.ts:214-219:
  if (body.plan !== undefined || body.ownerId !== undefined) {
    // Contracts expose no dedicated plan/ownership action for platform admins.
    // These operations are therefore gated by the operator-level Workspace action.
    assertAdminAction(actor, "admin:workspaces:delete");
  }
apps/admin/components/workspaces/workspaces-view.tsx:174-179:  "transfer-owner" → action: "admin.workspace.transfer-owner"
apps/admin/components/workspaces/workspaces-view.tsx:224-225:  const canDelete = canPlatform(role, "admin:workspaces:delete");
  const canManageContract = canDelete;
apps/admin/components/workspaces/workspaces-view.tsx:1157:  "仅 admin 及以上可转移所有权（后端动作 admin:workspaces:delete）"
```

结论：

- **能力存在**：后台确实有转移 Workspace 所有权的能力（`PATCH /admin/workspaces/:id` 带 `ownerId` → `transferOwnership` 事务调整双方角色 + 审计 `admin.workspace.ownership_transferred`；Admin UI 有“转移所有权”对话框）。
- **专用权限动作不存在**：`admin:workspaces:transfer` 在代码中没有任何 API、服务、UI 消费者；当前实际由 `admin:workspaces:delete` 兜底，服务层注释明确写了 “Contracts expose no dedicated plan/ownership action”。
- 因此按裁决选 **A：从 `NON_GRANTABLE_ADMIN_ACTIONS` 删除幽灵项**。若选 B（加进 `ADMIN_ACTIONS`）而不重接线，会造出一个“矩阵可授予、后端不检查”的动作——正是本轮在清理的假开关，且会让后台误以为能授予转移权限，而实际仍受 delete 控制。

修改（精确 1 行）：

```diff
@@ -544,7 +544,6 @@ export const NON_GRANTABLE_ADMIN_ACTIONS: readonly string[] = [
   "admin:users:reset-2fa",
   "admin:users:update",
   "admin:settings:write",
-  "admin:workspaces:transfer",
   "admin:permissions:read",
   "admin:permissions:write",
 ];
```

`ADMIN_ACTION_DESCRIPTIONS` 与角色矩阵**未改**；`git diff packages/contracts/src/permissions.ts` 只有上面这一行删除。

### 1.3 后绿

```text
$ pnpm --filter @roamlog/contracts test

 ✓ src/__tests__/permissions.test.ts (12 tests) 21ms
 ✓ src/__tests__/ai.test.ts (7 tests) 29ms
 ...
 Test Files  13 passed (13)
      Tests  116 passed (116)
```

新增断言：

- `every non-grantable action is a real action`：遍历 `NON_GRANTABLE_ADMIN_ACTIONS`，每项必须在 `ADMIN_ACTIONS` 中；
- `every role action is a real action`：遍历 `PLATFORM_ROLE_ACTIONS` 的每个角色及其动作，每项必须在 `ADMIN_ACTIONS` 中（错误信息带角色名）。

### 1.4 更深的问题（不在本轮修复）

> **转移工作区所有权目前由 `admin:workspaces:delete` 权限控制**，而不是独立动作。
>
> - API 控制器：`apps/api/src/modules/admin/admin-workspaces.controller.ts:72-79`，`PATCH /admin/workspaces/:id` 入口只要求 `admin:workspaces:read`。
> - 服务层：`apps/api/src/modules/admin/admin-workspaces.service.ts:190` 调用 `transferOwnership`；真正的权限检查在 `:214-219` 的 `assertWorkspaceMutation`，`ownerId` 与 `plan` 都被 `admin:workspaces:delete` 兜底。
> - Admin UI：`apps/admin/components/workspaces/workspaces-view.tsx:224-225` 把 `canManageContract` 直接等于 `canDelete`；`:1157` 的禁用提示也写“后端动作 admin:workspaces:delete”。
>
> 语义错配的结果：任何能删除 Workspace 的角色都能转移所有权；反过来，想单独授予“转移”而不授予“删除”在当前模型下不可能。正确设计是独立 `admin:workspaces:transfer` 动作并重接线 API/UI。`plan` 变更存在同类错配（也被 delete 兜底）。
>
> 该修复会动 `apps/api/**` 与 `apps/admin/**`，超出本任务边界，未做。

**可直接派单的后续任务描述：**

```text
任务 ID: DEBT_SWEEP_2（建议）
目标: 为 Workspace 所有权转移建立独立权限动作并重接线，消除“删除权限兜底转移”的语义错配。

可写文件:
- packages/contracts/src/permissions.ts
- packages/contracts/src/__tests__/permissions.test.ts
- apps/api/src/modules/admin/admin-workspaces.controller.ts
- apps/api/src/modules/admin/admin-workspaces.service.ts
- apps/api/src/modules/admin/__tests__/admin-workspaces.service.spec.ts
- apps/admin/components/workspaces/workspaces-view.tsx
- apps/admin/components/workspaces/workspaces-view.test.tsx

必须实现:
1. ADMIN_ACTIONS 增加 "admin:workspaces:transfer"；ADMIN_ACTION_DESCRIPTIONS 增加“转移工作区所有权”；
   明确角色矩阵（建议 admin 及以上；NON_GRANTABLE 是否保留该动作需产品确认）。
2. admin-workspaces.service.ts:214-219 拆分检查：status/plan/ownerId 各用各自动作，ownerId →
   "admin:workspaces:transfer"；controller PATCH 入口同步调整。
3. workspaces-view.tsx:224-225 拆分 canTransfer / canChangePlan，更新 :170、:1146、:1157 文案。
4. 同步 apps/api 与 apps/admin 现有测试（admin-workspaces.service.spec.ts:147、workspaces-view.test.tsx:238）。

验收:
- 仅持有 admin:workspaces:transfer 的角色可转移；仅持有 delete 的角色不可转移；
- 权限矩阵正确显示新动作；contracts 一致性测试保持绿；
- 迁移/现有数据无影响。
```

---

## 任务 2：统一 25MB 语义（十进制）

### 2.1 前（问题）

- `apps/web/lib/api/media.ts`：`COVER_MAX_BYTES = 25 * 1024 * 1024` = **26,214,400**（25 MiB）。
- `apps/web/components/media/cover-upload-validation.ts` 的 `formatBytes` 用 `/ (1024 * 1024)`，错误文案为“超过 **23.8 MB** 上限”。
- `apps/web/components/media/cover-uploader.tsx` 还有一份重复的 `formatMegabytes`（同样 `/1024/1024`），空状态渲染“最大 **23.8 MB**”。
- 后台设置默认值是 `media.maxUploadBytes = 25_000_000`（十进制）；上传流程实际把 `mediaPolicy.maxUploadBytes` 传给校验（`use-cover-upload.ts:451`），所以用户看到的是同一个 25,000,000 被显示成 23.8 MB。

计算：`25_000_000 / 1_048_576 = 23.84… → 23.8 MB`；`25_000_000 / 1_000_000 = 25 MB`。

### 2.2 后（修复）

- `COVER_MAX_BYTES = 25_000_000`，并在常量旁写明：

```ts
/**
 * ...
 * 与后台设置 `media.maxUploadBytes` 的默认值一致（十进制 25,000,000 字节），
 * 改一处必须改另一处；后台设置会覆盖这个兜底值。
 */
export const COVER_MAX_BYTES = 25_000_000;
```

- `formatBytes` 改为十进制：`bytes / 1_000_000`（MB）、`bytes / 1_000`（KB），成为封面流程唯一格式化实现。
- `cover-uploader.tsx` 删除本地重复的 `formatMegabytes`，改为 `import { formatBytes } from "./cover-upload-validation"`；渲染变为：

```text
JPEG · PNG · WebP · AVIF · HEIC / 最大 25 MB
```

- 校验错误文案由 `formatBytes(maxBytes)` 生成，变为“图片…超过 **25 MB** 上限”。
- 行为不变：`effectiveMaxBytes = maxBytes ?? mediaPolicy.maxUploadBytes` 来源未动，超限判断仍是 `file.size > maxBytes`，仅文案数字变化。

文案前后对比：

| 位置 | 前 | 后 |
| --- | --- | --- |
| Uploader 空状态（`cover-uploader.tsx:363`） | `最大 23.8 MB` | `最大 25 MB` |
| 客户端校验错误（`cover-upload-validation.ts:88`、`:110`） | `超过 23.8 MB 上限` | `超过 25 MB 上限` |
| 服务端口径（`cover-upload-error.ts:216/:288`、`trip-form.tsx:614`） | `25 MB`（硬编码） | `25 MB`（未变，现与客户端一致） |

新增/更新测试（`cover-upload-validation.test.tsx`）：

```text
✓ formats byte sizes in decimal units for the validation message
✓ renders the limit as decimal 25 MB, never the binary 23.8 MB
✓ accepts exactly 25 MB and rejects one byte more
```

`cover-uploader.test.tsx` 空状态断言：

```ts
expect(screen.getByText(/最大 25 MB/)).toBeInTheDocument();
expect(screen.queryByText(/23\.8/)).not.toBeInTheDocument();
```

针对性运行：

```text
$ pnpm --filter @roamlog/web exec vitest run components/media/cover-upload-validation.test.tsx components/media/cover-uploader.test.tsx --reporter=verbose
...
 ✓ components/media/cover-upload-validation.test.tsx > validateCoverFile > renders the limit as decimal 25 MB, never the binary 23.8 MB
 ✓ components/media/cover-uploader.test.tsx > CoverUploader > renders a truthful empty state with the real server limits
 Test Files  2 passed (2)
      Tests  23 passed (23)
```

### 2.3 重复字节格式化清单（只列不改）

按指定命令：

```text
rg -n "1024 \* 1024|/ 1024 / 1024|formatMegabytes|formatBytes" apps/web apps/admin --glob '!**/*.test.*'
```

| 位置 | 现状 | 处理 |
| --- | --- | --- |
| `apps/web/components/media/cover-upload-validation.ts:57` | 已改十进制，封面唯一实现 | ✅ 本轮修复 |
| `apps/web/components/media/cover-uploader.tsx` | 已删除重复实现，复用上面的 `formatBytes` | ✅ 本轮修复 |
| `apps/web/lib/image/compress-image.ts:137-140` | 本地 `formatMegabytes`，二进制 | 未改（压缩目标文案，非上传上限） |
| `apps/web/lib/image/live-photo-motion.ts:33-36` | 本地 `formatMegabytes`，二进制，50 MiB 上限 | 未改（`live-photo.tsx` 有别的 Agent 在改） |
| `apps/admin/lib/format.ts:31-44` | `formatBytes`，1024 进制，用于媒体/工作区/仪表盘 | 未改（admin 不在授权范围；另一 Agent 可能在动） |
| `.audit/local-verify/bench-compression.mjs:68` | 基准脚本里的副本 | 未改（非产品代码） |

CodeGraph 还确认 `formatBytes` 有 5 个调用方（含 uploader 与 `media/index.ts` 再导出），`COVER_MAX_BYTES` 有 2 个调用方，均在本轮覆盖范围内。

---

## 任务 3：`providerLabel` 补 `geoapify`

### 3.1 前

```ts
export function providerLabel(provider: PlaceProvider | null): string {
  switch (provider) {
    case "photon":
      return "Photon";
    case "local":
      return "本地地点库";
    default:
      return "手动录入";   // geoapify 落到这里 → 错标为“手动录入”
  }
}
```

### 3.2 后

```ts
export function providerLabel(provider: PlaceProvider | null): string {
  switch (provider) {
    case "geoapify":
      return "Geoapify 搜索";
    case "photon":
      return "Photon 搜索";
    case "local":
      return "本地地点库";
    case null:
      return "手动录入";
    default:
      return "未知来源";
  }
}
```

前后对比：

| provider | 前 | 后 |
| --- | --- | --- |
| `geoapify` | 手动录入 ❌ | **Geoapify 搜索** ✅ |
| `photon` | Photon | **Photon 搜索** |
| `local` | 本地地点库 | 本地地点库（不变） |
| `null` | 手动录入 | 手动录入（不变，手动入口） |
| 未知值（如 `mapbox`） | 手动录入（误导） | **未知来源**（不泄露原始枚举） |

措辞依据 `apps/web/lib/places-attribution.ts`：`geoapify` 的署名是 `Powered by Geoapify`（:32-36），`photon` 是 `Search by Photon`（:38-42），`local` 是 `手动录入`（:44-46）。因此自动来源统一用“`Geoapify 搜索` / `Photon 搜索`”，本地库保留“本地地点库”，无来源保留“手动录入”。

测试：新建 `apps/web/components/trip-workspace/format.test.tsx`（4 条断言），并把 `tabs.test.tsx` 的消费者断言从 `Photon` 更新为 `Photon 搜索`。

```text
$ pnpm --filter @roamlog/web exec vitest run components/trip-workspace/format.test.tsx --reporter=verbose
 ✓ providerLabel > labels every known place provider by its source
 ✓ providerLabel > never shows an automated Geoapify result as manual entry
 ✓ providerLabel > keeps a provider-less stop as manual entry
 ✓ providerLabel > falls back to neutral copy for an unknown provider instead of the raw enum
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

---

## 验证命令与结果

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | `pnpm --filter @roamlog/contracts test` | ✅ `13 passed (13)` / `116 passed (116)` |
| 2 | `pnpm --filter @roamlog/web typecheck` | ✅ exit 0，`tsc --noEmit` 无输出 |
| 3 | `pnpm --filter @roamlog/web exec vitest run components/trip-workspace lib/api` | ✅ `8 passed (8)` / `64 passed (64)` |
| 3b | 追加 `components/media/cover-upload-validation.test.tsx components/media/cover-uploader.test.tsx` | ✅ `10 passed (10)` / `87 passed (87)` |
| 4 | `pnpm --filter @roamlog/web lint` | ✅ exit 0；未出现 `live-photo.tsx` 的 `@next/next` 幽灵规则（该文件本轮未触碰，运行结果已干净） |
| 5 | `pnpm --filter @roamlog/contracts typecheck` | ✅ exit 0 |
| 6 | `pnpm --filter @roamlog/contracts lint` | ✅ exit 0 |

原始输出摘要：

```text
# 1
 Test Files  13 passed (13)
      Tests  116 passed (116)

# 2
$ next typegen && tsc --noEmit
Generating route types...
✓ Types generated successfully

# 3
 Test Files  8 passed (8)
      Tests  64 passed (64)

# 3b
 Test Files  10 passed (10)
      Tests  87 passed (87)

# 4
$ eslint -c ../../eslint.config.mjs .
[exit code: 0]
```

---

## CodeGraph 证据

- `codegraph status`：
  - 起始：`Files: 1,764 / Nodes: 27,677 / Edges: 63,293`，`[OK] Index is up to date`；
  - 收尾（改动后 watcher 增量同步）：仍为 `[OK] Index is up to date`。
- `codegraph_explore "NON_GRANTABLE_ADMIN_ACTIONS ADMIN_ACTIONS PLATFORM_ROLE_ACTIONS"`：
  - 命中 `packages/contracts/src/permissions.ts:388`（`ADMIN_ACTIONS`）、`:489`（`PLATFORM_ROLE_ACTIONS`）、`:541`（`NON_GRANTABLE_ADMIN_ACTIONS`）；
  - blast radius：`ADMIN_ACTIONS` 12 个调用方（`admin-permissions.service.ts`、`admin-authz.service.ts`、`api/admin.ts` 等），`PLATFORM_ROLE_ACTIONS` 7 个调用方；`NON_GRANTABLE_ADMIN_ACTIONS` **只有 permissions.ts 内 1 个调用方，3 跳内无测试**——与 rg 结论互相印证：幽灵项没有真实消费者。
- `codegraph_explore "providerLabel formatBytes COVER_MAX_BYTES validateCoverFile CoverUploader"`：
  - `formatBytes`（`cover-upload-validation.ts:57`）5 个调用方，含 `cover-uploader.tsx`；
  - `COVER_MAX_BYTES`（`apps/web/lib/api/media.ts:36`）2 个调用方（校验与测试）；
  - `CoverUploader` 由 `trip-form.tsx`、`workspace-header.tsx` 动态渲染（影响面已由组件测试覆盖）；
  - 同时发现 `apps/admin/lib/format.ts:31` 是独立的二进制 `formatBytes`，用于 media/workspaces/dashboard——列入清单，未越界修改。

---

## 已知风险

1. **后台设置上限与契约硬上限**：`media.maxUploadBytes` 注册表允许到 100,000,000，但 `MediaPresignRequestSchema` 与 API `MAX_MEDIA_BYTES` 硬上限仍是 25 MiB（26,214,400）。本轮只把客户端兜底默认值对齐为 25,000,000（更严格），没有改服务端/契约上限；把设置调到 25 MiB 以上仍会被服务端拒绝。这是既有问题，未扩大。
2. **十进制格式的显示变化**：`formatBytes` 现在所有单位都是十进制；1,024 B 仍显示 `1 KB`，但 1,572,864 B 从 `1.5 MB` 变为 `1.6 MB`。`formatBytes` 经 `components/media/index.ts` 再导出，rg 未发现封面流程之外的调用方。
3. **Photon 标签文案变化**：从 `Photon` 变为 `Photon 搜索`，已更新 `tabs.test.tsx`；若存在未运行的视觉快照，需要同步。
4. **转移权限语义错配仍在**：本轮只删除幽灵项，没有新建独立 `admin:workspaces:transfer`，因此“delete 权限可转移所有权”的现状保留，后续任务见 1.4。
5. **其它字节格式化仍是二进制**：admin、图片压缩、Live Photo 的副本未统一；本轮只保证封面上传链路（界面文案、校验文案、测试）一致。

## 未覆盖项

- 未跑 E2E / 浏览器视觉回归；封面文案与 provider 标签仅由组件/单元测试覆盖。
- 未跑 `apps/api`、`apps/admin` 的测试；本轮未改这些代码。删除 `NON_GRANTABLE` 幽灵项**不改变** `ADMIN_ACTIONS`，也不改变 `ADMIN_GRANTABLE_ACTIONS`（后者从 `ADMIN_ACTIONS` 过滤），因此权限矩阵响应无运行时变化。
- 未改 `live-photo.tsx`（其他 Agent 在途）及 media 目录其它文件。
- 未统一 `apps/admin/lib/format.ts`、`apps/web/lib/image/*` 的重复格式化器。

## 建议下一步

1. 按 1.4 的任务描述派单 **DEBT_SWEEP_2**：独立 `admin:workspaces:transfer` 并重接线 API/UI，同时决定 `plan` 变更是否也拆独立动作。
2. 统一字节格式化：把 admin 的 `formatBytes` 与 web 图片/Live Photo 的 `formatMegabytes` 收敛到一个共享实现（或至少明确“上传上限用十进制、存储统计用二进制”的规则），避免下一次“改一处漏一处”。
3. 为 `NON_GRANTABLE_ADMIN_ACTIONS` 加类型约束（`readonly AdminAction[]`），让编译器而不是测试来阻止下一个幽灵项；这属于 contracts 的后续小改动。