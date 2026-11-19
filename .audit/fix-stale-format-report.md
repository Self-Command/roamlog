# FIX_STALE_AND_FORMAT — 倒退的断言 + 字节格式化统一

状态: DONE
任务 ID: FIX_STALE_AND_FORMAT
时间: 2026-11-19

## 变更文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `apps/admin/components/admin-shell/admin-shell.test.tsx` | 改 | 任务 1：断言反转 + 死链遍历 |
| `apps/web/lib/format-bytes.ts` | 新增 | 十进制 `formatBytes`，与 `cover-upload-validation.ts` 逐字节同规则 |
| `apps/web/lib/format-bytes.test.ts` | 新增 | 契约测试：1,500,000 → 1.5 MB；52,428,800 → 52.4 MB |
| `apps/web/lib/image/compress-image.ts` | 改 | 删除私有 `formatMegabytes`，改 import 共享实现 |
| `apps/web/lib/image/compress-image.test.ts` | 改 | 断言用户可见错误文案为 1.5 MB |
| `apps/web/lib/image/live-photo-motion.ts` | 改 | 删除私有 `formatMegabytes`，改 import 共享实现 |
| `apps/web/lib/image/live-photo-motion.test.ts` | 改 | 断言 TOO_LARGE 文案为 52.4 MB |

未触碰：`apps/api/**`、`packages/**`、`e2e/**`、`apps/web/components/**`。

## 任务 1：先红后绿

原断言（`admin-shell.test.tsx:86-91`）断言的是"正确的东西不存在"：

```tsx
it("does not link to the unfinished moderation page", () => {
  const hrefs = ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
  expect(hrefs).not.toContain(["/admin", "content"].join("/"));
  const routes = readdirSync(join(dirname(fileURLToPath(import.meta.url)), "../../app/admin"));
  expect(routes).not.toContain("content");
});
```

### 红（修改前，原始输出）

```
 ❯ components/admin-shell/admin-shell.test.tsx (9 tests | 1 failed) 607ms
   ❯ AdminShell (9)
     × does not link to the unfinished moderation page 8ms
     ✓ renders navigation and identity without fabricated environment, 2FA or notification badges 174ms
     ...

⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  components/admin-shell/admin-shell.test.tsx > AdminShell > does not link to the unfinished moderation page
AssertionError: expected [ '/admin', '/admin/users', …(10) ] to not include '/admin/content'
 ❯ components/admin-shell/admin-shell.test.tsx:88:23
     86|   it("does not link to the unfinished moderation page", () => {
     87|     const hrefs = ADMIN_NAV_GROUPS.flatMap((group) => group.items.map(…
     88|     expect(hrefs).not.toContain(["/admin", "content"].join("/"));
       |                       ^
     89|     const routes = readdirSync(join(dirname(fileURLToPath(import.meta.url)), "../../app/admin"));
     90|     expect(routes).not.toContain("content");

 Test Files  1 failed (1)
      Tests  1 failed | 8 passed (9)
```

### 绿（修改后，原始输出）

```
 ✓ components/admin-shell/admin-shell.test.tsx (10 tests) 429ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
 Duration  2.93s
```

### 新断言的形状（更强的正向断言 + 原有意图）

```tsx
const ADMIN_APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../app/admin");
const NAV_ITEMS = ADMIN_NAV_GROUPS.flatMap((group) => group.items);

/** A nav href only leads somewhere if the App Router page file behind it exists. */
function hasPageFile(href: string): boolean {
  const segment = href.replace(/^\/admin\/?/, "");
  return existsSync(join(ADMIN_APP_DIR, segment, "page.tsx"));
}

it("links the moderation queue and never ships a nav entry without a page", () => {
  const hrefs = ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));

  expect(hrefs).toContain("/admin/content");
  expect(NAV_ITEMS.find((item) => item.href === "/admin/content")?.label).toBe("内容审核");
  expect(existsSync(join(ADMIN_APP_DIR, "content", "page.tsx"))).toBe(true);

  // 原测试的真正意图：不允许导航项指向不存在的页面。
  const deadLinks = hrefs.filter((href) => !hasPageFile(href));
  expect(deadLinks).toEqual([]);
});

it("renders the moderation entry as a real link", () => {
  render(<AdminShell activePath="/admin/content"><h1>内容审核</h1></AdminShell>);
  expect(screen.getByRole("link", { name: "内容审核" })).toHaveAttribute("href", "/admin/content");
});
```

