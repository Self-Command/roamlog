# LIMIT_SEMANTICS — 上传上限设置与服务端能力对齐 + 后台字节十进制

状态：**DONE**
任务 ID：`LIMIT_SEMANTICS`
执行者：Roamlog backend_api + admin_frontend（子 Agent）
日期：2026-11-19
工作区：`C:\Users\BY9700\Desktop\UI\roamlog`（Windows Git Bash）

---

## 变更文件

| 文件 | 变更 |
| --- | --- |
| `apps/api/src/modules/settings/settings.registry.ts` | `media.maxUploadBytes` 的 schema 上限 `100_000_000 → 25_000_000`；help 写明服务端强制与客户端先拦 |
| `apps/api/src/modules/settings/__tests__/settings.registry.spec.ts` | 新增 2 条测试：25,000,000 接受 / 25,000,001 拒绝并给出原因；help 文案 |
| `apps/admin/lib/format.ts` | `formatBytes` 改为十进制（`/1_000`），顶部加口径同步注释；仅显示层 |
| `apps/admin/lib/format.test.ts` | 新建 4 条测试，锁定十进制、千分位、小数位与 `1.6 MB` 防回归 |
| `.audit/limit-semantics-report.md` | 本报告 |

未修改：`apps/api/src/modules/{media,storage}/**`、`apps/web/**`、`apps/admin/components/settings/**`、
`packages/**`、`e2e/**`、`docs/**`、其它 settings 文件。服务端 25 MiB 硬上限未动。

---

## 实现摘要

### 1. 设置上限 = 服务端真实能力

`settings.registry.ts` 的 `media.maxUploadBytes`：

```diff
- schema: z.number().int().min(1_000_000).max(100_000_000),
+ // The server hard-caps presigned uploads at 25 MiB (26,214,400 bytes). The
+ // setting stops at the decimal 25 MB mark so an operator can never save a
+ // value the presign endpoint would refuse; do not raise this without
+ // changing the media module's cap at the same time.
+ schema: z.number().int().min(1_000_000).max(25_000_000),
...
- help: "Largest single upload the presign endpoint accepts. The browser also pre-checks files against it, clamped to 25 MB.",
+ help: "Largest single upload the presign endpoint accepts. 上限 25 MB，由服务端强制；客户端会先拦一次。",
```

- 选择 25,000,000 而不是 26,214,400：设置里保存的值必须对**每一个**文件都成立；
  服务端硬上限是 25 MiB，十进制展示是 25 MB，取二者中更严格且无边界歧义的值。
- **未**放宽服务端到 100 MB：那会带来真实的 DoS/存储配额面，且 `media` 模块正被占用。
- 新增测试（`settings.registry.spec.ts`）：

```ts
it("caps the upload setting at the server-enforced 25 MB boundary", () => {
  expect(entry?.schema.safeParse(25_000_000).success).toBe(true);
  expect(entry?.defaultValue).toBe(25_000_000);

  const overLimit = entry?.schema.safeParse(25_000_001);
  expect(overLimit?.success).toBe(false);
  if (overLimit && !overLimit.success) {
    const issue = overLimit.error.issues[0];
    expect(issue?.code).toBe("too_big");
    expect(issue?.message).toMatch(/25000000|25[,_]000[,_]000/u);
  }

  expect(entry?.schema.safeParse(100_000_000).success).toBe(false);
  expect(entry?.schema.safeParse(1_000_000).success).toBe(true);
  expect(entry?.schema.safeParse(999_999).success).toBe(false);
});
```

拒绝原因来自 Zod：`Too big: expected number to be <=25000000`，会被设置服务映射为
`422 SETTINGS_INVALID / INVALID_VALUE`（下方真实请求已验证）。

### 2. `apps/admin/lib/format.ts` 字节十进制

文件顶部新增一行（按任务原文）：

```ts
// 十进制，与 `apps/web/lib/api/media.ts` 的 COVER_MAX_BYTES 与 settings 的 media.maxUploadBytes 口径一致；改动需三处同步。
```

实现：

```ts
while (size >= 1_000 && unitIndex < units.length - 1) {
  size /= 1_000;
  unitIndex += 1;
}

return `${new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: unitIndex >= 2 ? 1 : 0,
}).format(size)} ${units[unitIndex]}`;
```

