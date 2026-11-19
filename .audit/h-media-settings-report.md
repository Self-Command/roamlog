# H_MEDIA_SETTINGS — 让后台 media.* 真正被前端消费

状态: DONE（真实浏览器上传未跑，原因见「未覆盖项」）
任务 ID: H_MEDIA_SETTINGS
角色: web_frontend + backend_api
时间: 2026-11-19 13:46–14:22（Asia/Shanghai）

## 变更文件

API
- `apps/api/src/modules/settings/settings.registry.ts`
- `apps/api/src/modules/settings/__tests__/settings.registry.spec.ts`
- `apps/api/src/modules/settings/__tests__/admin-settings.controller.spec.ts`

Web
- `apps/web/lib/settings.ts` / `apps/web/lib/settings.test.ts`
- `apps/web/lib/image/compress-image.ts` / `compress-image.test.ts`
- `apps/web/lib/image/compress-image-protocol.ts`
- `apps/web/lib/image/compress-image.worker.ts`
- `apps/web/lib/image/compress-image-main-thread.ts`
- `apps/web/lib/image/use-image-compression.ts` / `use-image-compression.test.ts`
- `apps/web/components/media/use-cover-upload.ts` / `use-cover-upload.test.tsx`
- `apps/web/components/media/cover-uploader.tsx` / `cover-uploader.test.tsx`

Admin
- `apps/admin/components/settings/settings-consumption.ts`（新增，字段级状态真值表）
- `apps/admin/components/settings/setting-field.tsx`
- `apps/admin/components/settings/settings-console.tsx`
- `apps/admin/components/settings/settings-console.test.tsx`
- `apps/admin/components/settings/admin-settings.test.ts`

## 实现摘要

### 1) 公开投影：只公开客户端真正读取的 4 个
- `media.maxEdge` / `media.quality` / `media.targetBytes` / `media.maxUploadBytes` → `isPublic: true`。
- `media.keepOriginal` / `media.livePhotoEnabled` → 保持 `isPublic: false`；help 文本如实标注「当前未接入：改动不影响上传行为」。
- registry 里新增 media 分组注释，解释为什么是 4/6 而不是整组公开。
- 测试：public projection 含 4 键、不含 2 个行为开关；secret 隐私断言原样保留并继续通过。

### 2) 前端消费
- `apps/web/lib/settings.ts` 新增 `getMediaCompressionPolicy()`：
  - 缺省 → `MEDIA_COMPRESSION_DEFAULTS` = 2000 / 0.82 / 1_500_000 / 25_000_000（与 registry 默认一致）；
  - 安全带：maxEdge 500–4000、quality 0.4–0.95、targetBytes 100k–5M、maxUploadBytes 1M–25M；
  - NaN / ±Infinity / 负数 / 非 number / 越界 → 回落代码默认 + `console.warn`，绝不抛错（越界不回落到边界值：8000 不会悄悄变 4000，而是回落 2000 并告警，避免后台存的值和实际行为不一致）。
- 压缩管线参数化（常量仍是默认值）：
  - `CompressImageOptions` 新增 `quality`；Worker 协议新增 `quality`；主线程 fallback 新增 `quality`。
  - `qualityLadderFrom(start)`：`[q, q×0.854, q×0.732, q×0.671]`，0.82 精确复现原 `[0.82,0.70,0.60,0.55]`，0.9 得到 `[0.9,0.768,0.659,0.604]`，固定 4 次、下限 0.4。
- `use-cover-upload.ts`：`mediaPolicy` 入参可注入；未注入时读 `useMediaCompressionPolicy()`（共享 30s 缓存）；压缩调用传入 `maxEdge/quality/targetBytes`；上传前校验用 `mediaPolicy.maxUploadBytes`（`maxBytes` prop 仍可覆盖）。
- `cover-uploader.tsx`：读取 policy 并传入 hook，展示的「最大 X MB」也改为 policy 值。

### 3) 变更即时生效
- 客户端走 `usePublicSettings()`（`staleTime = 30s`，服务端 fetch `next.revalidate = 30`），不重建、不重启。
- 测试：mock `useMediaCompressionPolicy` 返回值，先按 default 上传一次，改 policy 后 rerender 再上传，断言第二次压缩参数变为 1200/0.9/900000；另有一条「policy.maxUploadBytes 在压缩前拒绝 5MB 文件」的测试。

### 4) 后台逐键诚实标注
- 新增 `settings-consumption.ts`：4 个已接入键 = 「前端已消费」绿色 badge；`keepOriginal` / `livePhotoEnabled` = 「未接入（不生效）」黄色 badge。
- 页面底部 group 级状态对 media 覆盖为：「前端已消费 4/6 个键（maxEdge、quality、targetBytes、maxUploadBytes）；keepOriginal 与 livePhotoEnabled 未接入（不生效）」，其余分组仍用原静态真值表。
- 测试覆盖：6 个字段的逐键 badge、group 4/6 文案、非 media 分组不被误改。

