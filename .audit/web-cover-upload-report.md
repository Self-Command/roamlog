# WEB_COVER_UPLOAD 交付报告

- 日期：2026-11-18
- 角色：web_frontend
- 任务：旅行封面端到端真实上传（可重试、可回显、无占位假控件）

---

## 状态

**状态: DONE**（组件与真实链路完成并验证；生产挂载点因文件归属未接线，接入说明见下）

## 任务 ID: WEB_COVER_UPLOAD

---

## 变更文件

新增（全部为允许范围）：

| 文件 | 作用 |
| --- | --- |
| `apps/web/components/media/cover-uploader.tsx` | 主交付物：选择/拖拽、预览、进度、替换、移除、空状态、错误与 aria-live |
| `apps/web/components/media/use-cover-upload.ts` | 状态机 hook：presign → PUT → complete → 轮询 → setCover，分阶段重试 |
| `apps/web/components/media/cover-upload-error.ts` | 错误分类（网络 / 413 / 415 / 签名过期 / worker 失败 / 版本冲突），保留 code/detail/serverCode/resumeAt |
| `apps/web/components/media/cover-upload-validation.ts` | 类型/大小校验，最终用 `MediaPresignRequestSchema` 对齐服务端 |
| `apps/web/components/media/index.ts` | 组件/hook/类型导出入口 |
| `apps/web/lib/api/media.ts` | 媒体网络 seam：generated client + 契约校验 + XHR PUT（真实上传进度） |
| `apps/web/test/cover-upload-doubles.ts` | 测试替身（不参与生产引用） |
| `apps/web/components/media/cover-uploader.test.tsx` | 组件 UI/交互/无障碍测试 |
| `apps/web/components/media/use-cover-upload.test.tsx` | 状态机、重试、轮询超时测试 |
| `apps/web/components/media/cover-upload-validation.test.tsx` | 校验测试 |
| `apps/web/lib/api/media.test.ts` | XHR 传输 + 端点/契约/清封面 PATCH 测试 |
| `.audit/web-cover-upload-report.md`、`.audit/web-cover-upload-report.checkpoint.md` | 报告与检查点 |

未修改任何禁止目录：`components/trips/**`、`components/trip-detail/**`、`components/app-shell/**`、`lib/demo-store*`、`apps/api/**`、`apps/admin/**`、`packages/**`、compose/deploy、lockfile、其它 `.audit`。

---

## 实现摘要

### 1. 真实链路与数据来源

```
选择/拖拽
  → validate（契约 MediaPresignRequestSchema，25 MB，6 种 image/*）
  → POST /v1/workspaces/{workspaceId}/media/presign   （generated presignMediaUpload）
  → PUT  {uploadUrl}（XHR，真实 upload.onprogress；headers 原样来自响应）
  → POST /v1/media/{mediaId}/complete                （generated completeMediaUpload）
  → GET  /v1/media/{mediaId} 轮询（1s 起、×1.5、上限 4s、总超时 60s，可配置）
  → POST /v1/trips/{tripId}/cover {mediaId}           （generated setTripCover）
  → 失效 queryKeys.trip(tripId) + queryKeys.trips(workspaceId) 前缀
```

**URL 全部来自服务端**：前端不存在 bucket、object key、S3 endpoint 字面量；PUT 使用 presign 返回的 `uploadUrl` 与 `headers`（`Content-Type`），key 只由服务端 `buildMediaKey` 生成。测试里的 `storage.example.test` 只是测试替身假值。

**移除**：`PATCH /v1/trips/{tripId}` body `{ version, coverMediaId: null }`（契约 `UpdateTripRequestSchema`），成功后本地状态 `cover=null` 并失效 query；不删除媒体资产本身。

**刷新回显**：组件从 `trip.cover` 读取 `url/thumbUrl/status`；`cover` 为 null 渲染可操作空状态；`cover` 存在但 `url/thumbUrl` 均为 null（processing）时显示“服务器处理中”，不渲染假图。

### 2. 状态机

`idle → validating → presigning → uploading → completing → processing → applying → ready | error`