口径与 web 端 `formatBytes`（`apps/web/components/media/cover-upload-validation.ts:57`）对齐：

| 字节 | 旧后台（1024） | 新后台（decimal） | web 端 |
| --- | --- | --- | --- |
| 1,500,000 | 1 MB | **1.5 MB** | 1.5 MB |
| 1,572,864 | 2 MB | **1.6 MB** | 1.6 MB |
| 25,000,000 | 24 MB | **25 MB** | 25 MB |
| 26,214,400 | 25 MB | **26.2 MB** | 26.2 MB |

说明：

- 任务示例建议“<10 显示 1 位、≥10 显示整数”，但 web 已上线实现是“整数则整数、否则 1 位小数”。
  为了让同一个文件在两处**逐字一致**，采用 web 的规则（`12_345_678 → 12.3 MB`，而不是 `12 MB`）；
  这是本轮要消除的正是“同一文件两处不同”。
- 千分位保留（`Intl.NumberFormat("zh-CN")`，如 `999_999 → 1,000 KB`）；KB 仍为整数，与 web 一致。
- 整数字节会自然丢掉尾随 `.0`（`1_048_576 → 1 MB`），因此既有
  `workspaces-view.test.tsx` 的 `1 MB` 断言无需改动，也无需越界改组件测试。
- **纯显示层**：没有任何阈值/校验判断引用 `formatBytes`；调用方仍是
  `media-view.tsx`、`workspaces-view.tsx`、`dashboard-view.tsx` 的渲染。

### 3. 只记录：其余重复字节格式化点（不改）

| 位置 | 是否影响用户可见文案 | 判定 |
| --- | --- | --- |
| `apps/web/lib/image/compress-image.ts:137-140` | **是**。`:169` 的错误文案“图片压缩到最低质量后仍超过 X MB”使用它；`IMAGE_TARGET_BYTES = 1_500_000` 二进制显示 `1.4 MB`，十进制应为 `1.5 MB` | **中优先**（web 目录被占用，本轮不改） |
| `apps/web/lib/image/live-photo-motion.ts:33-36` | **是**。`:77` 的动图校验文案“动图需小于 X MB，当前文件为 Y MB”使用它；`LIVE_PHOTO_MOTION_MAX_BYTES = 50 * 1024 * 1024` 显示 `50 MB`，十进制口径应为 `52.4 MB` | **中优先**（与上传语义相关，但不在本任务边界） |
| `.audit/local-verify/bench-compression.mjs:68` | 否。仅终端基准表格输出 | **低优先**（非产品代码） |

结论：前两处不是“只影响日志”，都会进入用户可见错误文案，不能按低优先处理；
它们与本次 `media.maxUploadBytes` 的十进制口径存在同类漂移，建议在 web 目录解冻后统一收敛到
`apps/web/components/media/cover-upload-validation.ts` 的 `formatBytes`（或抽到共享包）。

---

## 验证命令与原始输出

### 1. `pnpm --filter @roamlog/api exec vitest run src/modules/settings`

```text
 ✓ src/modules/settings/__tests__/admin-settings.controller.spec.ts (21 tests) 533ms
 ✓ src/modules/settings/__tests__/settings-save-probe.service.spec.ts (17 tests) 35ms
 ✓ src/modules/settings/__tests__/settings.service.spec.ts (24 tests) 30ms
 ✓ src/modules/settings/__tests__/limits-settings.consumer.spec.ts (11 tests) 12ms
 ✓ src/modules/settings/__tests__/secret-box.spec.ts (7 tests) 9ms
 ✓ src/modules/settings/__tests__/settings.registry.spec.ts (12 tests) 10ms
 ✓ src/modules/settings/__tests__/mail-settings.consumer.spec.ts (13 tests) 10ms

 Test Files  7 passed (7)
      Tests  105 passed (105)
```

新增的 12 条 `settings.registry.spec.ts` 中含 `caps the upload setting at the server-enforced 25 MB boundary`
与 `documents that the server enforces the upload cap`。

### 2. `pnpm --filter @roamlog/api typecheck`

```text
$ tsc --noEmit
[exit code: 0]
```

### 3. `pnpm --filter @roamlog/admin typecheck` + `exec vitest run lib`

```text
$ tsc --noEmit
[exit code: 0]
```

