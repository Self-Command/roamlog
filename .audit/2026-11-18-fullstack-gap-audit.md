# Roamlog 全栈字段与能力缺口审计

日期：2026-11-18  
审计对象：`C:\Users\BY9700\Desktop\UI\roamlog`  
生产入口：`https://we.spacedo.org`，API 前缀 `/v1`，镜像 `v0.1.0-rc.3`  
审计方式：只读代码、只读合约、只读生产数据库/容器；仅写本报告与 checkpoint。  
结论状态：**DONE（审计完成）**；审计中发现的未验证项见“风险与未验证项”。

---

## 1. 执行摘要

### 1.1 一句话结论

Roamlog 当前不是“只差 UI 细节”的状态，而是**后端多数领域能力已存在、用户端主旅程只接通了骨架**：旅行可创建/改名/改摘要/改状态，日志和评论可用；但旅行全字段、封面、地点/途经点编辑、照片、行李、费用、分享入口、presence 和媒体生产链路都没有形成可验收闭环。

### 1.2 真实完成度判断

| 层 | 真实状态 | 判断 |
|---|---|---|
| Prisma/PostgreSQL | `Trip`/`Stop`/`Media`/`Expense`/`PackingItem`/`Comment`/`ShareLink` 等主模型齐全；日期用 `DATE`，金额用整数 minor unit；已有版本号与软删除 | **基础完整，缺少量可选字段与 DB 完整性约束** |
| NestJS API | 旅行、Stop、媒体、评论、分享、费用、行李、通知、实时、导出等模块存在；OpenAPI 由 Zod 生成 | **能力大部分存在，但缺地点搜索、单媒体读取、封面投影；部分授权有洞** |
| Worker/S3 | presign → upload → complete → sharp variants → retry 链路已实现；本地 staging-full 证据通过 | **代码链路完整，生产浏览器链路被网络配置阻断** |
| Web | 生产 `DATA_MODE=api`；新建旅行是显式 `FORM SKELETON`；详情仅少量字段可编辑 | **主缺口，必须重做旅行创建/详情工作台** |
| Admin | API 模式、审核/用户/媒体/队列等页面存在 | **基本可用；媒体预览仍是渐变占位，桶名硬编码错误** |
| 生产数据 | 2 个账号、2 个 workspace、1 个占位 trip、0 media、0 日志、0 分享 | **接近空库，不是已验收的完整产品数据** |

### 1.3 五个 P0 工作流

1. **旅行创建/编辑全字段未接**：`new-trip-shell.tsx` 只提交 title/summary/startDate/endDate；`visibility` 是视觉假按钮；`origin/destinations` 被硬编码为“未填写”。
2. **封面上传没有用户端链路，且生产 S3 地址不可达**：媒体 API 与 Worker 已有，但 Web 无 upload/cover 组件；生产 `S3_ENDPOINT=http://minio:9000`、MinIO 9000 未发布、Nginx 无 `/media` 路由，浏览器拿到的签名 URL 指向内网主机。
3. **地点搜索/途经点没有服务端契约**：没有 `/v1/places/*`，前端地图直接请求 Photon；搜索结果不能保存为 Stop，Trip 也没有起点坐标。
4. **旅行详情没有完整工作台**：详情页没有封面、地点、日期、预算、可见性、标签、协作者、分享、删除、照片、行李、费用入口；旧的丰富 tab 只存在于 mock 组件，不进入生产路由。
5. **主旅程缺少可执行验收**：现有 staging journey 只验证“登录 → 新建标题/日期 → API 回读”，没有验证全字段、封面上传、地点、权限、刷新回显和移动端。

### 1.4 最重要的判断

- **不需要重做数据库主模型**。封面、照片、行李、费用、分享、评论、通知、presence 的表和 API 大多已存在，应复用。
- **需要新增的 schema 很少**：地点上下文（provider/providerPlaceId/timezone）、Trip 起点坐标、预算完整性约束；其余靠契约投影和前端接线。
- **必须先修共享契约和生产存储出口**，否则 Web/API/QA 并行会反复返工。
- **不要把“API 存在”当成“功能完成”**。当前用户端真正可操作的只有：登录、建最小旅行、改标题/摘要/状态、写日志、评论、通知、地图查看、分享（仅地图页按钮）。照片、行李、费用、封面、地点编辑均未进入生产 UI。

---

## 2. 审计范围、方法与证据等级

### 2.1 已阅读

- 顶层 `AGENTS.md`（Roamlog 协作规范）。
- `docs/superpowers/specs/2026-11-17-roamlog-fullstack-collaboration-design.md`。
- `packages/contracts`（Zod/OpenAPI/权限/实时事件）。
- `packages/db/prisma/schema.prisma` 与全部迁移。
- `apps/api/src/modules/*` 控制器、服务、Presenter、权限。
- `apps/worker/src/jobs/*` 媒体/导出/维护任务。
- `apps/web` 路由、live/mock 数据源、旅行/详情/地图/日志/分享组件。
- `apps/admin` 媒体、审核、队列、权限相关组件。
- 生产容器、Nginx、数据库只读查询、Redis 队列、健康检查。

### 2.2 证据等级

| 等级 | 含义 | 本报告示例 |
|---|---|---|
| E1 | 当前代码事实 | `new-trip-shell.tsx` 硬编码“未填写” |
| E2 | 当前契约/迁移事实 | OpenAPI 无 `/v1/places/search` |
| E3 | 当前生产只读事实 | 生产 DB 1 trip、0 media、2 migrations |
| E4 | 历史/本地集成证据 | `e2e/staging-full/evidence/latest.json` 媒体链路通过 |
| E5 | 未验证推断 | HEIC 在目标镜像中的实际解码能力未做生产验证 |

### 2.3 明确未做

- 未修改任何产品源码、数据库、配置、迁移、镜像。
- 未执行生产写操作、未创建账号、未上传对象、未触发队列。
- 未读取或输出任何邮箱、密码、token、cookie、对象 key、PII。
- 未在真实浏览器完成生产封面上传（因此把该链路标为“代码可复用、生产未闭环”）。

---

## 3. 真实状态总览

### 3.1 数据模式

- 生产 Web 容器 `NEXT_PUBLIC_DATA_MODE=api`。
- 生产 Admin 容器 `NEXT_PUBLIC_ADMIN_DATA_MODE=api`。
- 代码仍保留大量 mock 文案/组件；生产虽然走 API，但部分页面（Atlas、Insights、旧 trip-detail tab）仍只渲染 mock 数据。

### 3.2 生产运行态（只读）

| 项 | 结果 |
|---|---|
| 镜像 | `web/api/admin/worker:v0.1.0-rc.3`，均 healthy |
| API readiness | `/v1/ready` 200，database/redis/storage 均 up |
| Worker | `worker.ready`，queues: media/email/export/reminders/maintenance |
| Redis 队列 | media/email/export wait=0 active=0 failed=0 delayed=0；ingress=0 |
| 数据库迁移 | 2 个迁移全部完成，无失败/回滚：`0001_init`、`0002_two_factor_state` |
| 邮件 | 生产实际为 Mailpit，不是 Resend 外发 |
| 对象存储 | MinIO；DB media=0；bucket 对象未可靠枚举（镜像无 mc/find） |

### 3.3 生产数据（只读计数）

| 表 | 计数 | 说明 |
|---|---:|---|
| User | 2 | 1 `super_admin` + 1 `admin`；1 个已启用 2FA |
| Workspace | 2 | 2 个 owner membership，无 editor/viewer |
| Trip | 1 | 1 个未删除；0 封面、0 预算、0 标签、0 协作者 |
| JournalEntry | 0 | 无日志 |
| Stop | 0 | 无途经点 |
| Media | 0 | 无照片/封面 |
| ShareLink | 0 | 无公开分享 |
| PackingItem / Expense / Comment / Notification | 0 | 无业务数据 |

该 trip 的 `origin='未填写'` 且 `destinations=['未填写']`，正是当前 `new-trip-shell.tsx` 的硬编码产物。

---

## 4. 字段/能力 Gap Matrix

图例：✅ 完整；🟡 部分/仅后端；❌ 缺失；🧪 仅测试/本地证据；⛔ 生产阻塞。优先级：P0 阻断主旅程；P1 完整 v1 必需；P2 打磨/后续。

