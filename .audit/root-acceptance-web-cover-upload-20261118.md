# 根 Agent 验收记录 — WEB_COVER_UPLOAD

任务 ID: WEB_COVER_UPLOAD
验收结论: **ACCEPT（条件：挂载接线由两个 owner 完成，已双向下派）**
时间: 2026-11-18 22:35

## 通过

### 链路与状态机
- `idle → validating → presigning → uploading → completing → processing → applying → ready | error`
- `applying` 是**显式状态**（区分 setCover 阶段），避免把 set 失败伪装成完成 —— 这是正确的设计判断。
- 分阶段重试（这是本任务最扎实的部分）：
  | 失败 | 行为 |
  |---|---|
  | 网络错误 | 重试 PUT |
  | complete 5xx | 重试 complete |
  | worker failed | complete 重新入队 |
  | 轮询超时 | 只重询 |
  | `MEDIA_NOT_READY` | 回到 processing |
  | S3 403 / 签名过期 | **重新 presign**（PUT 前过期透明重签一次） |
  | 409 版本冲突 | 可重试 |
  | 413/415/类型/超限 | **不可重试**、保留用户文件 |
- 移除：`PATCH /v1/trips/{id}` `{version, coverMediaId:null}`，只清引用不删资产（正确，避免误删被引用媒体）。
- 回显：`trip.cover.url/thumbUrl`；`cover` 有值但无 URL → 「服务器处理中」，**不画假图**。

### 安全（根 Agent 重点核查项）
- **前端零 bucket/key/endpoint 拼接**：上传 URL 唯一来源是 presign 响应；XHR `open("PUT", uploadUrl)` + headers 原样；key 只由服务端 `buildMediaKey` 生成。
- 轮询端点 `GET /v1/media/{mediaId}` **确实存在**（`media.controller.ts:98`，`media:read` + MediaTenantGuard + RolesGuard），无需降级假设。

### 可访问性
- `aria-live` 播报阶段 + 10% 粒度进度；错误 `role=alert`；原生按钮键盘可达（已测 Enter）；`motion-reduce` 关闭动画/过渡；HEIC 不可预览时给真实提示但仍允许上传。

### 验证
- `components/media` 3 files / **34 tests**；`lib/api/media.test.ts` 1 file / **11 tests** → 合计 **45/45**。
- `pnpm --filter @roamlog/web typecheck` 在其完成时刻 0 错误（后续 5 条来自 `WEB_TRIP_FORM` 在途 `trip-form.tsx`，已确认非其责任）。
- 其改动文件 ESLint 无输出。

## 条件项（已双向下派，非本 Agent 责任）

**组件尚未挂载**，当前页面看不到封面上传。已分别指派：
1. `WEB_TRIP_FORM`：表单内挂载。新建模式不传 `trip`（`createTrip` 成功后 setCover）；编辑模式传 `trip`。
2. `WEB_TRIP_WORKSPACE`：详情工作台挂载（传 `trip`），概览展示 `trip.cover.url/thumbUrl`。

## 已知限制（接受，需在 G3/G6 覆盖）

1. **mock 模式不可上传**：`packages/api-mocks` 无 presign/complete/cover handler → mock 下显示真实可重试错误，不假成功。**决定**：仅在 api 模式挂载（已写入两个 owner 的指令）。
2. HEIC/HEIF 浏览器不可预览（已降级为真实提示）；worker 解码能力取决于其图像管线，失败走可重试 `PROCESSING_FAILED`。
3. 创建模式 `onChange.media` 返回 media，编辑模式返回 null（只有 trip）——语义已明确。

## 未覆盖（→ G3/G6）

- 未在表单/详情实际挂载（接线已下派）。
- 未与真实 MinIO/S3 联调（本机无 Docker）→ G5/G6 必须跑：真实 jpeg 成功链路、25MiB+1、gif、断网重试、worker 失败重试、刷新回显、移除。
- 未补 MSW media handler（若要在 mock 模式演示上传，需另开任务）。