```text
 ✓ lib/admin-paths.test.ts (3 tests) 8ms
 ✓ lib/admin-api-error.test.ts (2 tests) 11ms
 ✓ lib/format.test.ts (4 tests) 15ms
 ✓ lib/check-env-preflight.test.ts (2 tests) 1093ms
 ✓ lib/admin-data-source.test.ts (5 tests) 15ms

 Test Files  5 passed (5)
      Tests  16 passed (16)
```

（`lib/admin-api-error.test.ts` 是并行 Agent 新增的文件，不在本任务改动内。）

### 4. `pnpm --filter @roamlog/admin build`

```text
▲ Next.js 16.4.6 (Turbopack)
✓ Compiled successfully in 3.8s
✓ Generating static pages (18/18)
...
Route (app)
├ ○ /admin/settings ...
ƒ /v1/[...path]
[exit code: 0]
```

说明：第一次 build 曾在 `components/settings/settings-console.tsx` 报 2 个未使用变量（并行 Agent 在途），
范围外未改；该文件随后由并行 Agent 修好，重跑通过。

### 5. 真实边界验证（API 4310 + 本地 PG 55444，隔离 schema `limit_semantics`）

环境：临时 schema `limit_semantics` → `prisma migrate deploy`（0010 全部应用）→ 种一个 UUIDv7 的
`super_admin` → `npx tsx src/main.ts` 起在 `127.0.0.1:4310`（`NODE_ENV=development`，Redis/MinIO 不可用，
API 以 degraded 模式服务）→ Better Auth `POST /v1/auth/sign-in/email` 取得会话 Cookie。
`health: {"status":"ok","uptimeSeconds":5}`，`listener pid` 就是本次 wrapper 的子进程（非复用旧进程）。

**PATCH `media.maxUploadBytes=26000000` → 422：**

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/problem+json; charset=utf-8

{"type":"https://roamlog.app/errors/settings-invalid","title":"Unprocessable Content","status":422,"detail":"One or more settings were rejected.","instance":"/v1/admin/settings","code":"SETTINGS_INVALID","errors":[{"field":"media.maxUploadBytes","code":"INVALID_VALUE","message":"Too big: expected number to be <=25000000"}]}
```

**PATCH `media.maxUploadBytes=25000000` → 200：**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"updated":[{"key":"media.maxUploadBytes","secret":false,"updatedAt":"2026-11-19T08:06:58.971Z"}],"version":null,"generatedAt":"2026-11-19T08:06:58.982Z"}
```

**GET 回读：**

```json
[
  {
    "key": "media.maxUploadBytes",
    "group": "media",
    "type": "number",
    "help": "Largest single upload the presign endpoint accepts. 上限 25 MB，由服务端强制；客户端会先拦一次。",
    "default": 25000000,
    "isPublic": true,
    "value": 25000000,
    "updatedAt": "2026-11-19T08:06:58.971Z",
    "updatedById": "01a1f2d8-1661-77ee-8038-08e47e78ca98"
  }
]
```

API 日志仅有两条例行启动探针失败（Redis `127.0.0.1:1`、MinIO `:9000` 未启动，环境预期），
PATCH/GET 请求本身没有错误。验证后已 `DROP SCHEMA limit_semantics CASCADE`、停止 4310 进程并删除临时种子脚本。

### 6. 后台与 web 显示口径一致

- web 端既有测试（本轮重跑，8/8 通过）：

```text
 ✓ components/media/cover-upload-validation.test.tsx (8 tests) 16ms
```

  断言原文：`formatBytes(COVER_MAX_BYTES) === "25 MB"`、`formatBytes(1_500_000) === "1.5 MB"`、
  `formatBytes(1_572_864) === "1.6 MB"`。
- admin 新测试断言：`25_000_000 → "25 MB"`、`1_500_000 → "1.5 MB"`、`1_572_864 → "1.6 MB"`、
  `26_214_400 → "26.2 MB"`、`12_345_678 → "12.3 MB"`。
- 两个包的实现对同一批字节给出相同字符串（唯一差异：`1_048_576` web 渲染 `1.0 MB`，admin 因 Intl
  省略尾随零渲染 `1 MB`；数值与单位一致，不影响上限文案）。

---

## CodeGraph 证据