| 能力 | UI 真实状态 | API | DB/存储 | 权限 | 真实结论 | 缺口 | 优先级 |
|---|---|---|---|---|---|---|---|
| 旅行标题/摘要 | 新建可填；详情可编辑 | POST/PATCH 完整 | `Trip.title/summary` | editor+；viewer 只读 | ✅ 主链路可用 | 无 | — |
| 旅行状态 | 新建硬编码 `planning`；详情可改 | PATCH 支持 | `TripStatus` | editor+ | 🟡 可用但创建不可选 | 新建表单加状态 | P2 |
| 开始/结束日期 | 新建可填；详情不编辑 | POST/PATCH 支持 | `DATE` + DB check | editor+ | 🟡 创建可用，编辑缺失 | 详情编辑、日期冲突处理 | P1 |
| 天数 | 卡片/详情用前端计算 | 无派生字段 | 无列 | — | 🟡 计算一致但未共享 | 统一 inclusive-day helper；可选 `durationDays` 投影 | P2 |
| 出发地 origin | 新建硬编码“未填写”；详情只读 | 支持字符串 | `Trip.origin` | editor+ | ❌ 用户不可输入 | 表单 + 地点选择 + 坐标 | P0 |
| 目的地 destinations | 新建硬编码 `["未填写"]`；详情只读 | 支持 string[] | `String[]` | editor+ | ❌ 用户不可输入 | 目的地编辑器；与 Stop 去重策略 | P0 |
| 路线/途经点 | 地图可显示已有 Stop；新建无 Stop 编辑；地图“添加城市”只改本地 state | Stop CRUD/reorder 完整 | `Stop` 有 lat/lng/order/dates | editor+ | 🟡 后端完整，UI 未接 | Stop 编辑器、地图联动、保存 | P0 |
| 起点坐标 | 无 | 无 | 无 | — | ❌ 缺失 | `originLat/originLng` 或 origin Stop | P1 |
| 封面 cover | 卡片/详情只显示渐变；无上传 | presign/complete/setCover 完整；Trip 不投影 cover | `Trip.coverMediaId` + `Media` | editor+ | 🟡 后端可用，UI/生产网络断 | 上传组件、`Trip.cover` 投影、S3 公网出口 | P0 |
| 预算金额 | 卡片/详情只读展示 | POST/PATCH 支持 | `Int?` minor units | editor+ | 🟡 可录入但无表单 | 详情/表单预算字段 | P1 |
| 币种 | 只读展示 | `CurrencyCodeSchema` | `TEXT?` | editor+ | 🟡 | 币种选择器、ISO 校验 | P1 |
| 可见性 | 新建按钮无绑定；详情 badge 只读 | POST/PATCH 支持 | `TripVisibility` | editor+ | ❌ 创建假交互 | 表单单选、详情编辑、保存回显 | P0 |
| 标签 | 卡片只读展示；无编辑 | POST/PATCH 支持 | `String[]` | editor+ | 🟡 | 标签输入、去重、上限 | P1 |
| 协作者 guestNames | 卡片头像用 guestNames；无编辑 | POST/PATCH 支持 | `String[]` | editor+ | 🟡 | 同行人编辑器 | P1 |
| 成员参与者 | 无旅行级 UI | participants CRUD | `TripParticipant` | editor+ | 🟡 | 成员选择器；私有 trip 授权策略 | P1 |
| 旅行删除 | 无 | DELETE 完整 | 软删除 | editor+ | 🟡 | 危险确认、跳转、缓存失效 | P1 |
| 旅行复制 | 无 | duplicate 完整 | 复制 children | editor+ | 🟡 | 详情操作入口 | P2 |
| 草稿 | 无 | 无 | 无 | — | ❌ | localStorage 自动草稿；不做服务端草稿 | P1 |
| 乐观锁 | 日志/详情有 409 处理 | version/PATCH 完整 | `version` | — | ✅ | 旅行详情覆盖保存 UI 需完善 | P2 |
| 地点搜索 | 地图组件直接请求 Photon；无统一下拉 | 无 places API | 无索引 | — | ❌ | 服务端代理、缓存、降级、Stop 保存 | P0 |
| 日志 | 可写、自动保存、版本恢复、评论 | CRUD/revisions 完整 | `JournalEntry` | editor+ / viewer 评论 | ✅ 基本闭环 | 图片上传、封面 | P1 |
| 照片 | 旧 mock 有；生产详情无照片 tab | media list/presign 完整 | `Media` + `EntryMedia` | editor+ | 🟡 后端完整、UI 缺失 | 照片墙、上传、关联日志 | P1 |
| 行李 | 旧 mock tab；生产无入口 | packing API 完整 | `PackingItem` | editor+ | 🟡 后端完整、UI 缺失 | 行李 tab + hooks | P1 |
| 费用/结算 | 旧 mock tab；生产无入口 | expense/budget API 完整 | `Expense`/`ExpenseParticipant` | editor+ | 🟡 后端完整、UI 缺失 | 预算/费用 tab | P1 |
| 评论 | 日志评论区真实 | comments API 支持 `journal_entry`/`itinerary_item` | `Comment` | viewer 可评论 | ✅ | 无 trip 级评论；按产品需要再扩展契约 | P2 |
| 分享 | 仅地图页有分享按钮；公开页无图片 | share API + public endpoint 完整 | `ShareLink` | editor+ | 🟡 创建可用，展示不完整 | 详情入口、封面/照片 URL、密码态 | P1 |
| 通知 | 真实 API | notifications 完整 | `Notification` | 本人 | ✅ | 实时推送 | P2 |
| Presence | 响应式头像假在线；无 socket 客户端 | Socket.IO + Redis adapter 完整 | 内存 presence | 成员 | 🟡 后端完整、前端零接入 | socket provider、事件失效、在线头像 | P1 |
| 导出 | 无入口 | export API/worker 完整 | `ExportJob` | viewer 可导出 | 🟡 | 详情/设置入口 | P2 |
| 内容搜索 | 有 API hook | search API 完整 | 现有表 | 成员 | ✅ | 全局搜索 UI 已有，保持 | — |
| Admin 媒体 | API 模式 | admin media 完整 | `Media` | platform admin | 🟡 | 真实缩略图、桶名来自配置 | P2 |
| 生产邮件 | Mailpit | worker 邮件 | — | — | ⛔ 非真实 Resend | 生产外发配置 | P1 |

---

## 5. 旅行全字段逐项核对

### 5.1 新建旅行

证据：`apps/web/components/trips/new-trip-shell.tsx`

- 状态变量只有 `title`、`summary`、`startDate`、`endDate`。
- 第 54–69 行构造 POST，只提交：

```ts
title, summary, status: "planning",
startDate, endDate,
origin: "未填写",
destinations: ["未填写"],
countryCodes: ["CN"],
tags: [],
guestNames: [],
visibility: "workspace",
```

- 第 107 行页面仍标注 `FORM SKELETON`。
- 第 201 行只显示日期范围；没有封面、预算、标签、协作者、起点、目的地、路线、天数。
- “workspace / private / public”可见性按钮没有 state 绑定，也没有进入 POST。

结论：**创建接口能接受 12+ 个字段，UI 只暴露 4 个；且用占位值污染了真实数据。**

### 5.2 编辑旅行

证据：`apps/web/components/trips/trip-detail-live.tsx`

- 可编辑字段只有 `title`、`summary`、`status`；`UpdateTripRequest` 的其余字段不可编辑。
- 详情 header 显示 `origin`、`destinations`、日期、预算、可见性，但全部只读。
- 封面仍是 `coverClassForTrip(tripIndex)` 渐变，不读取 `coverMediaId`。
- `tags`、`guestNames` 没有编辑入口。
- 没有删除、复制、分享、上传封面操作。
- 保存冲突有 409 → 重新加载/覆盖流程（正确，可保留）。

### 5.3 字段命名/序列化

| 用户概念 | API 字段 | DB 类型 | Web 现状 | 风险 |
|---|---|---|---|---|
| 标题 | `title` | `String` | 已接 | 无 |
| 简介 | `summary` | `String` | 已接 | 无 |
| 状态 | `status` | enum | 创建硬编码 | 不能创建 wishlist/active |
| 开始/结束 | `startDate/endDate` | `DATE` | 创建已接 | 编辑缺失 |
| 天数 | 无字段 | 无 | 前端 `tripDurationDays` | 无共享实现 |
| 出发地 | `origin` | `String` | 硬编码 | 无法回显真实值 |
| 目的地 | `destinations` | `String[]` | 硬编码 | 与 Stop 重复 |
| 国家码 | `countryCodes` | `String[]` | 硬编码 `["CN"]` | 与实际地点不符 |
| 路线/途经 | `Stop[]` | `Stop` 表 | 仅地图读 | 无编辑 |
| 预算 | `budgetAmountMinor` | `Int?` | 只读 | 无表单 |
| 币种 | `budgetCurrency` | `String?` | 只读 | 无选择器 |
| 可见性 | `visibility` | enum | 假按钮 | 无保存 |
| 标签 | `tags` | `String[]` | 只读 | 无编辑 |
| 协作者 | `guestNames` + participants | `String[]` + 表 | 只读/假头像 | 无编辑 |
| 封面 | `coverMediaId` | UUID FK | 渐变 | 无上传/投影 |

