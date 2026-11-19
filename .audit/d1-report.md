# D1 — 浏览器端图片压缩（Web Worker）交付报告

- 任务 ID：`D1_CLIENT_COMPRESSION`
- 状态：**DONE**
- 范围：`apps/web` 前端；仅上传压缩后的单文件。未实现 Live Photo（留给 D2）。
- 日期：2026-11-19（Asia/Shanghai）
- 设计依据：`docs/superpowers/specs/2026-11-19-roamlog-production-completion-design.md` §7 工作流 D；`.audit/research-admin-media.md` §3 B 节（明确不使用 `browser-image-compression`，采用 `createImageBitmap` + `OffscreenCanvas`）。

## 1. 变更文件

新增：
- `apps/web/lib/image/compress-image.ts`
- `apps/web/lib/image/compress-image-protocol.ts`
- `apps/web/lib/image/compress-image.worker.ts`
- `apps/web/lib/image/compress-image-main-thread.ts`
- `apps/web/lib/image/use-image-compression.ts`
- `apps/web/lib/image/compress-image.test.ts`
- `apps/web/lib/image/use-image-compression.test.ts`
- `.audit/local-verify/bench-compression.mjs`
- `.audit/d1-report.md`（本文件）

修改：
- `apps/web/components/media/use-cover-upload.ts`
- `apps/web/components/media/cover-upload-error.ts`
- `apps/web/components/media/cover-uploader.tsx`
- `apps/web/components/media/use-cover-upload.test.tsx`
- `apps/web/components/media/cover-uploader.test.tsx`
- `apps/web/test/cover-upload-doubles.ts`（测试替身）
- `apps/web/package.json`（新增 `blurhash@^2.0.5`）
- `pnpm-lock.yaml`（pnpm 自动写入，仅 blurhash 条目）

未修改 `apps/api`、`apps/admin`、`packages/**`、`apps/web/app`、`apps/web/components/{auth,trips}`、`apps/web/lib/api/trip-form.ts`、`docker/**`。`apps/web/next-env.d.ts` 是 Next 构建自动改写的生成文件，未提交。

## 2. 实现摘要（对应 5 项要求）

1. **Worker 管线**：`compress-image.worker.ts`
   - `postMessage` 传 `File`，Worker 内 `createImageBitmap(file, { imageOrientation: "from-image" })` 烘焙 EXIF 方向，不手写 EXIF 解析。
   - 长边 `2000px`，`computeTargetSize` 按比例、不放大；随后以 `resizeWidth/resizeHeight + resizeQuality: "high"` 解码。
   - `OffscreenCanvas.convertToBlob({ type: "image/webp" })`；质量阶梯 `0.82 → 0.70 → 0.60 → 0.55`，最多 4 次，结果 >1.5MB 抛 `TOO_LARGE_AFTER_COMPRESSION`。
   - 另出 320px 缩略图（q `0.72`），并在 Worker 内用 `blurhash`（4×3，32×32 采样）计算 blurhash。
   - 返回 `{ full: Blob, thumb: Blob, width, height, blurhash, quality, iterations }` 以及 original/compressed bytes、elapsed、skipped。
   - 不使用 `canvas.toDataURL`。
2. **Worker 生命周期**：`use-image-compression.ts`
   - 模块级单例 Worker，单任务串行、其余 FIFO 排队；45s 超时。
   - 进度事件按 request id 路由；`AbortController` 取消进行中的任务时 `terminate()` Worker，队列任务直接拒绝且不上传。
   - 分类：`DECODE_FAILED` / `ENCODE_FAILED` / `TOO_LARGE_AFTER_COMPRESSION`；Worker 加载失败自动回退主线程。
3. **降级**：`compress-image-main-thread.ts`
   - `OffscreenCanvas`/Worker 不可用时用 `HTMLCanvasElement` + `canvas.toBlob` 实现同一条阶梯/缩略图/blurhash 管线，并输出 `console.warn`。
   - 连 Canvas 2D 都不存在（如 jsdom）时输出 warn 并直接上传原图，不阻断上传。
4. **接入上传链路**：`use-cover-upload.ts` / `cover-uploader.tsx`
   - 阶段：`validating → compressing → presigning → uploading → completing → processing → applying → ready`。
   - 文件类型/大小校验仍在压缩前，原 `cover-upload-validation.ts` 未改。
   - 压缩结果用于 PUT；`Content-Type: image/webp`，文件名改为 `.webp`（如 `IMG_0001.HEIC → IMG_0001.webp`）；presign / PUT / complete 均使用压缩后 `Blob` 的 size。
   - 小图（<200KB 且长边 ≤2000）跳过重压，直接上传原图（保留原 MIME/文件名，避免二次损失）。
   - 进度合并：压缩 0–20%，上传 20–90%，completing/processing 90–100%。上传器在压缩阶段显示进度条 + `aria-live` 播报「正在压缩图片…」，`aria-label="图片压缩进度"`。
   - 重试语义：压缩失败 `resumeAt: compressing`；上传失败仍从 `uploading` 起，不重新压缩；presign 过期仍从 `presigning` 起。
   - `keepOriginal`：支持组件 prop 或 `localStorage["roamlog.media.keepOriginal"]`，仅在压缩日志中记录，**D1 不额外上传原图**。