- `applying` 是 `processing` 与 `ready` 之间对“写入/清除封面”的显式状态（任务清单之外的必要补充，避免把 setCover 失败伪装成完成）。
- 失败时保留已选文件与本地预览；`error.resumeAt` 记录应重试的阶段。
- 重试矩阵：
  - 网络失败 → `resumeAt: uploading`（重新 PUT，不重新 presign）
  - complete 5xx → `resumeAt: completing`
  - worker `failed` → `resumeAt: completing`（complete 对 failed 行允许重新入队）
  - 轮询超时 → `resumeAt: processing`（只重试查询）
  - `MEDIA_NOT_READY`(409) → `resumeAt: processing`
  - S3 403 / 签名过期 → `SIGNED_URL_EXPIRED`，`resumeAt: presigning`；PUT 前若 `expiresAt` 已过会透明重签一次
  - 版本冲突(409) → `VERSION_CONFLICT`，可重试（父组件刷新后拿到新 version）
  - 413 / 415 / 类型 / 超限 → 不可重试，保留文件并提示“选择其他文件”
- 所有错误对象保留 `code`（客户端分类）、`serverCode`（API ProblemDetails code）、`detail`（服务端 detail）、`status`。

### 3. 交互与可访问性

- 点击选择（隐藏 input，`accept` 含 6 种 MIME 与扩展名）+ 拖拽（dragOver/drop，多文件取第一并播报）。
- 本地预览 `URL.createObjectURL`；替换/重置/卸载时 `revokeObjectURL`；成功后若已拿到服务端封面 URL 立即回收。
- 浏览器无法解码的格式（HEIC/HEIF 常见）`img.onError` 后显示“浏览器无法预览此格式，仍会按原图上传并处理”，不显示破图。
- 进度：上传阶段用 `Progress`（`aria-valuenow` + `aria-valuetext`）；complete/processing/applying 用 Skeleton + 文案，不伪造百分比。
- `role="status" aria-live="polite" aria-atomic="true"` 播报阶段与 10% 粒度的进度；错误进入 `role="alert"`。
- `reduced motion`：进度条 `motion-reduce:transition-none!`、Skeleton `motion-reduce:animate-none!`，状态不依赖动画。
- 键盘：所有操作是原生 button（替换/移除/重试/选择图片），删除类按钮使用 `variant="danger"`；已测 `Tab` 聚焦 + `Enter` 打开选择器。
- 有封面显示 `alt="当前旅行封面"/"当前旅行照片"`，预览显示 `alt="待上传图片预览：<文件名>"`。

### 4. `CoverUploader` props（可直接给表单 Agent）

```ts
interface CoverUploaderProps {
  workspaceId: string;            // 必填；presign 按 workspace 作用域
  trip?: Trip | null;             // 编辑已有旅行时传入；/trips/new 不传
  cover?: TripCover | null;       // 可选覆盖（父级在表单里暂存 cover 时用）
  size?: "cover" | "photo";       // 默认 cover（16:9）；photo 为 4:3
  onChange?: (change: CoverChange) => void;
  onError?: (error: CoverUploadError) => void;
  onTransition?: (transition: CoverTransition) => void; // 观测用
  disabled?: boolean;
  className?: string;
  client?: CoverMediaClient;      // 测试注入；生产不用传
  maxBytes?: number;              // 默认 25 MB（服务端同值）
  pollIntervalMs?: number;        // 默认 1000
  processTimeoutMs?: number;      // 默认 60000
}

interface CoverChange {
  kind: "uploaded" | "removed";
  mediaId: string | null;
  media: MediaRead | null;        // 仅创建流程上传完成时有值
  trip: Trip | null;              // 编辑流程 set/clear 后由服务端返回
  cover: TripCover | null;        // trip.cover 或 null（移除后）
}
```

行为约定：
- **传 `trip`**：上传完成后组件自己调用 `POST /v1/trips/{id}/cover`，并 invalidate trip 详情/列表；`onChange` 返回更新后的 `trip`。
- **不传 `trip`**（`/trips/new`）：只上传到 ready，不调用 setCover；`onChange` 返回 `mediaId` 与 `media`，由表单在创建成功后再绑定封面。
- 移除按钮只在 `trip` 存在时出现（清除走带 version 的 PATCH）。