### 5.4 表单持久化与回显

- 创建成功后会跳到详情，但下一次编辑只回显 title/summary/status。
- 刷新后 origin/destinations 仍是“未填写”，用户会认为数据丢失。
- 没有草稿。多字段表单中断会丢失全部输入。
- 没有“取消/离开确认”。加入封面本地预览后必须补 `beforeunload` 或 route guard。
- 删除/归档：API 有 DELETE（软删除），UI 没有入口；不存在 `archived` 状态，详情却提供 `archived` 选项——这是一个真实 bug，提交会被 400/校验拒绝。

### 5.5 建议的完整表单模型

一个滚动式编辑页或 3 段式表单：

1. **基本信息**：标题、简介、状态、可见性。
2. **时间与路线**：开始/结束日期、出发地（可搜索）、目的地（可搜索多选）、途经点（可增删排序，转为 Stop）。
3. **预算与协作**：预算金额、币种、标签、同行人 guestNames、成员参与者。

封面放在顶部 hero 区域，支持拖拽/选择；提交时先保存 trip，再上传封面（见下节）。

---

## 6. 封面上传：现状、阻塞与一次性方案

### 6.1 已有可复用能力（后端）

证据：

- `packages/contracts/src/api/media.ts`：presign/complete/list/update/set cover 契约完整。
- `apps/api/src/modules/media/media.service.ts`：
  - `presign()` 校验 MIME/大小并创建 `pending` Media。
  - `complete()` HEAD 校验真实对象，MIME 魔数、大小，之后入队 `media.process`。
  - `presentWithUrls()` 为原图与 variants 生成签名读 URL。
  - `setCover()` 校验 `ready`、同 workspace、同 trip。
  - `remove()` 软删除并入队 `media.cleanup`。
- `apps/worker/src/jobs/media.ts`：sharp 生成 `thumb/medium/large` + JPEG/WebP，写 blurhash，重试/失败状态。
- 本地 staging-full 证据：媒体 ready、7 个 variants、签名原图/缩略图读取 200、匿名读取 403。

### 6.2 真实缺口

1. **Web 完全没有上传组件**。
2. **Trip 响应不包含可显示封面**：只有 `coverMediaId`，前端必须再查 media list 才能找到 URL；卡片列表不查。
3. **公开分享不返回媒体 URL**：`share-links.service.ts` 的 `publicMedia()` 只返回 variants key，照片无法显示。
4. **生产 S3 公网出口不存在**：
   - `S3_ENDPOINT=http://minio:9000`（API/Worker 内网）。
   - MinIO 9000 未映射到宿主机；仅 console 端口映射。
   - Nginx 只代理 `/v1` 与 Admin/Web，没有 `/media` 或媒体子域。
   - `S3_PUBLIC_BASE_URL` 在 `.env.example` 存在，但 API 配置未读取，是死配置。
   - 签名 URL 的 host 是 `minio:9000`，浏览器无法解析。
5. **没有单媒体 GET**：上传完成后 Web 只能轮询 trip media list，不能 `GET /v1/media/:id`。
6. **PATCH trip 可直接写 `coverMediaId`，绕过 `setCover` 的 ready/trip 校验**；可把同 workspace 其他 trip 的图片设为封面，形成跨 trip 泄漏。
7. **没有孤立媒体清理**：上传后未绑定 trip 的 pending Media 不会被 maintenance 清掉。
8. **封面替换/删除语义未在 UI 表达**：替换应保留旧照片；删除封面应只解绑，不删照片。

### 6.3 推荐生产架构（首选）

使用**独立媒体子域 + 私有 bucket + 签名 URL**，不改上传协议：

```text
浏览器 ──PUT presigned──> https://media.spacedo.org/roamlog/<key>
浏览器 ──GET presigned──> https://media.spacedo.org/roamlog/<key>
API/Worker ──内部──> http://minio:9000
```

配置改造：

- 新增 `S3_PUBLIC_ENDPOINT=https://media.spacedo.org`，仅供签名客户端使用；API/Worker 仍用 `S3_ENDPOINT` 做内部读写。
- 在 `StorageService` 中维护两个 S3Client：internal 与 public-signing；`createPresignedUpload/createSignedReadUrl` 使用 public client。
- DNS：`media.spacedo.org` → 同一入口；Nginx 增加 `server_name media.spacedo.org`，`proxy_pass http://minio:9000`，保留 Host，TLS。
- bucket 保持 private；MinIO CORS 允许 `PUT, GET, HEAD`，allowed origin `https://we.spacedo.org`，allowed headers `content-type`。
- `Content-Security-Policy` 的 `img-src` 增加 `https://media.spacedo.org`。
- 增加 `MEDIA_SIGNED_URL_TTL=3600`，与导出 TTL 解耦；当前媒体读取错误复用了 `EXPORT_SIGNED_URL_TTL=900`。

为什么不用同域 `/media/` 路径前缀：S3 SigV4 对 canonical path 签名，Nginx 去掉前缀会导致签名不匹配；除非改写成 MinIO 识别的根路径，复杂度高于子域。

备选：由 API 流式代理上传/读取（`POST /v1/media/upload` + `GET /v1/media/:id/content`）。安全性最好、无需暴露 MinIO，但会增加 Nest 内存/带宽与 Range/缓存实现，不建议在本轮引入。

### 6.4 上传流程（用户端）

**新建旅行**：

1. 用户选择封面，前端本地校验 MIME/≤25MB，`URL.createObjectURL` 预览。
2. 用户提交表单 → `POST /v1/workspaces/:id/trips`（不含封面）。
3. 创建成功后，用 `tripId` 调 `POST /v1/workspaces/:id/media/presign`。
4. 浏览器 PUT 到 presigned URL（带 `Content-Type`）。
5. `POST /v1/media/:id/complete` → status `processing`。
6. 轮询 `GET /v1/media/:id`（新增）直到 `ready` 或 `failed`；ready 后 `POST /v1/trips/:tripId/cover`。
7. 上传失败：保留 trip，详情显示“封面待重试”，重新 presign；不阻塞旅行保存。

**编辑旅行**：

1. 选择文件 → presign（带 `tripId`）→ PUT → complete。
2. 轮询 ready → `POST /v1/trips/:tripId/cover`。
3. 旧封面不删除，只改 `Trip.coverMediaId`；照片墙仍保留旧图。

**失败与重试**：

- PUT 失败：指数退避 3 次；presign 过期则重新 presign。
- complete 失败：显示具体错误（MIME mismatch、size mismatch），允许重新选择。
- worker 失败：Media.status=`failed` + error；UI 提供“重新处理”入口（可复用 complete 的幂等重入队）。

### 6.5 契约变更（封面）

新增派生类型，不把 storage key 暴露给用户端：

```ts
SignedAssetSchema = {
  url: string,
  expiresAt: string,
  width: number | null,
  height: number | null
}

TripCoverSchema = {
  mediaId: string,
  status: "pending" | "processing" | "ready" | "failed",
  thumbUrl: string | null,
  largeUrl: string | null,
  width: number | null,
  height: number | null,
  blurhash: string | null,
  expiresAt: string | null
}

TripSchema += { cover: TripCoverSchema.nullable(), durationDays: number }
```

- `Trip.coverMediaId` 保留用于写入；`cover` 用于读。
- `GET /v1/trips/:id`、list、create/update/set-cover 都返回投影后的 `cover`。
- `PublicTripResponse.trip.cover` 同样返回，但只对 ready 媒体生成 URL；公开响应不得包含 `bucket/key`。
- `PublicTripResponse.media[]` 增加 `url`/`thumbUrl`，移除原始 variants key。
- 新增 `GET /v1/media/:mediaId`，返回带 URLs 的 `Media`，用于完成轮询。
- `PATCH /v1/trips/:tripId` 的 `coverMediaId` 要么移除（强制走 `/cover`），要么复用 `setCover` 同款校验：ready + `media.tripId == tripId` 或未绑定。