5. **实测**：Playwright 基准脚本见第 5 节，25MB 级 JPEG 输出 <1.5MB，0 long task。

## 3. 关键设计/代码位置

- 尺寸与阶梯：`apps/web/lib/image/compress-image.ts:3`、`:68`、`:121`
- HEIC 可读失败：`apps/web/lib/image/compress-image.ts:156`
- Worker 解码/编码/blurhash：`apps/web/lib/image/compress-image.worker.ts:59`、`:90`、`:116`
- 单例队列/取消：`apps/web/lib/image/use-image-compression.ts:72`
- Worker→主线程降级：`apps/web/lib/image/use-image-compression.ts:315`
- 压缩阶段与进度合并：`apps/web/components/media/use-cover-upload.ts:333`、`:340`、`:444`
- 压缩错误分类：`apps/web/components/media/cover-upload-error.ts:81`
- 压缩阶段无障碍：`apps/web/components/media/cover-uploader.tsx:95`、`:381`

## 4. 验证命令与结果

### 4.1 Typecheck

```text
$ pnpm --filter @roamlog/web typecheck
$ next typegen && tsc --noEmit
✓ Types generated successfully
（exit 0，无 TS 错误）
```

### 4.2 定向测试

```text
$ pnpm --filter @roamlog/web exec vitest run lib/image components/media --reporter=dot

 RUN  v5.1.0 C:/Users/BY9700/Desktop/UI/roamlog/apps/web
 Test Files  5 passed (5)
      Tests  55 passed (55)
   Duration  4.47s
```

覆盖：
- 长边 >2000 缩放、竖图、按比例；小图不放大；320 缩略图；
- 小图（<200KB 且长边 ≤2000）不重压；
- q=0.82 起，超限依次 0.82→0.70→0.60→0.55，4 次仍超 → `TOO_LARGE_AFTER_COMPRESSION`；
- 状态机 `compressing` 位置；压缩失败从 `compressing` 重试；上传失败不重压；
- HEIC/不可解码 → `DECODE_FAILED` + 可读中文提示；
- 压缩中取消 → 状态回 `idle`，不 presign/PUT；
- `aria-live` 压缩播报与压缩进度条；
- Worker 单例串行、进度转发、取消 terminate、Worker 加载失败降级。

### 4.3 全量 Web 测试

```text
$ pnpm --filter @roamlog/web test

 Test Files  32 passed (32)
      Tests  239 passed (239)
   Duration  15.83s
```

### 4.4 Lint

```text
$ pnpm --filter @roamlog/web lint
$ eslint -c ../../eslint.config.mjs .
（exit 0）
```

### 4.5 Build

```text
$ pnpm --filter @roamlog/web build
▲ Next.js 16.4.6 (Turbopack)
✓ Compiled successfully in 4.0s
  Finished TypeScript in 7.3s
✓ Generating static pages using 15 workers (10/10)
（exit 0）
```

补充验证：用同一 Next 16.4.6/Turbopack 生产构建了一个临时最小页面（包含同版本 Worker 源），`next start` 后 Playwright 点击触发 Worker，结果为 `message:result`，console/page errors 均为空。证明 `new Worker(new URL("./compress-image.worker.ts", import.meta.url), { type: "module" })` 在本项目构建链路中可实际加载（Turbopack 会生成 worker bootstrap + chunk）。临时页面已删除，未进入仓库。

### 4.6 性能基准（Playwright，现场 canvas 生成测试图，未下载外网图片）

命令：

```text
$ node .audit/local-verify/bench-compression.mjs
```

结果：

```text
Roamlog D1 client compression benchmark
worker bundle: 6.6 KB
image      original  compressed  quality  tries  elapsed  long tasks  max frame gap  skipped
─────────  ────────  ──────────  ───────  ─────  ───────  ──────────  ─────────────  ───────
5800x3900  24.71 MB  1.03 MB     0.82     1      845 ms   0           17 ms          no
3000x2000  3.11 MB   1.40 MB     0.82     1      516 ms   0           17 ms          no
900x600    6.9 KB    6.9 KB      source   0      12 ms    0           17 ms          yes

HEIC decode failure: DECODE_FAILED — 该格式浏览器无法解码（HEIC/HEIF）。请先转换为 JPEG 或 PNG 后重试。
```