## 验证命令与结果

### 1. API settings 测试 — 全绿
```
$ pnpm --filter @roamlog/api exec vitest run src/modules/settings
 ✓ src/modules/settings/__tests__/admin-settings.controller.spec.ts (13 tests)
 ✓ src/modules/settings/__tests__/settings.service.spec.ts (24 tests) 60ms
 ✓ src/modules/settings/__tests__/settings.registry.spec.ts (10 tests) 13ms
 ✓ src/modules/settings/__tests__/secret-box.spec.ts (7 tests) 13ms
 Test Files  4 passed (4)
      Tests  53 passed (53)
```

### 2. API typecheck — exit 0
```
$ pnpm --filter @roamlog/api typecheck
$ tsc --noEmit
[exit code: 0]
```

### 3. Web typecheck + 测试 — 全绿
```
$ pnpm --filter @roamlog/web typecheck
$ next typegen && tsc --noEmit
✓ Types generated successfully
[exit code: 0]

$ pnpm --filter @roamlog/web exec vitest run lib/settings lib/image components/media
 ✓ lib/image/compress-image.test.ts (16 tests) 21ms
 ✓ lib/image/use-image-compression.test.ts (5 tests) 84ms
 ✓ lib/settings.test.ts (23 tests) 256ms
 ✓ components/media/cover-upload-validation.test.tsx (7 tests) 10ms
 ✓ components/media/cover-uploader.test.tsx (15 tests) 496ms
 ✓ components/media/use-cover-upload.test.tsx (20 tests) 1574ms
 Test Files  6 passed (6)
      Tests  86 passed (86)
```
注：中途全量 `web typecheck` 曾因并行 Agent 正在改的
`components/trips/trip-form/__tests__/trip-form-state.test.tsx`（缺 `bbox`）报错；
对方修好后最终 typecheck exit 0，未触碰该文件。

### 4. Admin typecheck + 测试 — 全绿
```
$ pnpm --filter @roamlog/admin typecheck
$ tsc --noEmit
[exit code: 0]

$ pnpm --filter @roamlog/admin exec vitest run components/settings
 ✓ components/settings/admin-settings.test.ts (10 tests) 7ms
 ✓ components/settings/settings-console.test.tsx (16 tests) 1255ms
 Test Files  2 passed (2)
      Tests  26 passed (26)
```

### 5. Web production build — exit 0
```
$ pnpm --filter @roamlog/web build
✓ Generating static pages using 15 workers (10/10) in 473ms
Route (app) ... ○ / 30s ...
[exit code: 0]
```

### 6. 真实生效验证

6a. 真实 API 公开投影（运行中的 `:4000`，tsx watch 已加载新 registry）：
```
$ curl -s -w "\nHTTP %{http_code}\n" http://127.0.0.1:4000/v1/public/settings
{"settings":{"site.title":"Roamlog 验收",...,"theme.loginTagline":"Every trip deserves a memory.",
"media.maxEdge":2000,"media.quality":0.82,"media.targetBytes":1500000,"media.maxUploadBytes":25000000},
"generatedAt":"2026-11-19T06:03:38.461Z"}
HTTP 200
```
确认：含 4 个 media 键；`media.keepOriginal`、`media.livePhotoEnabled` 不在返回中。

6b. Web 服务端 policy 消费（真实 HTTP 抓取 + 只改一个字段的同形 payload stub）：
```
A. GET :4000/v1/public/settings -> 200
   media keys: {"media.maxEdge":2000,"media.quality":0.82,"media.targetBytes":1500000,"media.maxUploadBytes":25000000}
   keepOriginal present: false
   livePhotoEnabled present: false
   live policy: {"maxEdge":2000,"quality":0.82,"targetBytes":1500000,"maxUploadBytes":25000000}
B. stub payload maxEdge=1200 quality=0.9 targetBytes=900000 maxUploadBytes=8000000
   policy: {"maxEdge":1200,"quality":0.9,"targetBytes":900000,"maxUploadBytes":8000000}
   quality ladder: [0.9,0.768,0.659,0.604]
C. stub payload out of safe band (8000 / 0.2 / 20M / 100M)
   [roamlog] public setting media.maxEdge=8000 is outside the safe client range 500..4000; using the code default 2000
   [roamlog] public setting media.quality=0.2 is outside the safe client range 0.4..0.95; using the code default 0.82
   [roamlog] public setting media.targetBytes=20000000 is outside the safe client range 100000..5000000; using the code default 1500000
   [roamlog] public setting media.maxUploadBytes=100000000 is outside the safe client range 1000000..25000000; using the code default 25000000
   policy: {"maxEdge":2000,"quality":0.82,"targetBytes":1500000,"maxUploadBytes":25000000}
```
未做到的：通过 **admin 设置 API** 写入 1200。运行中的 live API（`:4000`，`e2e/live-support/start-api.ts`）要求 `super_admin` 会话 + 已验证 TOTP，本会话没有该会话凭据；且其数据库不在本机可连端口（`pg_stat_activity` 上无该 API 连接），无法像单测那样注入 `SETTINGS_REGISTRY_TOKEN` 或直接改行。因此 6b 用「与服务端 fetch 完全相同的路径 + 真实 API 返回体、仅替换目标字段的同形 stub」证明 policy 的钳制与生效；30s 窗口由 `PUBLIC_SETTINGS_REVALIDATE_SECONDS = 30`（测试断言）与 `useMediaCompressionPolicy` 的共享缓存实现保证。