### 6.6 DB 与权限

- 不需要新表；`Trip.coverMediaId` 与 `Media` 已存在。
- 建议新增 `Media` 的 `updatedAt` 索引/清理查询已有；为孤儿清理新增 maintenance 查询条件：`status in (pending, failed) AND createdAt < now()-7d AND cover relation null AND entryMedia none AND expenseReceipts none`。
- 权限：`media:presign`/`complete`/`trip:set-cover` 已限定 editor+；Viewer 不可上传。公开分享只通过 share token 读取，不走 workspace session。
- 安全：上传文件必须校验真实 MIME（已有），限制像素（已有 width/height 上限），拒绝 SVG/GIF（当前 MIME 白名单正确）。
- HEIC：契约允许，但目标镜像 sharp 是否带 HEIF 解码未验证；未验证前 UI 只承诺 JPEG/PNG/WebP/AVIF，HEIC 走“转换后上传”或服务端拒绝并提示。

---

## 7. 地点/路线/搜索方案

### 7.1 现状

- 没有地点搜索 API；OpenAPI 无 `/places` 路径。
- `apps/web/components/map/city-search.tsx` 直接 `fetch` Photon（浏览器到外部），带 450ms debounce；无服务端缓存、无鉴权、无统一错误码。
- 搜索结果只进入地图组件本地 state；`TripMap` 的 `addCity` 不调用 Stop API，刷新即丢失。
- `Stop` 已是完整的途经点模型：`city/country/countryCode/lat/lng/startDate/endDate/notes/order/version`，并有 CRUD/reorder API。
- `Trip.origin` 只有字符串，没有坐标；`destinations` 与 Stop 重复，存在双写不一致风险。
- 没有路线几何/道路导航；地图只按 Stop 画线。

### 7.2 目标模型

**以 Stop 作为路线的唯一结构化来源**：

- 出发地：`Trip.origin` + 可选 `originLat/originLng/originCountryCode`；不强制成为 Stop。
- 目的地/途经点：每个地点写一条 Stop；`order` 决定路线顺序；日期必须在 trip 范围内。
- `Trip.destinations` 作为卡片摘要，由 Stop 的城市去重派生并持久化（保留兼容），或由 API presenter 从 Stops 派生；**不要允许 UI 单独编辑 destinations 而后端不更新 Stops**。
- 路线几何：v1 用 Stop 坐标连线即可；不存 polyline。若未来需要真实道路，新增 `Trip.routeGeometry Json?` + OSRM/GraphHopper 服务，属于非目标。

### 7.3 新增契约

```ts
PlaceSchema = {
  provider: "photon" | "local",
  providerPlaceId: string | null,
  name: string,
  country: string,
  countryCode: string,       // ISO 3166-1 alpha-2
  lat: number,
  lng: number,
  timeZone: string | null,   // IANA
  type: "city" | "region" | "country" | "poi" | "other"
}

PlaceSearchQuerySchema = {
  q: string.min(1).max(120),
  limit: int 1..10 default 6,
  lang: "zh" | "en" optional
}

PlaceSearchResponseSchema = {
  items: Place[],
  provider: "photon" | "local",
  degraded: boolean,
  cached: boolean
}
```

### 7.4 新增 API

`GET /v1/places/search?q=&limit=&lang=`

- 需要登录；不要求 workspace（建旅行前就要搜索）。
- 限流：每用户 60 req/min；Redis key 规范化 query，缓存 24h。
- 上游：可配置 `PLACES_PROVIDER=photon|local`、`PHOTON_URL`；默认自托管 Photon，避免公共实例的可用性与合规风险。
- 超时：2.5s；失败返回 200 + `degraded: true` + 本地城市列表，而不是 5xx。
- 日志不记录完整 query（隐私），只记录长度/耗时/结果数。
- 响应不缓存个人信息；地点数据本身可缓存。

### 7.5 降级方案

三层降级：

1. **服务端 Photon** 正常：返回标准化 Place。
2. **Photon 超时/不可用**：返回内置城市种子（建议 200 个高频旅行城市）+ `degraded=true`；UI 标注“简化地点库”。
3. **连 API 都不可用**：允许用户手动输入 `city/country/countryCode`，Stop 的 lat/lng 允许 null；地图显示“未定位地点”列表，不阻塞保存。

禁止：浏览器直连第三方 geocoder 作为唯一数据源；无超时；无 rate limit；把搜索结果只留在组件 state。

### 7.6 前端交互

- `PlaceCombobox`：键盘 ↑↓/Enter/Esc、`aria-activedescendant`、加载/空/降级状态。
- 选中后显示“城市, 国家”，保存 provider/providerPlaceId/lat/lng/timeZone。
- 出发地单选；目的地多选（可拖拽排序）；途经点列表可增删、调整顺序。
- 搜索无结果时提供“手动添加”而不是死路。
- 目的地与 Stop 的提交事务：前端一次提交 stop 列表（或按顺序调用 CRUD），失败可重试；不要先写 destinations 再异步写 Stops 造成半成品。

### 7.7 需要的迁移

建议一条 `0003_place_context_and_budget_checks`：

```sql
ALTER TABLE "Trip"
  ADD COLUMN "originLat" DOUBLE PRECISION,
  ADD COLUMN "originLng" DOUBLE PRECISION,
  ADD COLUMN "originCountryCode" TEXT,
  ADD COLUMN "timeZone" TEXT;

ALTER TABLE "Stop"
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "providerPlaceId" TEXT,
  ADD COLUMN "timeZone" TEXT;

CREATE INDEX "Stop_tripId_provider_providerPlaceId_idx"
  ON "Stop"("tripId", "provider", "providerPlaceId");

ALTER TABLE "Trip"
  ADD CONSTRAINT "Trip_origin_coords_pair_check"
  CHECK (("originLat" IS NULL) = ("originLng" IS NULL)),
  ADD CONSTRAINT "Trip_budget_pair_check"
  CHECK (("budgetAmountMinor" IS NULL) = ("budgetCurrency" IS NULL)),
  ADD CONSTRAINT "Trip_budget_nonnegative_check"
  CHECK ("budgetAmountMinor" IS NULL OR "budgetAmountMinor" >= 0);
```

说明：

- `provider/providerPlaceId/timeZone` 可空，保持旧数据兼容。
- `originLat/Lng` 可空；手动输入的出发地不需要坐标。
- 不新增路线几何表。
- 应用层仍做 IANA timezone 校验；DB 不做时区白名单。

---

## 8. 日期、时区、天数、预算

### 8.1 日期

- `Trip.startDate/endDate`、`Stop.startDate/endDate`、`JournalEntry.date`、`Expense.date` 均为 PostgreSQL `DATE`，Prisma `@db.Date`。
- 契约 `DateOnlySchema` 校验 `YYYY-MM-DD`；服务用 UTC 零点构造 Date，避免本地时区漂移。
- DB 有 `Trip_date_order_check`、`Stop_date_order_check`，`endDate >= startDate`。
- Stops 服务强制日期落在 trip 范围内（`assertDateWithinTrip`）。
- **缺口**：缩短 Trip 日期时不会检查已有 Stop 是否越界；可能产生孤儿日期。应在 PATCH trip 的同一事务中校验 `stops.min(startDate) >= newStart`、`stops.max(endDate) <= newEnd`，或拒绝并给出 `STOP_OUTSIDE_TRIP_DATES`。

### 8.2 天数

- 没有 DB 列；Web `tripDurationDays()` 用 inclusive 计算（含首尾）。
- 建议把该纯函数移到 `packages/contracts`（或 `packages/domain`），API presenter 输出 `durationDays`，避免 Web/Admin/分享页三套实现漂移。
- 用户输入“天数”不应单独存；由日期范围派生，避免三者不一致。

### 8.3 时区

- Workspace 有 `timezone`（默认 `Asia/Shanghai`）。
- Trip/Stop 没有 timezone；Itinerary `startTime/endTime` 是 `HH:mm` 墙钟字符串。
- 跨时区旅行时，日志/行程时间含义不明确。
- 建议 `Trip.timeZone` 可空，默认取 Workspace；Stop 可选覆盖。UI 在日期旁显示 IANA 时区，行程时间标注“当地时间”。
- 若不在本轮做时区，必须在 UI 明确“所有时间按 Workspace 时区”，不能默默假设。

### 8.4 预算