说明：
- 25MB 级 JPEG 压缩后 1.03MB，满足 <1.5MB；全程 0 个 long task，最大 `requestAnimationFrame` 间隔 17ms（约 60fps）。
- 第二张 3.11MB → 1.40MB（接近目标上限，仍合规）。
- 900×600 / 6.9KB → `skipped=yes`，证明小图不重压。
- HEIC 为 Chromium 无法解码的 HEIC 类型 payload，Worker 返回 `DECODE_FAILED`，非静默失败。
- 逐张日志同时由上传 hook 输出：`[cover-upload] image compression { originalBytes, compressedBytes, quality, iterations, skipped, elapsedMs, keepOriginal }`。

## 5. CodeGraph 证据

查询：

```text
codegraph_explore "compressImage useImageCompression useCoverUpload compressing ImageCompressionError"
projectPath: C:\Users\BY9700\Desktop\UI\roamlog
```

关键结果：
- `useImageCompression` 被 `apps/web/components/media/use-cover-upload.ts` 调用（2 callers），并有 `use-cover-upload.test.tsx` 覆盖。
- `useCoverUpload` 有 5 个 callers，包括 `cover-uploader.tsx` 与 `components/media/index.ts`，测试为 `use-cover-upload.test.tsx`。
- 调用链确认：`compressImage → compressImageOnMainThread / singletonClient.compress`；`useCoverUpload → useImageCompression`；`useCoverUpload → compressionFailure`。
- `codegraph status`：`[OK] Index is up to date`（1,536 files / 23,804 nodes / 52,565 edges）。

## 6. 已知风险

1. **Safari HEIC**：Safari 可能原生解码 HEIC，Chromium 不会。Chromium 下明确 `DECODE_FAILED`；Safari 下 `createImageBitmap` 支持度/`imageOrientation` 行为仍需真机验证。若 Safari 不支持 WebP 编码，主线程降级会报 `ENCODE_FAILED`（不会静默）。
2. **内存**：25MP 源在 Worker 内解码仍会占用较大内存；已用 `createImageBitmap` 的 resize 参数降低峰值，并在完成后 `bitmap.close()`，但极低内存移动设备仍可能失败（会分类报错，不会卡死主线程）。
3. **二次压缩损失**：小图阈值只覆盖 <200KB 且长边 ≤2000；>200KB 的已压缩 WebP 仍会重编一次（按产品要求以体积优先）。D2 若支持 keepOriginal，可进一步避免。
4. **`@jsquash/webp` 未引入**：当前依赖原生 WebP 编码满足 Chromium/Firefox 基准；若后续 Safari 真机显示原生 WebP 编码缺口，再按调研 B 节引入 WASM 编码器。
5. **`keepOriginal` 只有偏好记录**，没有 UI 开关、没有原图对象上传；这是 D1 的明确非目标。
6. **HEIC 基准是合成不可解码 payload**：仓库没有真实 HEIC 样本，未下载外网图片。真实 HEIC 的 Chromium 行为仍需真机夹具复测。
7. **Next Worker 资产**：Turbopack 构建同时输出 `compress-image.worker.*.ts` 源文件与 worker chunk；生产探针已确认 Worker 实际执行，但若后续更换部署静态资源策略，需要重新检查 `_next/static/chunks/turbopack-worker-*` 的可达性。

## 7. 未覆盖项

- 真实 HEIC/HEIF 文件（无本地夹具，未下载外网）。
- Safari / iOS 真机（WebP 编码、HEIC 解码、OffscreenCanvas 支持）。
- 多图批量队列 UI（当前只支持单封面上传；Worker 队列已具备串行能力）。
- keepOriginal 的原图上传与 `variants.client` 服务端契约（D2/后续任务）。
- AVIF 输出（D1 不启用）。
- 生产环境真实对象存储端到端上传（本任务只验证到客户端压缩 + 现有 mock/单元链路）。

## 8. 建议下一步

1. D2：Live Photo 配对、`motionKey/motionMimeType/motionSize/livePhoto/pairedMediaId` 契约与播放；同时实现 keepOriginal 双资产上传。
2. 真机夹具：补一张真实 HEIC + 一张 25MB JPEG（CI 资产或本地 `.audit/fixtures`），在 Safari/Chromium 各跑一次 `bench-compression.mjs`。
3. 若 Safari 实测 WebP 编码失败，再引入 `@jsquash/webp` 作为 Worker 编码器，不改变现有状态机。
4. 服务端在收到 `image/webp` 后校验 magic bytes 与声明尺寸，并记录 `variants.client`，避免重复全量 sharp 编码。