为什么这是**更强**的形式而不是简单取反：旧断言只有"目录里没有 content"这一条黑名单，它无法发现"导航项存在但页面被删"的情况，也无法覆盖其它导航项。新断言对**全部 12 个导航项**逐个做 `existsSync` 遍历，"导航有项、页面没了"依然会红。同时增加了一条真实渲染断言，证明该导航项在 AdminShell 里是可点击的 `<a href="/admin/content">`，而不只是常量数组里的一项。

## 死链检查结果（其它导航项）

对 `apps/admin/app/admin/<segment>/page.tsx` 逐项 `existsSync`，全部通过：

| 导航项 | label | page.tsx |
|---|---|---|
| /admin | 总览 | OK (`app/admin/page.tsx`) |
| /admin/users | 用户 | OK |
| /admin/workspaces | 工作区 | OK |
| /admin/content | 内容审核 | OK |
| /admin/permissions | 权限矩阵 | OK |
| /admin/audit | 审计日志 | OK |
| /admin/media | 媒体库 | OK |
| /admin/emails | 邮件 | OK |
| /admin/queues | 队列 | OK |
| /admin/flags | 功能开关 | OK |
| /admin/settings | 系统设置 | OK |
| /admin/system | 系统健康 | OK |

**结论：12/12 无死链，无需报告额外死链。**

附注（非死链，只报告不改）：`apps/admin/app/admin/2fa/` 目录存在但**没有** `page.tsx`，它只有 `2fa/enroll/`（该目录有页面）。`/admin/2fa` **不在** `ADMIN_NAV_GROUPS` 中，因此不构成导航死链；但若将来有人把 `/admin/2fa` 加进导航，`hasPageFile("/admin/2fa")` 会立即变红——新断言正好能拦住它。

## 任务 2：前后对比

| 数值 | 场景 | 二进制（改前） | 十进制（改后） |
|---|---|---|---|
| 1,500,000 | `IMAGE_TARGET_BYTES` 压缩失败提示 | `1.4 MB` | **`1.5 MB`** |
| 52,428,800 | `LIVE_PHOTO_MOTION_MAX_BYTES`（50 MiB）上限 | `50 MB` | **`52.4 MB`** |
| 25,000,000 | 参照（cover 上限） | `23.8 MB` | `25 MB` |
| 1,572,864 | 参照 | `1.5 MB` | `1.6 MB` |

用户可见文案变化：

```diff
- 图片压缩到最低质量后仍超过 1.4 MB，请换一张较小的图片。
+ 图片压缩到最低质量后仍超过 1.5 MB，请换一张较小的图片。

- 动图需小于 50 MB，当前文件为 50 MB。
+ 动图需小于 52.4 MB，当前文件为 52.4 MB。
```

实现方式：抽出 `apps/web/lib/format-bytes.ts`，规则**逐字节照搬** `cover-upload-validation.ts` 的 `formatBytes`（MB 保留 1 位小数并去掉尾随 `.0`、KB 取整、B 原值），两处 lib 改为 `import { formatBytes } from "../format-bytes"` 并删除各自的私有 `formatMegabytes`。

**阈值未改**：`IMAGE_TARGET_BYTES`、`LIVE_PHOTO_MOTION_MAX_BYTES`、`drag/drop` 比较全部仍是字节比较，只有显示变了。`git diff` 每文件只有 1 处 import、1 处删函数、1 处调用点。

## 验证命令与结果（原始输出）

1. `pnpm --filter @roamlog/admin exec vitest run components/admin-shell`

```
 ✓ components/admin-shell/admin-shell.test.tsx (10 tests) 429ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

2. `pnpm --filter @roamlog/web exec vitest run lib/image components/media lib/format-bytes`
（额外加入 `lib/format-bytes`，因为新测试不在原过滤器的 `lib/image`、`components/media` 内）

```
 ✓ lib/image/live-photo-pair.test.ts (10 tests) 21ms
 ✓ lib/image/live-photo-motion.test.ts (7 tests) 13ms
 ✓ lib/format-bytes.test.ts (4 tests) 10ms
 ✓ lib/image/compress-image.test.ts (17 tests) 33ms
 ✓ lib/image/use-image-compression.test.ts (5 tests) 66ms
 ✓ components/media/live-photo.test.tsx (10 tests) 224ms
 ✓ components/media/use-live-photo-upload.test.tsx (4 tests) 73ms
 ✓ components/media/cover-upload-validation.test.tsx (8 tests) 19ms
 ✓ components/media/cover-uploader.test.tsx (15 tests) 429ms
 ✓ components/media/use-cover-upload.test.tsx (20 tests) 1385ms

 Test Files  10 passed (10)
      Tests  100 passed (100)