- 当前模型是**整数 minor units + 币种**，不是 Decimal；这是正确选择，避免浮点误差。
- `AmountMinorSchema` 非负整数；`CurrencyCodeSchema` 仅 3 位大写字母正则。
- Create 合约做了 budget pair refine；Update 合约没有（因为允许多字段部分更新），服务在 merge 后 `assertBudgetPair`，行为正确。
- DB 没有 budget pair / 非负 check；生产数据当前无坏值，但应用外写入可能破坏。
- 币种建议用 ISO 4217 允许列表（或 `Intl.supportedValuesOf("currency")`），不要接受任意 `XXX`。
- 费用 `Expense.amountMinor` 有 `>=0` check；`budgetAmountMinor` 没有，需补。

### 8.5 序列化一致性

- API 金额始终是整数 minor units；Web 显示时 `/100`。不要在前端用浮点存储再回传。
- 日期始终 `YYYY-MM-DD`；不要在 PATCH 里传 `Date.toISOString()` 的完整时间。
- `origin/destinations` 的中文占位“未填写”会进入 DB 和公开响应；修复表单后应迁移/清理现有 1 条占位 trip（由产品决定删除或补真实内容）。

---

## 9. 权限、对象级授权、错误码

### 9.1 现有角色模型

`packages/contracts/src/permissions.ts`：

- Viewer：只读 + 评论 + 导出；不能上传、不能改旅行。
- Editor：内容写入（trip/stop/media/expense/packing/share/journal），不能管成员。
- Admin：Editor + 成员/邀请/审计；可读所有 private trip。
- Owner：Admin + 删除/转移 workspace/管理员管理。

### 9.2 对象级授权

- 所有内容 API 先解析 workspace membership，再按 `workspaceId + tripId` 查询，避免跨 workspace。
- `private` trip：创建者、workspace owner/admin 可见；其他 editor/viewer 返回 404（不泄露存在性）。
- **缺口 1**：`TripParticipant` 不参与可见性判断。被加入 private trip 的成员仍看不到，语义不清晰。需要产品决策：
  - 推荐：private = 创建者 + participants + owner/admin；participants 按 workspace role 获得读/写。
  - 或者：participants 只是“同行人名单”，不授予访问；UI 必须明确说明。
- **缺口 2**：PATCH trip 的 `coverMediaId` 只校验同 workspace，未校验 ready / 同 trip，见 6.2。
- **缺口 3**：公开分享的媒体 variants 返回 storage key（虽 bucket private），属于不必要的信息暴露；应改为 URL。

### 9.3 错误码与前端处理

- API 使用 Problem Details：`VALIDATION_ERROR`、`VERSION_CONFLICT`、`TRIP_NOT_FOUND`、`MEDIA_NOT_READY`、`MEDIA_TRIP_MISMATCH`、`SHARE_PASSWORD_INVALID` 等。
- 旅行详情已处理 409 冲突；日志编辑器也有冲突重载/覆盖。
- 新表单必须映射：
  - 400 → 字段级错误；
  - 403 → 权限提示；
  - 404 → 资源不存在/无权限；
  - 409 → 版本冲突对话框；
  - 413 → 文件过大；
  - 5xx/网络 → 可重试，不静默丢输入。

### 9.4 草稿、删除、乐观锁

- 草稿：API 无 draft 字段；不要新增 `Trip.status='draft'` 污染列表/搜索/分享语义。建议 localStorage 自动保存（24h TTL）+ 离开确认；封面的 File 不持久化，只存元数据。
- 删除：API 软删除；UI 用二次确认 + 输入标题确认（高风险），成功后跳转旅行库并 invalidate。
- 乐观锁：Trip/Stop/Entry/Itinerary/Expense/Packing 都有 version；PATCH 必须带 `version`，409 返回最新实体。前端统一 `VersionConflictDialog`。

---

## 10. 日志、照片、行李、分享、评论、通知、Presence

| 功能 | 已有 | 缺口 | 依赖 |
|---|---|---|---|
| 日志 | 真实 API、自动保存、版本恢复、评论、Tiptap；`journal-editor-sheet.tsx` 已接 API | 日志内图片仍是 placeholder；没有从日志直接上传/关联 Media；旅行详情没有日志 tab 入口（独立 /journal 页） | Media 上传、EntryMedia |
| 照片 | Media API、EntryMedia、Expense receipt、Workspace logo、Variant 处理 | 生产 UI 无照片墙/上传/删除/排序；分享页不显示图；Admin 无真实缩略图 | 封面方案、URL 投影 |
| 行李 | Packing API 完整（CRUD/reorder/bulk） | live 无 tab、无 hooks；旧 `packing-tab` 是 mock | Web 组件 |
| 费用 | Expense/Budget API 完整，含 participant split | live 无 tab、无 hooks；旧 `budget-tab` 是 mock | Web 组件 |
| 分享 | API、密码、过期、撤销、公开页、地图页按钮 | 详情页无入口；公开页无封面/照片；公开媒体无 URL；`allowIndex` 未验证 | Media 投影 |
| 评论 | API + 日志评论区真实；通知生成 | 评论目标仅为 `journal_entry`/`itinerary_item`，不支持 trip 级；mention UI 未验证 | 现有；如要 trip 评论需扩契约/迁移 |
| 通知 | API + `/notifications` live；标记已读 | 无实时 `notification.created` 订阅，轮询/刷新才更新 | Socket |
| Presence | 后端 Socket.IO + Redis adapter + trip/workspace rooms；事件契约完整 | Web 无 `socket.io-client`、无 provider、无在线头像/行为；卡片“在线”是按 status 假造 | Web realtime |
| 导出 | API/worker；staging-full 证据 zip 7 文件、图片 roundtrip、匿名 403 | 生产 UI 无导出入口 | Web 按钮 |
| 活动 | API + activity live | 页面文案明确“Socket.IO/presence 未接”；仅本地事件 | Socket |

### 10.1 Presence/实时前端方案

- 新增 `apps/web/lib/realtime.tsx`：`socket.io-client` 连接 `NEXT_PUBLIC_API_BASE_URL` + namespace `/v1/ws`，`withCredentials`；连接时传 `tripId`。
- 订阅 `trip.changed`、`entry.changed`、`itinerary.changed`、`expense.changed`、`packing.changed`、`comment.changed`、`media.ready`、`notification.created`；按事件 invalidate 对应 query；不要整页刷新。
- `presence.joined/left/updated` 写入 Trip presence store；详情头部显示在线成员，超过 5 人折叠。
- 断线重连指数退避，页面隐藏时降频；reduced motion 下不播放脉冲动画。
- Nginx `/v1/ws` 已配置 Upgrade，无需改路由。
- 不用 CRDT；沿用版本号 + 失效广播。

---

## 11. 需要修改的 Schema、契约与 API

### 11.1 Prisma 迁移（只允许一个 owner）

新增 `packages/db/prisma/migrations/0003_place_context_and_budget_checks/migration.sql`，并同步 `schema.prisma`：

| 变更 | 目的 | 兼容性 |
|---|---|---|
| `Trip.originLat/originLng/originCountryCode` nullable | 出发地可上图、可校验坐标对 | 旧数据 null |
| `Trip.timeZone` nullable | 跨时区旅行 | 回退 Workspace |
| `Stop.provider/providerPlaceId/timeZone` nullable | 可搜索地点的稳定标识与当地时间 | 旧数据 null |
| `Stop` 复合索引 | 地点去重/查询 | 非唯一，安全 |
| `Trip` 预算 pair/nonnegative check | DB 完整性 | 现有 0 坏值 |
| `Trip` origin 坐标 pair check | 防止半坐标 | 现有 null |

不新增：

- `Trip.durationDays` 列（派生）。
- 路线几何表（v1 用 Stop 连线）。
- 服务端草稿表（用 localStorage）。
- 新封面表（复用 Media）。

迁移验收：

- 空库 `prisma migrate deploy` 成功。
- 已有 1 条 trip 的库升级成功，默认 null。
- `prisma validate`、`prisma migrate diff` 无漂移。
- 回滚策略：先备份；check 约束用 `NOT VALID` + 验证再切换，或直接 validation（当前数据量极小）。

### 11.2 共享契约变更

文件：`packages/contracts/src/**`（单一 owner）

1. `entities/trip.ts`
   - `Trip.cover: TripCoverSchema.nullable()`
   - `Trip.durationDays: int positive`
   - 可选 `originLat/originLng/originCountryCode/timeZone`
   - `tags` max 20、`destinations` max 30、`guestNames` max 30；去重/trim 规则在服务层。