### 5. 给 `WEB_TRIP_FORM` 的接入示例（可直接粘贴，未写入表单目录）

编辑页（`trips/[id]/edit`，表单外挂载，不要放进 `<form>` 的 submit 路径）：

```tsx
import { CoverUploader } from "@/components/media";

<CoverUploader
  workspaceId={workspace.id}
  trip={trip}
  size="cover"
  onChange={(change) => {
    // 组件已调用 POST /v1/trips/{id}/cover 并失效 queries；
    // 这里只把最新 trip 同步给表单/本地状态，不要再重复调 setCover。
    if (change.trip) setTrip(change.trip);
  }}
  onError={(error) => {
    // error.code / error.serverCode / error.detail 可直接展示
    toast.error(error.message);
  }}
/>
```

新建页（`trips/new`，上传与创建解耦）：

```tsx
import { CoverUploader } from "@/components/media";
import { createCoverMediaClient } from "@/lib/api/media";
import { queryKeys } from "@/lib/query";
import { useQueryClient } from "@tanstack/react-query";

const [pendingCover, setPendingCover] = useState<{ mediaId: string } | null>(null);
const queryClient = useQueryClient();

<CoverUploader
  workspaceId={workspace.id}
  size="cover"
  onChange={(change) => {
    setPendingCover(change.mediaId ? { mediaId: change.mediaId } : null);
  }}
/>

// createTrip 成功后：
if (pendingCover) {
  await createCoverMediaClient().setCover(createdTrip.id, pendingCover.mediaId);
  await queryClient.invalidateQueries({ queryKey: queryKeys.trip(createdTrip.id) });
}
```

注意：
- 组件需要 `QueryClientProvider`（应用级 providers 已提供）。
- **仅 `NEXT_PUBLIC_DATA_MODE=api` 时有意义**：`packages/api-mocks` 目前没有 presign/complete/cover handler，mock 模式下会得到真实网络错误并展示可重试错误（不会假装成功）。表单可据此仅在 API 模式挂载，或后续补 MSW handler（不在本任务范围）。

---

## 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @roamlog/web exec vitest run components/media` | **3 files / 34 tests passed** |
| `pnpm --filter @roamlog/web exec vitest run lib/api/media.test.ts` | **1 file / 11 tests passed** |
| 两者合并 | **4 files / 45 tests passed** |
| `pnpm --filter @roamlog/web typecheck`（22:03:37） | **0 errors**（`next typegen` + `tsc --noEmit` 全绿） |
| `pnpm --filter @roamlog/web exec tsc --noEmit`（最终一次） | 5 errors，**全部在 `components/trips/trip-form/trip-form.tsx`**（WEB_TRIP_FORM 在途：TS6133 ×3、TS2322 ×2）；`components/media/**`、`lib/api/media.ts`、`test/cover-upload-doubles.ts` **0 错误**（grep 验证无输出） |
| `pnpm exec eslint -c ../../eslint.config.mjs components/media lib/api/media.ts lib/api/media.test.ts test/cover-upload-doubles.ts` | 无输出（通过） |

未启动 dev server、未跑 build、未连生产。

> 补充：22:06 的一次合并测试运行曾因 `packages/contracts/src/api/index.ts` 的 `AdminQueueMetricsSchema` 导入瞬时失败（并行 Agent 正在改 contracts），立即重跑即 45/45 通过；属并行写入抖动，不是本任务代码问题。

### 测试覆盖清单（对应任务要求）