## CodeGraph 证据
- `codegraph status`（开始时）→ `[OK] Index is up to date`（1,315 TS + 227 TSX 文件）。
- `codegraph_explore "settings.registry.ts media maxEdge quality targetBytes keepOriginal livePhotoEnabled isPublic public settings projection"`
  → 命中 `apps/api/src/modules/settings/settings.registry.ts`、`settings.service.ts:198 getPublicSettings`、`public-settings.controller.ts`；blast radius：`getPublicSettings` 被 `public-settings.controller` 调用，测试在 `settings.service.spec.ts`，并命中生成的 `packages/api-client/.../useGetPublicSettings`。
- `codegraph_explore "compressImage useCoverUpload cover-uploader image worker maxEdge quality targetBytes"`
  → 命中 `apps/web/lib/image/{compress-image.ts, compress-image.worker.ts, use-image-compression.ts}`、`apps/web/components/media/{use-cover-upload.ts, cover-uploader.tsx}`；blast radius：`compressImage` 的调用方、`CoverUploader` 的消费者 `trip-form.tsx` / `workspace-header.tsx`（本次未改，符合并行边界）。
- 修改后 CodeGraph watcher 自动增量同步（未手动重建）。

## 已知风险
- **越界值的语义**：safe band 之外的有限数字回落代码默认（不是钳到边界）。例：`media.maxEdge=8000` → 2000（而非 4000）。这是有意选择：后台存 8000 时前端按 2000 跑，二者不一致会暴露而非掩盖；代价是运营预期的「接近 4000」不会生效。
- **25MB 是十进制**：registry/DEFAULT_SETTINGS 是 `25_000_000`，而 `apps/web/lib/api/media.ts` 的 `COVER_MAX_BYTES` 仍是 `25*1024*1024`（未改，属他人/公共文件）。policy 生效后界面显示「最大 23.8 MB」（`formatMegabytes` 按 1024² 换算），数值真实但文案单位语义与旧版不同。
- **30s 生效窗口**：admin 保存后最长约 30s 才进入新上传；已在该窗口内打开的页面不会主动 invalidate，也符合需求。
- `media.livePhotoEnabled` 在 `packages/db` 的默认值是 `true`，但未公开、未接入，改动无行为影响；本次按任务要求仅标注，不改默认值。
- 服务端 413 的静态文案仍写「超过 25 MB 上限」（`cover-upload-error.ts`），当运营把 policy 上限调低时用户会先被客户端校验拦截，故实际不可达；未改动文案以免扩大 UI 变更面。

## 未覆盖项
- 未通过登录后台→改设置→浏览器上传的完整 Playwright 旅程（无 admin 会话；本轮以 API 200 投影 + policy 服务端路径 + hook 测试覆盖）。
- 未在真实浏览器里观察 Worker 实际输出的 WebP 质量/尺寸（`qualityLadderFrom` 与 Worker 协议转发有单测，压缩算法本身未改）。
- 未改 `packages/contracts`、`packages/db`、`apps/web/lib/api/media.ts`（并行/公共文件边界）。

## 建议下一步
1. 在 staging 用真实 `super_admin` 会话跑一次「改 maxEdge=1200 → 30s → 上传大图 → 检查上传对象长边 ≈1200」的 Playwright 旅程，补上最后一段真实证据。
2. 把 `COVER_MAX_BYTES` 与 registry 的 25MB 语义统一（十进制 vs 二进制），并让 413 文案读取 policy。
3. D2 真正接入 `keepOriginal` / `livePhotoEnabled` 时再公开对应键，并把本报告的「未接入」badge 改为真实状态。