2. `entities/stop.ts`
   - `provider/providerPlaceId/timeZone` nullable。
3. 新 `api/places.ts`
   - Search query/response、Place schema。
4. `api/media.ts`
   - `GetMediaResponseSchema`（单媒体）。
   - `TripCoverSchema` 或在 trip entity 中定义。
5. `api/share-links.ts`
   - `PublicTripResponse.trip.cover`
   - `PublicTripResponse.media[].url/thumbUrl`
6. `api/trips.ts`
   - 移除 PATCH 的 `coverMediaId`，或类型标注“仅内部/需服务端严格校验”。推荐 UI 只走 `/cover`。
   - `UpdateTripRequest` 保持部分更新；不要加会阻止单字段更新的 budget pair refine。
7. `openapi.json` 重新生成；`packages/api-client` 重新生成；`contracts:check` 必须通过。

### 11.3 API 变更

| 方法/路径 | 变更 | 说明 |
|---|---|---|
| `GET /v1/media/:mediaId` | 新增 | 返回带签名 URL 的 Media，供上传轮询 |
| `GET /v1/trips/:tripId` / list / cover | 修改 Presenter | 返回 `cover` 与 `durationDays` |
| `POST /v1/trips/:tripId/cover` | 保留 | 已是正确写入口；UI 必须使用 |
| `PATCH /v1/trips/:tripId` | 收紧 | `coverMediaId` 复用 ready/trip 校验，或删除该字段 |
| `GET /v1/places/search` | 新增 | 登录、限流、缓存、降级 |
| `GET /v1/public/share/:token` | 修改 | 公开 cover/media URL，不泄露 key |
| `PATCH /v1/trips/:tripId` | 修改 | 日期缩短时校验 Stop 范围 |
| `GET /v1/trips/:tripId` | 修改 | 返回 stops 的 provider/timezone（如新增） |

可选但推荐：

- `POST /v1/media/:mediaId/retry`：复用 complete 的幂等重入队，用于 worker failed。
- `GET /v1/trips/:tripId/cover`：若不想在每个 Trip 投影签名 URL，可返回 302；但列表页仍需封面，优先投影。

### 11.4 不需要改的

- Better Auth / workspace role 主体。
- BullMQ 队列结构；已有 media/email/export/maintenance。
- S3 SDK；只需双 endpoint。
- 日志 Tiptap/revision 模型。
- 评论/通知/分享 token/密码哈希。
- 数据库主键/软删除策略。

---

## 12. 实施波次与文件边界

原则：

- **Wave 0 串行完成共享契约/迁移/存储出口**，否则后续全部返工。
- 一个文件同一时间只有一个 writer。
- 新组件优先放新文件；旧 `trip-detail-live.tsx`/`new-trip-shell.tsx` 由单一 owner 收口。
- 所有 Agent 只改任务包列出的文件；生成物（OpenAPI/api-client）由契约 owner 统一生成。

### Wave 0：共享地基（必须先完成）

| Task | 角色 | 目标 | 可写文件 | 禁止触碰 | 验收 |
|---|---|---|---|---|---|
| `W0_CONTRACTS` | architect | 新 Place/Cover/Media/Public 契约；OpenAPI/api-client 生成 | `packages/contracts/src/**`、`packages/contracts/openapi.json`、`packages/api-client/src/**`、契约测试 | `apps/**`、`packages/db/**` | `pnpm contracts:generate && pnpm contracts:check`；契约测试通过 |
| `W0_DB` | data_worker | 0003 迁移 + Prisma 字段/约束 | `packages/db/prisma/schema.prisma`、`packages/db/prisma/migrations/0003_*`、db 测试 | `apps/**`、`packages/contracts/**` | 空库/现有库 migrate 成功；`prisma validate` |
| `W0_STORAGE` | devops/backend | 双 S3 endpoint、media TTL、CORS/子域文档、env 校验 | `apps/api/src/modules/storage/**`、`apps/api/src/config/**`、`.env.example`、`docker/**`、`deploy/**` | 业务模块、Web 组件 | 单测：签名 host 为 public endpoint；env 缺省失败；`minio-smoke` |
| `W0_EDGE` | devops（生产） | DNS/TLS/Nginx `media.spacedo.org`、bucket CORS、CSP | 服务器配置/部署仓库；不写产品源码 | 数据库 | 浏览器 PUT/GET 200；匿名 GET 403；CORS 预检通过 |

### Wave 1：API 与 Web 数据层

| Task | 角色 | 目标 | 可写文件 | 禁止触碰 | 依赖 |
|---|---|---|---|---|---|
| `W1_TRIP_COVER_API` | backend_api | Trip cover 投影、durationDays、单媒体 GET、PATCH 收紧、公开媒体 URL、孤儿清理 | `apps/api/src/modules/media/**`、`apps/api/src/modules/trips/content-presenters.ts`、`trips.service.ts`、`trips.repository.ts`、`apps/worker/src/jobs/maintenance.ts` | `apps/web/**`、contracts（已冻结） | W0 |
| `W1_PLACES_API` | backend_api | places module、Photon adapter、Redis 缓存、降级、限流 | `apps/api/src/modules/places/**`、`app.module.ts`、places 测试 | trips/media 模块 | W0 |
| `W1_WEB_DATA` | web_frontend | 所有缺失 hooks：stops/media/packing/expenses/share/participants/delete/export；错误映射 | `apps/web/lib/query.ts`、`apps/web/lib/api/**` | 所有 `components/**` | W0 |
| `W1_WEB_REALTIME` | web_frontend | socket client/provider、事件 invalidate、presence store | `apps/web/lib/realtime.tsx`、`apps/web/components/providers.tsx` | `trip-detail-live.tsx`、`app-shell-view.tsx` | W0 |
| `W1_TESTS_API` | qa_verifier | 新 API e2e/契约/权限测试 | `apps/api/test/**`、`packages/contracts/**/*.test.ts` | 产品源码 | W1 API 可运行 |

### Wave 2：旅行主旅程 UI

| Task | 角色 | 目标 | 可写文件 | 禁止触碰 | 依赖 |
|---|---|---|---|---|---|
| `W2_PLACE_UI` | web_frontend | `PlaceCombobox`、手动地点、键盘/a11y、降级态 | `apps/web/components/places/**` | 表单/详情文件 | W1_PLACES_API、W1_WEB_DATA |
| `W2_COVER_UI` | web_frontend | 封面选择/预览/进度/重试/删除；presign→PUT→complete→poll→setCover | `apps/web/components/media/**`、`apps/web/components/trips/cover-upload.tsx` | `new-trip-shell.tsx`、`trip-detail-live.tsx` | W1_TRIP_COVER_API、W1_WEB_DATA |
| `W2_TRIP_FORM` | web_frontend | 全字段新建：封面、标题、简介、出发地、目的地、Stop 途经点、日期、预算、币种、可见性、标签、guestNames、参与者；draft/离开确认 | `apps/web/components/trips/new-trip-shell.tsx`、`apps/web/components/trips/editor/**` | `trip-detail-live.tsx`、`query.ts` | W2_PLACE_UI、W2_COVER_UI |
| `W2_TRIP_DETAIL` | web_frontend | 详情工作台：全字段编辑、封面、标签、协作者、删除/复制/分享入口、tab 容器（预留） | `apps/web/components/trips/trip-detail-live.tsx`、`trip-detail-live-*.tsx` | `new-trip-shell.tsx`、`query.ts` | W2_COVER_UI、W1_WEB_DATA |
| `W2_TRIP_TEST` | qa_verifier | 全字段创建/回显/409/权限/移动端 E2E | `e2e/web/**`、`apps/web/**/*.test.tsx`（仅测试） | 产品组件 | W2 |

### Wave 3：功能 tab（新文件为主，最后由详情 owner 挂载）

| Task | 角色 | 目标 | 可写文件 | 禁止触碰 |
|---|---|---|---|---|
| `W3_PHOTOS` | web_frontend | 照片墙、上传多图、caption/date/location、删除、日志关联 | `apps/web/components/photos/**`、`apps/web/components/trips/photos-tab.tsx` | trip-detail-live、query.ts |
| `W3_PACKING` | web_frontend | 行李分组/勾选/增删/排序/批量模板 | `apps/web/components/trips/packing-tab-live.tsx`、`packing/**` | trip-detail-live、query.ts |
| `W3_BUDGET` | web_frontend | 预算、费用、分摊、结算、图表 | `apps/web/components/trips/budget-tab-live.tsx`、`budget/**` | trip-detail-live、query.ts |
| `W3_SHARE` | web_frontend | 详情分享入口、密码/过期/allowIndex、公开页封面/照片 | `apps/web/components/share/**`、`apps/web/app/share/[token]/page.tsx` | trip-detail-live（入口由 W2 owner 加） |
| `W3_ADMIN_MEDIA` | admin_frontend | 真实缩略图、桶名配置、孤儿标记 | `apps/admin/components/media/**`、`apps/admin/lib/**`（media 部分） | Web、API |