- 类型/大小校验拒绝：`cover-upload-validation.test.tsx`（6 类型接受、gif 拒绝、空 type 按扩展名兜底、25 MB 边界 ±1、空文件、非法文件名）
- 成功链路状态转移 + setCover 参数：`use-cover-upload.test.tsx` 第一个用例断言完整转移序列与 `{tripId, mediaId}`，并断言两次 query 失效
- PUT 失败重试：网络错误 → `resumeAt: uploading`，retry 后 presign 仍为 1 次、PUT 2 次
- complete 失败重试：5xx → `resumeAt: completing`，complete 2 次、presign/PUT 各 1 次
- 轮询超时：20ms 超时下 `PROCESSING_TIMEOUT`，retry 后继续轮询至 ready
- worker 失败：`failed` + error detail → `PROCESSING_FAILED`，retry 重新 complete
- 签名过期：presign 返回过期 TTL → `SIGNED_URL_EXPIRED`，PUT/complete 未发生
- `MEDIA_NOT_READY`：409 → 回 `processing` 重试，最终 setCover 成功
- 替换与移除：组件测试“移除”走 versioned PATCH 并回到空状态；替换按钮键盘 Enter 打开选择器
- `trip.cover` 回显：既有封面渲染 `cover.url` 且无占位图；processing 封面显示处理中文案
- 创建流程：未传 trip 时不调用 setCover，`onMediaReady`/`onChange` 返回 media
- 传输层：XHR 设置 PUT + 服务端 headers、真实 progress、413/网络/abort 分类；`clearCover` 断言 PATCH body `{version, coverMediaId:null}`；presign/setCover 参数与契约校验
- 无障碍：live region 播报 50% 进度、alert、键盘可操作、disabled 状态下拖拽/按钮不生效

---

## 截图 / 日志 / 接口证据

### 1. 状态机转移（测试断言的实际序列）

```
validating → presigning → uploading → completing → processing → applying → ready
```

### 2. setCover / clearCover 实际参数（测试断言）

```
POST /v1/trips/{tripId}/cover   { mediaId: "0198f000-...-b1" }
PATCH /v1/trips/{tripId}        { version: 7, coverMediaId: null }
```

### 3. 真实 PUT 传输（XHR 测试）

```
xhr.open("PUT", uploadUrl, true)
xhr.setRequestHeader("Content-Type", "image/jpeg")
xhr.upload.onprogress({ loaded: 512, total: 1024 }) → onProgress(512, 1024)
xhr.status = 413 → rejects SignedUrlUploadError{ code:"http", status:413 }
```

### 4. 轮询端点

`GET /v1/media/{mediaId}`，只读核对已在服务端存在：
`apps/api/src/modules/media/media.controller.ts:98 @Get("media/:mediaId")` → `media.getOne`，返回 `MediaRead`（`status`、`url`、`thumbUrl`、`expiresAt`；未 ready 时 URL 为 null）。因此**无降级路径**，也没有使用假 URL 兜底。

### 5. 服务端契约/能力核对（只读）

- `POST /v1/workspaces/{workspaceId}/media/presign` → `{mediaId, uploadUrl, method:"PUT", headers, expiresAt}`（`media.controller.ts:41`，`MediaPresignResponseSchema`）
- `POST /v1/media/{mediaId}/complete`（`media.controller.ts:52`，processing 入队）
- `POST /v1/trips/{tripId}/cover`（`media.controller.ts:133`，`MEDIA_NOT_READY` 409）
- 清封面 `PATCH /v1/trips/{tripId}`（`trips.service.ts:258` 起，`coverMediaId:null` + version）
- 上限：`MAX_MEDIA_BYTES = 25 MiB`、`ALLOWED_IMAGE_MIME_TYPES = jpeg/png/webp/avif/heic/heif`
- worker：`apps/worker/src/jobs/media.ts` 将状态置 `processing`，成功后 `ready`，失败 `failed`（可重入 complete 重试）

### 6. CodeGraph 证据