```

3. `pnpm --filter @roamlog/web typecheck` → `next typegen && tsc --noEmit`，`✓ Types generated successfully`，exit 0
4. `pnpm --filter @roamlog/admin typecheck` → `tsc --noEmit`，exit 0
5. `pnpm lint` → **不是 0 退出**，但失败仅来自 `@roamlog/api`：

```
@roamlog/api:lint: apps/api/src/modules/trips/__tests__/content-presenters.spec.ts
@roamlog/api:lint:    4:3  error  'ActivitySchema' is defined but never used.
...（共 9 个 no-unused-vars 错误，全部在该文件）
@roamlog/api:lint: ✖ 9 problems (9 errors, 0 warnings)
 Tasks:    10 successful, 11 total
Failed:    @roamlog/api#lint
```

`@roamlog/web` 与 `@roamlog/admin` 的 lint 均通过（web/admin 无 error 输出）；worker 只有 19 条既有 `no-explicit-any` warning。api 的 9 个 unused-vars 全部在 `content-presenters.spec.ts`，该文件正被其它 Agent 修改（工作区里已是 ` M` 状态），属于 `LINT_FIX_API` 的在途工作，不是本任务引入。

## CodeGraph 证据

1. `codegraph status`（`C:\Users\BY9700\Desktop\UI\roamlog`）→ `[OK] Index is up to date`，1,779 files / 27,984 nodes / 64,351 edges。
2. `codegraph_explore "admin-shell.test.tsx admin-nav ADMIN_NAV_GROUPS content moderation"` → 命中 `ADMIN_NAV_GROUPS`（`admin-nav.ts:30`，6 个 caller：`admin-command-palette.tsx`、`admin-sidebar.tsx`、自身），blast radius 明确只有这 3 个文件消费导航常量，因此改 `admin-nav` 相关断言不会波及其它模块；并确认 `admin-sidebar.tsx:75` 直接 `ADMIN_NAV_GROUPS.map(...)`，**没有按角色过滤**，所以渲染断言对 support 会话同样成立。
3. `codegraph_explore "compress-image formatBytes live-photo-motion formatSize cover-upload-validation formatBytes"` → 命中三份 `formatBytes`：`components/media/cover-upload-validation.ts:57`（5 caller）、`apps/admin/lib/format.ts:39`（7 caller）、`.audit/.../bench-compression.mjs:68`；并给出 `formatMegabytes` 在 `compress-image.ts:137`、`live-photo-motion.ts:33` 的定义与唯一调用点（`:169`、`:77`），确认无其它调用方、无循环依赖（`format-bytes.ts` 零依赖）。

## 已知风险

1. **`cover-upload-validation.ts` 未迁移（需你确认）**：任务要求"若抽文件涉及改 `cover-upload-validation.ts`（不在白名单）→ 停下来问我"。该文件位于 `apps/web/components/**`（我的禁区），所以按任务给的退路执行：**只改两处**，共享实现放在 `apps/web/lib/format-bytes.ts`。现状是 `cover-upload-validation.ts` 仍保留一份**规则完全相同**的本地 `formatBytes`，两份实现并行存在，未来有漂移风险。注意 `apps/web/components/media/index.ts:16` 还 re-export 了它，所以不能简单删除。建议由其 owner 改成 `export { formatBytes } from "@/lib/format-bytes";` 一处收口。
   - `ask_user_question` 在子 Agent 下不可用（"human interaction is unavailable while the calling agent is owned by another live agent"），因此无法现场征询，改为在交付里显式上报。
2. **`apps/api` 存在同一 bug（我只报告不改）**：`apps/api/src/modules/media/media-rules.ts:26` `MAX_MOTION_BYTES = 50 * 1024 * 1024`，同文件 `:165` 的错误文案写 `"... between 1 byte and 50 MB."`——即服务端也在用二进制口径把这 52.4 MB 说成 "50 MB"。这是与我刚修的 web 文案同一问题的另一半，会让客户端与服务端对同一上传限制给出不同数字。属 `apps/api/**`，未改。
3. **`MAX_MEDIA_BYTES` 阈值口径不一致（只报告）**：`apps/api/src/modules/media/media-rules.ts:15` `MAX_MEDIA_BYTES = 25 * 1024 * 1024`（26,214,400），而 web 的 `COVER_MAX_BYTES` / settings `media.maxUploadBytes` 按注释是十进制 25,000,000。客户端比服务端更严格，用户不会撞上放行漏洞，但两处数字不自洽，且 `apps/admin/lib/format.ts` 的注释声称"三处同步"，实际未同步。属 `apps/api/**` + `packages/**`，未改。
4. 未改动 `.audit/local-verify/bench-compression.mjs:68` 里第四份二进制 `formatBytes`——它是本地产物脚本（非用户可见），不在白名单。

## 未覆盖项

- 未跑 `next build` / 全量 `pnpm test`（并行任务在途，工作区不稳定；本次改动的两个 lib 是纯函数，已由单测 + typecheck 覆盖）。
- 未做浏览器端手工点击验证；用户可见文案由单测断言原文串覆盖（`toContain("1.5 MB")` / `toContain("52.4 MB")`）。
- `compress-image.worker.ts` 通过 `encodeQualityLadder` 间接引入 `format-bytes`（相对路径 `../format-bytes`，非 `@/` 别名），worker 打包未单独验证；选相对路径正是为避开 worker bundler 的别名解析差异。

## 建议下一步

1. 由 `apps/web/components/media` 的 owner 把 `cover-upload-validation.ts` 的 `formatBytes` 改为 re-export `@/lib/format-bytes`，彻底去重（`index.ts` 的 re-export 可保留）。
2. 给 `apps/api` 开一个同源任务：`media-rules.ts` 的错误文案改十进制（"52.4 MB"），并统一 `MAX_MEDIA_BYTES` 与 `media.maxUploadBytes` 的口径（25,000,000 vs 25 MiB）。
3. 等 `LINT_FIX_API` 收尾后重跑 `pnpm lint` 应回到 0 error。

# 第二轮（追加授权）：两处收口

父 Agent 授权后追加。commit `fix(media): share one byte formatter and match the server copy to its constants`。

## 变更文件

| 文件 | 说明 |
|---|---|
| `apps/web/components/media/cover-upload-validation.ts` | 删本地 `formatBytes`，改为再导出 `@/lib/format-bytes` |
| `apps/api/src/modules/media/media-rules.ts` | 新增十进制 `formatMegabytes`；动图文案改为由常量计算；`MAX_MEDIA_BYTES` 加注释 |
| `apps/api/src/modules/media/__tests__/media-rules.spec.ts` | +3 个测试（4 → 7） |
| `.audit/fix-stale-format-report.md` | 本文件 |

`apps/web/components/media/index.ts:16` 的 re-export **未改动**，对外 API 不变。

## 1) web 去重

```diff
-export function formatBytes(bytes: number): string { ... }
+export { formatBytes };
```

本地那份 15 行实现被删除，改为 `import { formatBytes } from "@/lib/format-bytes"` + `export { formatBytes }`（同一 import，避免 `import/no-duplicates`）。`cover-upload-validation.test.tsx` 从 `./cover-upload-validation` 导入 `formatBytes` 的 8 个测试**无需改动**即通过——证明再导出对调用方完全透明。

## 2) 服务端口径对齐

```diff
-message: "Live Photo motion clips must be between 1 byte and 50 MB.",
+message: `Live Photo motion clips must be between 1 byte and ${formatMegabytes(MAX_MOTION_BYTES)}.`,
```

52,428,800 → **"52.4 MB"**。数字由常量计算，常量变了文案自动跟着变。

### 服务端为何仍用二进制常量（父 Agent 要求写清）

`MAX_MOTION_BYTES = 50 * 1024 * 1024 = 52,428,800` 与 `MAX_MEDIA_BYTES = 25 * 1024 * 1024 = 26,214,400` **保持不变**，理由：

1. **改常量是行为变更，改文案只是显示变更。** 这两个常量是真实的上传闸门（`sizeBytes > MAX_MOTION_BYTES` 直接 400）。把它们改成十进制会让服务端**收紧**约 4.8%（52.4 MB → 50 MB、26.2 MB → 25 MB），已在队列/在途的上传会被新拒。本任务只统一"用户看到的数字"，不应顺手改闸门。
2. **`MAX_MEDIA_BYTES` 的 1.2 MB 差是刻意的收紧容差，不是笔误。** 浏览器按 settings 的 25,000,000 先拦，服务端留到 26,214,400，用户不会遇到"客户端放过、服务端才报错"的割裂。已在常量上补注释固化这一点。
3. **两者必须由 `@roamlog/contracts` 统一，而不是跨 app import。** web 与 api 是不可互相 import 的独立部署单元；真要共享只能是 `packages/**`（本任务禁区），所以服务端保留一份 `formatMegabytes`。这是**跨进程边界的合理重复**，与 web 内部那两处"同 app 内重复实现"性质不同。

### 判断：图片文案**不**由 `MAX_MEDIA_BYTES` 计算

若把 `"Images must be between 1 byte and 25 MB."` 也改成由常量计算，会得到 **"26.2 MB"** —— 反而制造出与客户端「25 MB」的新数字不一致，正是本任务要消灭的问题。因此：**动图**文案由常量计算（它本来就该是 52.4），**图片**文案维持「25 MB」（= settings 的 25,000,000 = 客户端实际告知值），并在 `MAX_MEDIA_BYTES` 注释与测试里把这个决定钉住，防止后人"顺手统一"成 26.2。

## 验证（原始输出）

### web 定向（`components/media` + `lib/image` + `lib/format-bytes`）

```
 ✓ lib/image/live-photo-pair.test.ts (10 tests)
 ✓ lib/image/live-photo-motion.test.ts (7 tests)
 ✓ lib/format-bytes.test.ts (4 tests)
 ✓ lib/image/compress-image.test.ts (17 tests)
 ✓ lib/image/use-image-compression.test.ts (5 tests)
 ✓ components/media/live-photo.test.tsx (10 tests)
 ✓ components/media/use-live-photo-upload.test.tsx (4 tests)
 ✓ components/media/cover-upload-validation.test.tsx (8 tests)
 ✓ components/media/cover-uploader.test.tsx (15 tests)
 ✓ components/media/use-cover-upload.test.tsx (20 tests)
 Test Files  10 passed (10)
      Tests  100 passed (100)
```

### api 定向（`src/modules/media`）

```
 ✓ media-bucket.spec.ts (2)
 ✓ media-motion.spec.ts (8)
 ✓ media-read.spec.ts (11)
 ✓ media-url.service.spec.ts (11)
 ✓ trip-cover-projection.spec.ts (8)
 ✓ media-rules.spec.ts (7)      ← 4 → 7
 Test Files  6 passed (6)
      Tests  47 passed (47)
```

### `pnpm lint --force`（必须 --force，绕过 turbo 缓存）

```
Cached: 0 cached, 11 total          ← 确认未走缓存
Tasks: 10 successful, 11 total
Failed: @roamlog/api#lint
@roamlog/api:lint: src/modules/trips/__tests__/trips-origin-address.spec.ts
@roamlog/api:lint:   71:7  error  'row' is never reassigned. Use 'const' instead  prefer-const
```

**非 0，但唯一错误在 `trips-origin-address.spec.ts`（其它 Agent 在途文件），不在 media/。** web/admin lint 通过，worker 仅 19 条既有 warning。

### 归属隔离证据（证明失败与我的改动无关）

对四个改动文件单独跑 eslint：

```
$ (apps/api) eslint src/modules/media/media-rules.ts src/modules/media/__tests__/media-rules.spec.ts
[eslint exit: 0]        # 无任何输出
$ (apps/web) eslint -c ../../eslint.config.mjs components/media/cover-upload-validation.ts lib/format-bytes.ts
[eslint exit: 0]        # 无任何输出
```

`pnpm --filter @roamlog/api typecheck` 的全量错误文件只有两个，且都不是 media：

```
src/modules/exports/__tests__/export-presenter.spec.ts
test/staging-export-download.e2e-spec.ts
```

两处均为 `ExportRecord` 缺少 `bucket` 字段——由其它 Agent 在途的 `packages/db/prisma/migrations/0011_export_bucket/` 迁移引起（其 spec 尚未同步）。`tsc` 输出中 `modules/media` 相关错误数 = **0**。

## 第二轮遗留风险

1. `formatMegabytes`（api）与 `formatBytes`（web）是跨 app 的重复实现，规则相同但不同步。根治需挪到 `packages/contracts`，属禁区，建议单开任务。
2. `media.service.ts:233/:328` 两处**内部注释**仍写「≤50 MB / 50 MB ceiling」，非用户可见，未改（该文件不在授权范围）。
3. 图片文案的「25 MB」仍是字面量，未与 settings `media.maxUploadBytes` 建立编译期联系；若 settings 改值，此处会漂移。建议 contracts 导出 `MEDIA_MAX_BYTES_ADVERTISED`。