挂载冲突解决：W2_TRIP_DETAIL 先创建 `trip-detail-tabs.tsx` 注册表并放空占位；W3 只新增 tab 文件，由 W2 owner 或单独的 `W3_INTEGRATE` 一次修改注册表。不要让 4 个 Agent 同时改 `trip-detail-live.tsx`。

### Wave 4：实时与协作

| Task | 角色 | 目标 | 可写文件 | 禁止触碰 |
|---|---|---|---|---|
| `W4_PRESENCE` | web_frontend | 详情头像/在线数/断线重连；通知实时 | `apps/web/components/presence/**`、`app-shell-view.tsx`（仅通知入口） | 详情主体（用注册表插槽） |
| `W4_REALTIME_QA` | qa_verifier | 双浏览器 presence、失效、断线重连 | `e2e/live/**`、`e2e/staging/**` | 产品源码 |

### Wave 5：验收与发布

| Task | 角色 | 目标 |
|---|---|---|
| `W5_QA` | qa_verifier | 全量 typecheck/build/test/e2e/a11y/visual/security；输出证据 |
| `W5_PROD` | devops | 生产媒体子域、TLS、CORS、Mailpit→Resend、备份/回滚演练 |
| `W5_REVIEW` | reviewer | 独立 review，不写被审文件 |

### 12.1 建议的首批派工顺序

1. `W0_CONTRACTS`（1 人）
2. `W0_DB` + `W0_STORAGE`（2 人并行，均不碰 contracts）
3. `W0_EDGE`（运维，可并行）
4. 合并后同时启动 `W1_TRIP_COVER_API`、`W1_PLACES_API`、`W1_WEB_DATA`、`W1_WEB_REALTIME`
5. 合并后启动 `W2_PLACE_UI` + `W2_COVER_UI`，再启动 `W2_TRIP_FORM` + `W2_TRIP_DETAIL`
6. 功能 tab 与 QA 并行

---

## 13. 测试计划

### 13.1 现有覆盖（事实）

- 30 个 API 单测 spec 文件。
- 25 个 API e2e spec 文件；约 143 个 `it/test` 用例（API + Playwright 合计，粗略计数）。
- 已有：认证/2FA、workspace、trip CRUD、stops、itinerary、entries、comments、share、notifications、realtime、storage、staging security/email/export、Web/Admin E2E、a11y/visual。
- `e2e/staging-full/evidence/latest.json`：媒体 ready、7 variants、签名读 200、匿名 403、导出 zip、邮件 Mailpit、队列边界通过。
- 生产 `journey.spec.ts` 只覆盖：登录 → 新建（标题/日期）→ API 回读 → 移动端无横向溢出。

### 13.2 必补测试

| 层 | 测试 | 验收 |
|---|---|---|
| 契约 | Place/Cover/Media/Public 序列化；budget pair；日期；durationDays | `contracts:check`、契约单测 |
| DB | 空库迁移、现有库迁移、check 约束、回滚 | `prisma validate`、migrate deploy 两次 |
| API | 全字段 POST/PATCH 回显；cover ready 校验；跨 trip cover 拒绝；单媒体 GET；stops 日期越界；private participant 策略 | e2e 200/400/403/404/409 |
| 媒体 | presign→PUT→complete→poll→setCover；错误 MIME/超大/中断/重试；删封面不删图；孤儿清理 | staging-full 扩展 + 生产 smoke |
| 分享 | 公开页封面/照片；密码；过期；撤销；allowIndex；匿名无 key | e2e |
| Web | 新建全字段→刷新回显；编辑全部字段；草稿恢复；409 冲突；删除；空/错误/网络失败 | Playwright |
| Mobile | 表单 390px、键盘、底部安全区、图片上传 | Playwright mobile |
| A11y | Combobox 键盘/aria、上传焦点、错误播报、reduced motion | axe + keyboard |
| 权限 | Owner/Admin/Editor/Viewer 四角色对 trip/stop/media/share/expense/packing；private/participant | API e2e |
| Realtime | 双浏览器 presence、trip.changed 失效、断线重连、通知 | Playwright 双 context |
| 安全 | 上传魔数、路径穿越、公开 key 泄漏、CSP、rate limit | staging security gate |

### 13.3 验证命令

```bash
pnpm contracts:generate
pnpm contracts:check
pnpm api-client:generate
pnpm --filter @roamlog/db test
pnpm --filter @roamlog/api typecheck
pnpm --filter @roamlog/api test
pnpm --filter @roamlog/api test:e2e
pnpm --filter @roamlog/web typecheck
pnpm --filter @roamlog/web test
pnpm --filter @roamlog/web build
pnpm --filter @roamlog/admin build
pnpm --filter @roamlog/worker test
pnpm e2e
pnpm e2e:staging
pnpm e2e:a11y
pnpm k6:staging:smoke
```

生产媒体验收（只读/测试账号）：

1. 上传 1 张 JPEG，确认 presigned host 为 `media.spacedo.org`。
2. 确认 PUT 200、complete 202/200、media ready。
3. 确认 `<img>` 加载 thumb/large，匿名直链 403。
4. 替换封面，确认旧图仍在照片列表。
5. 删除封面，确认 Trip.cover=null 且 Media 未删。
6. 公开分享页显示封面/照片，响应不含 bucket/key。

---

## 14. 生产数据检查（只读，无 PII）

### 14.1 迁移

| 项 | 结果 |
|---|---|
| 已应用迁移 | 2 |
| 未完成 | 0 |
| 回滚 | 0 |
| 最新 | `0002_two_factor_state` |
| 结论 | schema 与本地迁移一致，无 drift 证据 |

### 14.2 业务计数

| 项 | 计数 | 判断 |
|---|---:|---|
| 用户 | 2 | 1 super_admin、1 admin；无普通用户 |
| 2FA | 1 | 仅 1 个账号启用 |
| Workspace | 2 | 均只有 owner |
| Editor/Viewer | 0 | 协作角色未验证 |
| Trip | 1 | 占位数据 |
| 封面/预算/标签/guestNames | 0 | 未使用 |
| Stop/Entry/Media/Share/Expense/Packing/Comment/Notification | 0 | 空产品 |

### 14.3 演示/测试数据判断

- **没有发现完整 seed 数据集**（seed 通常会生成多用户、多 trip、日志、媒体）。
- 当前 1 条 trip 明显由 UI 骨架创建：`origin='未填写'`、`destinations=['未填写']`、无封面/预算/标签。
- 2 个默认高权限账号是 bootstrap 结果；1 个启用 2FA。报告不输出账号标识/邮箱。
- 生产环境仍运行 `docker/compose.staging.yml` 与 Mailpit；更准确的称呼是“公网 staging/预生产”，不是已完成生产发布。

### 14.4 队列与 Worker

- media/email/export 三队列 wait/active/failed/delayed 均为 0。
- ingress 0。
- Worker ready，队列声明包含 reminders/maintenance。
- 无失败任务积压；无法据此证明真实上传可用（因为没有 media）。

### 14.5 生产配置风险

| 配置 | 现状 | 风险 |
|---|---|---|
| `S3_ENDPOINT` | `http://minio:9000` | 签名 URL 浏览器不可达 |
| `S3_PUBLIC_BASE_URL` | 空/未使用 | 死配置，误导 |
| MinIO 9000 | 未发布 | 无公网上传/读 |
| Nginx `/media` | 不存在 | 同上 |
| `EXPORT_SIGNED_URL_TTL` | 900s，被媒体复用 | 图片 URL 15 分钟过期 |
| 邮件 | Mailpit | 不发真实邮件 |
| 对象存储对象 | 未可靠枚举 | DB media=0；无法验证图片显示 |

---

## 15. 风险与未验证项