- 前置门禁：`codegraph status` 首次提示脏索引（3 added / 5 modified，其它 Agent 在写）；`codegraph sync` 遇 watcher 锁（PID 4296），随后 status 为 `[OK] Index is up to date`（1,385 files / 20,977 nodes / 45,024 edges）。收尾再次 `codegraph sync`：`Added 6, Modified 8 — 352 nodes`，最终 **`[OK] Index is up to date`（1,426 files）**。
- 探索 1：`codegraph explore "presign complete media usePresignedUpload useCompleteMedia setTripCover useGetMedia MediaStatus variants"` → 51 symbols / 8 files；确认 `usePresignedUpload` 不存在，实际链路为 `presignMediaUpload` / `completeMediaUpload` / `getMedia` / `setTripCover`；blast radius 指向 generated endpoints 与 `MediaStatus`。
- 探索 2：`codegraph explore "trips update coverMediaId clear cover version conflict TripCoverService media worker process"` → 73 symbols / 8 files；确认 `TripCoverService`、`trips.service.ts` 的 `coverMediaId` 更新与清空路径（version 冲突）。
- 探索 3（交付后）：`codegraph explore "CoverUploader useCoverUpload createCoverMediaClient putObjectToSignedUrl clearCover"` → 64 symbols / 4 files，调用链：
  `CoverUploader → useCoverUpload → createCoverMediaClient`；
  blast radius：`CoverUploader`（index.ts 导出 + cover-uploader.test.tsx）、`useCoverUpload`（cover-uploader.tsx + index.ts + 测试）、`clearCover`（use-cover-upload.ts + media.test.ts）、`CoverUploadError`（14 callers）。

---

## 已知风险

1. **未生产挂载**：`components/trips/**`（含 trip-form）、`trips/new|edit`、`components/trip-detail/**` 都属其它 Agent；按任务策略只交付组件 + 接入说明，等待表单 Agent 收尾后由根 Agent 决定接线归属。当前页面还看不到该组件，这是刻意未越权，不是功能缺失。
2. **mock 模式不可上传**：默认 `NEXT_PUBLIC_DATA_MODE=mock`，`packages/api-mocks` 没有 presign/complete/cover handler。mock 模式下挂载会显示真实网络错误（可重试），不会假成功。建议表单只在 API 模式挂载，或另行补 MSW。
3. **HEIC 预览**：浏览器普遍无法解码 HEIC/HEIF，已改为真实提示；上传本身不受影响。worker 是否能处理 HEIC 取决于其图像管线（`detectImageMime` 支持 heic 魔数；解码失败会进入 `failed`，UI 展示可重试错误）。
4. **移除不删资产**：只清 `coverMediaId`，媒体文件仍保留（避免误删被其它内容引用的资产）。如需回收，另开任务调用 `DELETE /v1/media/{id}`。
5. **onChange 的 media 字段**：编辑模式 setCover 后只返回 `trip`，`media` 为 null；需要媒体详情的调用方可在创建流程使用 `media`。
6. **并发/版本冲突**：清封面依赖传入 `trip.version`；若父组件不刷新最新 version，重试会持续 409（错误会明确提示刷新）。上传成功后会使用响应里的新 version。

## 未覆盖项

- 没有在 `trips/new|edit`、trip detail 中实际挂载（文件归属限制）。
- 没有跑 `next build` / dev server（任务禁止；端口与并行改动风险）。
- 没有浏览器端真实 S3/MinIO 联调（无运行中的栈；用契约 + 传输层测试 + 服务端只读核对代替）。真实环境验收需根 Agent 在 API 模式跑一次。
- 没有补 MSW media handler（属 packages/api-mocks，禁止修改）。
- 多文件选择只取第一并提示，未做批量封面上传（产品不需要）。

## 建议的下一步

1. `WEB_TRIP_FORM` 收尾后，由根 Agent 按上文示例在表单**外**挂载 `CoverUploader`（编辑页传 `trip`，新建页不传并在 create 成功后 setCover）。
2. 在 `NEXT_PUBLIC_DATA_MODE=api` 下用真实 API + MinIO 跑一次：jpeg 成功链路、超 25 MB 拒绝、gif 拒绝、断网重试、worker 失败重试、刷新回显、移除。
3. 若需要 mock 模式演示，给 `packages/api-mocks` 增加 presign（返回 local 假 PUT URL）/complete/get/cover handler；本任务未越权修改。
4. 根 Agent 最终构建前确认 `components/trips/trip-form/trip-form.tsx` 的 5 条在途 TS 错误已由表单 Agent 修复。