- `codegraph status`（改动前后各一次）：`Files: 1,771 / Nodes: 27,789 / Edges: 63,721`，
  `[OK] Index is up to date`（改动后 watcher 增量同步仍为 up to date）。
- `codegraph_explore "settings.registry media.maxUploadBytes formatBytes admin format"`（`projectPath` 指向仓库）：
  - 命中 `apps/admin/lib/format.ts:31` 的 `formatBytes`，blast radius：**6 个调用方**，
    分别位于 `apps/admin/components/media/media-view.tsx`、`workspaces/workspaces-view.tsx`、
    `dashboard/dashboard-view.tsx`，并由这 3 个组件的测试间接覆盖；
  - 命中 `apps/web/components/media/cover-upload-validation.ts:57` 的 `formatBytes`，**5 个调用方**（封面链路）；
  - 命中 `settings.registry.ts` 的 `SETTINGS_REGISTRY` 与 `media.*` 定义，确认改动前的
    `max(100_000_000)` 与 `help` 原文。
- `codegraph_explore "apps/api/src/modules/settings/settings.registry.ts maxUploadBytes"`：
  返回 registry 的逐行源码，并显示 `SETTINGS_REGISTRY` 由 `SETTINGS_BY_KEY`/controller 消费；
  据此确认只需改 schema 与 help，不影响其它 27 个设置键。

---

## 已知风险

1. **存量设置值**：改动前若有运维把 `media.maxUploadBytes` 存到 25,000,001–100,000,000，本次不会自动迁移；
   该值仍留在 DB，但任何再次保存都会 422 `SETTINGS_INVALID`。上线后应查询并回落到 ≤25,000,000。
2. **25,000,000 vs 26,214,400 的灰区**：字节数在 (25,000,000, 26,214,400] 的文件服务端仍会接受，
   但客户端按设置先拦。这是为消除“设置说可以、服务端拒绝”而刻意收紧的一侧；若将来要放开，
   必须同时改 media 模块硬上限、web `COVER_MAX_BYTES` 与本 registry（三处同步）。
3. **`1 MB` 的尾随零差异**：admin 的 `Intl` 省略 `.0`，web 显式 `toFixed(1)` 会渲染 `1.0 MB`；
   上限文案（25 MB/26.2 MB）与常规值完全一致，属可接受的显示差异。
4. **组件测试未新增**：`workspaces-view` 等只用既有的 `1 MB` 断言；本轮通过 lib 单测与真实 API 验证，
   未改组件测试以遵守文件边界。
5. **并行工作区状态**：`apps/admin/components/settings/settings-console.tsx` 在验证期间一度导致 build 失败，
   随后由并行 Agent 修复；`apps/admin/lib/admin-api-error.ts/.test.ts` 也被并行 Agent 改动，均未纳入本提交。
   全量 admin 测试另有 1 条与本任务无关的既有失败
   （`components/admin-shell/admin-shell.test.tsx` 期望导航不含 `/admin/content`，但当前导航包含）。

## 未覆盖项

- 未跑 E2E / Playwright 视觉回归；后台页面截图未采集（item 6 用两侧单测断言完成对比）。
- 未启动真实 S3/MinIO 与 Redis；边界验证只覆盖 settings 写入路径（本任务不触碰存储链路）。
- 未改 `apps/web/lib/image/*` 的两处 `formatMegabytes`（web 目录被占用），仅记录。
- 未改服务端 `MAX_MEDIA_BYTES` / 契约 `MediaPresignRequestSchema` 的 25 MiB 上限。

## 建议下一步

1. 派单 web 侧：把 `compress-image.ts:137` 与 `live-photo-motion.ts:33` 的 `formatMegabytes` 收敛到
   `cover-upload-validation.ts` 的 `formatBytes`，让“压缩失败”和“动图超限”文案也走十进制口径。
2. 运维对本地/staging 的 `system_setting` 做一次 `media.maxUploadBytes > 25000000` 的巡检并回落。
3. 若要支持 >25 MiB 单文件，需要 ADR：同时提升 media 硬上限、S3 分片/带宽配额、客户端压缩目标和
   本 registry 上限，三处同步后再放开，避免再次出现“能改但不生效”。
4. 后台 `formatBytes` 可考虑与 web 共享一个 `packages/` 格式化函数，从机制上保证“三处同步”。