| 风险 | 等级 | 说明 | 建议 |
|---|---|---|---|
| 生产 S3 签名 host 内网 | P0 | 封面/照片上传与显示都会失败 | Wave 0 先修，不要等 UI 完成 |
| 旅行表单仍写占位值 | P0 | 新数据继续污染 origin/destinations | 表单上线前停止使用当前创建页或加 feature flag |
| 私有 trip 与 participant 语义 | P1 | 被加入的成员仍看不到；产品或权限需决策 | 明确策略并加测试 |
| PATCH cover 跨 trip | P1 | 可能把别的 trip 图片设为封面并公开 | 复用 setCover 校验 |
| 缩短日期导致 Stop 越界 | P1 | 数据不一致 | PATCH trip 事务校验 |
| 签名 URL 过期 | P1 | 页面长时间停留后图片裂 | 1h TTL + 重新获取/代理 |
| HEIC | P2 | 契约允许但镜像解码未验证 | 生产 smoke 或限制格式 |
| `archived` 状态 | P2 | UI 提交非法枚举 | 删除该选项 |
| 旧 mock 页面 | P2 | Atlas/Insights/旧 tab 在生产仍可能显示 fixture | 按 DATA_MODE 移除或接 API |
| Admin 桶名硬编码 `roamlog-local` | P2 | 运维误判 | 从配置/接口返回 |
| OpenAPI 无 Swagger UI | P2 | 联调不便 | 可选 `/v1/docs`，不阻塞 |
| 没有真实 Resend/OAuth | P1 | 生产发布条件未满足 | 发布前配置并演练 |

### 未验证项

1. 真实浏览器到 `media.spacedo.org` 的 CORS/PUT（当前无该域）。
2. HEIC/HEIF 在 rc.3 worker 镜像中的 sharp 解码。
3. 公开分享页图片布局与移动端视觉。
4. 2 个 bootstrap 账号的实际登录/2FA 恢复流程（未做写操作）。
5. 生产备份恢复、迁移回滚、Docker digest 审查。
6. 生产 k6/安全 gate 的最近一次结果（本地 staging-full 通过，不等于生产）。

---

## 16. 验收证据

### 16.1 代码/契约证据

| 证据 | 路径/行 |
|---|---|
| 新建表单仅 4 字段并硬编码占位 | `apps/web/components/trips/new-trip-shell.tsx:22-69`、`:107` |
| 详情仅编辑 3 字段 | `apps/web/components/trips/trip-detail-live.tsx:118-139`、`:416` |
| 详情封面为渐变 | `apps/web/components/trips/trip-detail-live.tsx:188` |
| 查询层无 stops/media/packing/expense/share hooks | `apps/web/lib/query.ts`（仅 trips/entries/itinerary/comments/notifications/members/search） |
| Trip 响应无 cover | `packages/contracts/src/entities/trip.ts:10-38` |
| Create/Update 支持全字段 | `packages/contracts/src/api/trips.ts:10-103` |
| Media presign/complete/setCover | `apps/api/src/modules/media/media.service.ts:56-197`、`:336-390` |
| Media list 已生成签名 URL | `apps/api/src/modules/media/media.service.ts:397-440` |
| 公开分享不透出媒体 URL | `apps/api/src/modules/share-links/share-links.service.ts:236-246` |
| S3 配置只读 internal endpoint | `apps/api/src/config/app-config.service.ts:168-174`、`docker/compose.staging.yml:162-165` |
| `S3_PUBLIC_BASE_URL` 未使用 | `.env.example:71`（配置无读取） |
| 无 places 契约/路由 | OpenAPI paths 无 `/v1/places/*` |
| Presence 后端完整 | `apps/api/src/modules/realtime/realtime.gateway.ts`、`packages/contracts/src/events/realtime.ts` |
| Web 无 socket client | `apps/web/package.json` 无 `socket.io-client`；无 provider |
| Admin 媒体渐变/桶名硬编码 | `apps/admin/components/media/media-view.tsx:43`、`:133` |
| Staging journey 仅最小创建 | `e2e/staging/journey.spec.ts:7-61` |

### 16.2 生产只读证据

- Docker：web/api/admin/worker `v0.1.0-rc.3`，全部 healthy。
- `/v1/ready`：200，database/redis/storage up。
- DB：2 migrations，0 unfinished，0 rolled back。
- 计数：2 users（1 super_admin + 1 admin），2 workspaces，1 trip，0 entries/stops/media/share。
- Trip：cover null、budget null、tags 空、guestNames 空、origin/destinations 均为“未填写”。
- Redis：media/email/export wait/active/failed/delayed 均 0；ingress 0。
- Nginx：`/v1/` 与 `/v1/ws` 存在，无 `/media`；`server_name we.spacedo.org`。
- 邮件：Mailpit 容器，不是外部 Resend。

### 16.3 本地集成证据

- `e2e/staging-full/evidence/latest.json`：`status=passed`，媒体 ready、7 variants、签名原图/缩略图 200、匿名 403、导出 zip 7 文件、队列边界 verify、cleanup 完成。
- 该证据是 **Windows 本地隔离环境**（本地 Postgres/MinIO/Mailpit），不是生产。

---

## 17. 优先级汇总

### P0（没有它就不能称为完整 v1）

1. 旅行全字段创建/编辑（含 origin/destinations/Stop）。
2. 封面端到端（UI + public S3 + Trip cover 投影）。
3. 地点搜索 API + 可搜索下拉 + 手动降级。
4. 旅行详情工作台（字段、tab、分享/删除入口）。
5. 生产媒体出口（DNS/TLS/Nginx/CORS/CSP）。

### P1（完整 v1 必需）

6. 照片墙与分享页图片。
7. 行李/费用 tab。
8. 日期编辑、时区、预算校验、DB check。
9. 标签/协作者/参与者 UI。
10. 草稿、删除、409 冲突 UI。
11. Presence/实时失效。
12. 权限测试（四角色/private/participant）。
13. 真实 Resend/OAuth（发布条件）。

### P2（打磨/后续）

14. 旅行复制、导出入口、mention UI（trip 级评论需另立契约，不在本轮默认范围）。
15. Admin 媒体真实预览/配置桶名。
16. `durationDays` 共享、Swagger UI、旧 mock 页面清理。
17. HEIC、孤儿媒体清理、CDN。

---

## 18. 最终建议

1. **先派 `W0_CONTRACTS`、`W0_DB`、`W0_STORAGE`/`W0_EDGE`，不要先派旅行表单。** 表单依赖 Place/Cover 契约和可用的媒体 URL。
2. **契约冻结后，API 与 Web 数据层并行**；`W1_TRIP_COVER_API` 与 `W1_PLACES_API` 不共享文件。
3. **旅行表单与详情分别由两个 owner 收口**；功能 tab 只写新文件，通过注册表挂载，避免同时改 `trip-detail-live.tsx`。
4. **封面不要在新建 POST 里直接塞 `coverMediaId`**，先建 trip 再上传/设封面；这样失败可重试，不会产生半成品或孤儿。
5. **把生产 S3 出口当作发布 gate**，在 UI 完成前先验证浏览器 PUT/GET；否则所有媒体验收都是假通过。
6. **清理当前 1 条占位 trip**（产品决定删除或补真实字段），并在表单修复前加 feature flag，避免继续产生“未填写”数据。
7. **补测试再宣布完成**：全字段回显、封面、权限、分享图片、移动端、双浏览器 presence；这些是目前 staging journey 没覆盖的。

---

## 19. AGENTS.md 交付格式

```text
状态: DONE
任务 ID: audit_stack_gap
变更文件: .audit/2026-11-18-fullstack-gap-audit.md, .audit/2026-11-18-fullstack-gap-audit.checkpoint.md
实现摘要: 只读审计 Web/Admin 字段与功能，逐项映射 NestJS API、Prisma/PostgreSQL、BullMQ/Worker、S3、OpenAPI/Zod；产出 gap matrix、封面/地点/日期预算方案、迁移/契约变更、并行波次、测试计划、生产只读数据检查。
验证命令与结果: git status --short（仅 .audit/ 产物）；生产 /v1/ready 200；DB 2 migrations/0 failed；Redis 队列 0 积压；见报告第 16 节。
截图/日志/接口证据: 见报告第 16 节；未执行生产写操作，未输出 PII。
已知风险: 生产 S3 签名 host 为内网、DB media=0、Mailpit 非 Resend、private participant 语义未决、PATCH cover 可跨 trip、HEIC 未验证。
未覆盖项: 真实浏览器封面上传、生产 CORS/DNS/TLS、备份恢复、生产 k6/security gate、2FA 恢复演练。
建议的下一步: 先派 W0_CONTRACTS + W0_DB + W0_STORAGE/EDGE，再并行 W1 API 与 Web 数据层。
```
