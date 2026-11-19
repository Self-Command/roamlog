# Roamlog 生产化补全设计（2026-11-19）

状态: 待你批准
作者: 根 Agent（产品/架构）｜后续实现交子 Agent

---

## 1. 意图与为什么

Roamlog 已在 `https://we.spacedo.org` 上线（rc.4）。当前问题不是"功能不够多"，而是**它还不是一个能自己运营的产品**：

- 站点行为（SEO、主题、邮件、存储、压缩、AI、地图数据源）全部写死在环境变量里，改一次要发一次版；
- 后台只有 10 个页面，且 `/admin/content` 的"举报"从未实现（假功能）；
- 地点搜索依赖公开 Photon，中文与 POI 覆盖差、`timeZone` 永远为空；
- 图片压缩/派生全部压在服务器；
- 没有 AI 规划，用户要手填十几个字段。

目标：把这些补成**可自助运营的生产系统**——所有配置在后台可改、所有按钮真实可用、没有一处开发残留。

## 2. 目标 / 非目标 / 反目标

**目标**
1. 后台可配置：站点/SEO/主题/邮件/存储桶/图片压缩/AI 供应商/地点数据源/限流。
2. 后台可管理：用户信息编辑、角色与权限矩阵、内容审核（真实举报队列）、工作区详情。
3. 地点搜索全球可用、中文优先、带时区与稳定 id。
4. 图片处理下沉到浏览器；支持 iOS Live Photo（静图 + 动图）。
5. AI 对话式规划：自然语言 → 结构化行程草稿 → 一键填入表单。
6. 生产环境零开发语义文案、零 mock 代码路径。

**非目标**
- 不做实时协同/CRDT（维持现有异步协作）。
- 不做移动 App。
- 不自建地理数据库（用户已决定：只用免费第三方 API）。
- 不做多租户 SaaS 计费。

**反目标（做到也视为失败）**
- 任何"看起来能点但没反应"的按钮。
- 任何硬编码的假统计、假举报、假成员。
- 任何要求用户理解"API / fixture / data mode"的界面文案。
- 配置改了却不生效（需重启且无提示）。

## 3. 约束

| 约束 | 值 | 影响 |
|---|---|---|
| 服务器 | 8C/16G，磁盘 58G（已用 35G，**余 23G**） | 不能自建地理库、不能存大量图片缓存 |
| 技术栈 | Next.js 16 / NestJS / Prisma / Postgres / Redis / BullMQ / MinIO | 不换栈 |
| 地点数据 | **仅免费第三方 API** | 必须做缓存与配额控制 |
| AI | **仅 OpenAI Chat / OpenAI Responses / Anthropic Messages 三协议**，baseURL/key/model 用户可配 | 适配层而非绑定 SDK |
| 上线 | GitHub Actions 构建镜像 → 拉取部署 | 每次发布必须有 tag |
| 测试 | **不在生产服务器上做验证**；**优先本地热更新**（web/admin/API 各自 dev 进程 + embedded PG/Redis 桩） | 只有热更新覆盖不到的部分（worker 队列、真实 S3 上传、容器网络）才用本地 Docker；**镜像只由 GitHub Actions 构建** |
| 部署节奏 | **各阶段本地验收；全部阶段完成后一次性部署生产（rc.5）** | 生产只做最终验收，不做逐阶段上线 |
| AI 实测 | 本地 **magpie** 网关 `http://127.0.0.1:3425/v1` | 三种协议（chat/responses/messages）已实测可用，模型 `auto/deepseek-v4.1-flash` |
| 生产纪律 | 禁止假功能、禁止开发文案 | 清理与验收标准 |

## 4. 工作流 A：生产表面清理（P0，先做）

**问题**：`LIVE API`、`3001 演示预览 · 不发送后台数据请求`、`本地演示数据（非真实）`、`MSW 只在 development / test 环境启动`、`ADMIN API ERROR` 五类内部语义出现在用户界面；mock/fixture 代码仍在仓库且被 typecheck/lint。

**做法**
- 全部替换为用户能理解的语言（如 `ADMIN API ERROR` → 「加载失败，请稍后重试」+ 详情折叠进开发者可见的 `details`）。
- 删除所有"演示模式"UI 分支与徽标；`packages/api-mocks` 与 `legacy-mock` 从工作区移除（保留 git 历史）。
- `NEXT_PUBLIC_DATA_MODE` 彻底删除，数据源只剩真实 API。
- 验收：`grep -rEi "msw|fixture|mock|demo|data mode" apps/web/components apps/admin/components` 仅命中测试文件。

**不做的**：不重构页面结构，只删假的东西。

## 5. 工作流 B：后台系统设置与治理（最大的工程）

### B1 配置模型（我的决定：DB 存配置，带缓存与审计）

**备选**
- (a) 全部环境变量：改配置=改文件+重启，违背"可自助运营"。
- (b) 全部 DB：灵活，但密钥落库需加密，且启动期依赖 DB。
- (c) **混合（选定）**：`Bootstrap 配置`（DATABASE_URL/REDIS_URL/BETTER_AUTH_SECRET/AI 加密密钥）留环境变量；**运行期配置**（站点/SEO/主题/邮件/存储/AI/地点/压缩/限流）进 DB，读时带 Redis 缓存 + 失效广播。

**表** `SystemSetting`
```
id            uuid pk
key           text unique      -- e.g. "site.title", "mail.provider"
group         text             -- general | seo | theme | mail | storage | media | ai | places | limits
valueType     text             -- string | number | boolean | json | secret
value         jsonb            -- 明文值；secret 类型存密文
isSecret      boolean
updatedById   uuid
updatedAt     timestamptz
```
密钥类（SMTP 密码、S3 secret、AI key）用 **libsodium/AES-256-GCM** 加密，密钥来自环境变量 `CONFIG_ENCRYPTION_KEY`；读取接口**永不返回明文**，只返回 `{ set: true, hint: "****abcd" }`。

**生效**：写入后 `CONFIG_CACHE_VERSION` 自增 → 所有实例下一次读取即生效（缓存 TTL 5s）。不需要重启；`AI/S3/邮件` 客户端按"配置版本"懒重建。

**权限**：新增 `admin:settings:read` / `admin:settings:write`；仅 `super_admin` 可写；每次写入写 `AuditLog`（action `admin.settings.updated`，metadata 只含 key 与是否改密文，不含值）。

### B2 设置分组与字段（首版）

| 组 | 字段 |
|---|---|
| general | 站点名、站点描述、默认语言、默认时区、注册开关、邀请开关 |
| seo | title 模板、description 模板、OG 图、robots、canonical 基址、sitemap 开关 |
| theme | 强调色、默认深浅、字体族、登录页文案、页脚文案 |
| mail | provider(resend/smtp)、from、Resend key、SMTP host/port/user/pass、测试发信 |
| storage | endpoint、public endpoint、bucket、region、path-style、access/secret、CORS 校验、测试连接 |
| media | 客户端压缩目标（长边/质量/格式）、是否保留原图、最大上传、允许格式、Live Photo 开关 |
| ai | 供应商列表（name/protocol/baseURL/apiKey/model）、默认供应商、超时、最大 token、是否流式 |
| places | provider(geoapify/photon)、apiKey、语言、limit、缓存 TTL、每日预算上限 |
| limits | 登录/注册/上传/搜索/评论 速率 |

每个字段带：`type`、`default`、`validation`（Zod）、`label`、`help`、`secret`。后台按组渲染表单（`type=json` 用键值编辑器）。

### B3 用户与权限

- **用户编辑**：新增 `PATCH /v1/admin/users/{id}`（name、email（需重发验证）、locale、timezone、platformRole）。新增 `admin:users:update`。
- **权限矩阵页**：把 `packages/contracts/src/permissions.ts` 的 role→action 映射可视化，可编辑的只允许 `super_admin`；改动写 DB 覆盖层（默认仍以代码内矩阵为准，DB 只存 diff），避免代码与数据分叉。
- **工作区**：已有详情/成员/套餐/所有权转移；补"成员角色变更"与"移除成员"。

### B4 内容审核（现在完全假）

**表**
```
Report(id, workspaceId, targetType(trip|entry|comment|media), targetId,
       reason(enum), detail, reporterId, status(open|in_review|resolved|dismissed),
       resolvedById, resolvedAt, resolutionNote, createdAt)
ModerationAction(id, reportId, actorId, action(remove|restore|warn|dismiss), note, createdAt)
```
- 用户端：`POST /v1/reports`（任何角色，限流）；`Entry`/`Trip` 增加 `flagged` 派生视图（不存冗余字段）。
- 后台：真实队列（按 status 分页/筛选/排序）、单条详情（内容快照 + 举报聚合 + 历史）、裁决动作（下架/恢复/驳回）、批量。
- 下架语义：`deletedAt` + `moderationState` 区分"作者删除"与"管理员下架"，作者可见申诉入口。
- 审计：所有裁决写 `AuditLog`。

## 6. 工作流 C：全球地点搜索

**决定**：主源 **Geoapify**（已验证：中文名、`place_id`、`timezone.name`、`formatted`、`rank`、POI）；兜底 **Photon**（无 key）；**不自建**。

**契约变更**（`Place`）
```
+ address: string | null        -- formatted 完整地址
+ timezone: IanaTimeZone | null -- 已有字段，现在真的会填
+ bbox: [number,number,number,number] | null
+ importance: number | null
+ provider: "geoapify" | "photon" | "manual"
  providerPlaceId 保持稳定 id（geoapify place_id / photon osm_type:osm_id）
```
`Stop` 增加 `address` 与 `bbox`（可空），用于展示与地图聚焦。

**配额控制**：输入 ≥2 字符、350ms 防抖、`limit 6`、Redis 缓存（查询 15min / 选中地点 30 天）、后台可设每日上限，超限降级 Photon 并 `degraded:true`。

**中文**：`lang=zh` 直传 Geoapify；Photon 兜底时不传 lang（其不支持 zh）。

**迁移**：开关 `places.provider`（默认 geoapify），回滚切回 photon 即恢复旧行为。

## 7. 工作流 D：媒体管线（客户端优先 + Live Photo）

**决定**：客户端出派生图，服务端只校验。

- 浏览器端（Web Worker + `createImageBitmap` + OffscreenCanvas）：
  - 读 EXIF 方向 → 纠正 → 长边压到 **2000px** → 输出 **WebP q0.82**（可选 AVIF）→ 生成 **320px 缩略图**；
  - 客户端算 **blurhash**（`blurhash` npm，在 worker 内）；
  - 目标体积 ≤1.5MB；另有"保留原图"开关（默认关）。
- 服务端：只做魔数校验、尺寸上限、EXIF **剥离**、可选二次转码（关闭时不跑 sharp）；worker 任务保留但默认只做 blurhash 兜底与病毒/格式复核。
- **Live Photo**：
  - 识别：同一批选择里同名 `.HEIC/.JPG` + `.MOV`，或 MOV 内含 `com.apple.quicktime.content.identifier` 与图片配对；
  - 数据模型：`Media` 增 `motionKey text?`、`motionMimeType text?`、`motionSize int?`、`livePhoto boolean`、`pairedMediaId uuid?`（不做新表）；
  - 展示：静图 + 长按/悬停播放 `<video muted playsinline>`，移动端显示角标；
  - 降级：浏览器不支持 HEIC 解码时，服务端转 JPEG 后再展示（仅这一条保留服务端转码）。
- **存储桶配置**：后台可改 endpoint/bucket/region/keys，改后"测试连接 + 写探测对象 + 验签名 URL 可达"三步；失败则**保留旧配置**并报错，不允许半生效。

## 8. 工作流 E：AI 旅行规划（重点）

**协议适配层**（用户可自定义供应商）
```
Provider = { id, name, protocol: "openai-chat" | "openai-responses" | "anthropic-messages",
             baseURL, apiKeyRef, model, maxTokens, timeoutMs, stream }
```
- 三个 adapter 各自实现 `plan(request) → AsyncIterable<Delta> | Draft`；
- **结构化输出统一走"JSON Schema + 严格校验 + 一次修复重试"**，不依赖某家特有模式：OpenAI Chat 用 `response_format.json_schema`（支持则用，不支持则提示词约束 + 校验）、Responses 用 `text.format`、Anthropic 用 tool-use 强制调用；
- 校验失败 → 把 Zod 错误回灌模型重试 **1 次**，仍失败则返回 `AI_SCHEMA_INVALID`（不落库）。

**接口**（workspace 作用域，沿用现有租户/对象级授权）
```
POST /v1/workspaces/{workspaceId}/ai/trip-plans
  { prompt, hints?: {dates?, budgetMinor?, currency?, style?[], destinations?[]} }
  → 200 { draft: TripPlanDraft, usage: {...}, provider: {...} }
  → 422 AI_SCHEMA_INVALID / 429 AI_QUOTA / 502 AI_UPSTREAM
```
（原计划的 `/v1/ai/trip-plan` 缺 workspace，会绕过租户校验，废弃。）

**关键设计 1：草稿是复合结构，不是 CreateTripRequest**

调研后修正：`CreateTripRequest` 只装得下抬头字段，塞不进 7 天行程/装备/预算分配，且 `destinations: string[]` 有损。

```
TripPlanDraft = {
  trip:     CreateTripRequest            // 复用现有契约
  stops:    CreateStopRequest[]          // 复用
  days:     ItineraryDayDraft[]          // 新：dayIndex, date, items[]
  packing:  CreatePackingItemRequest[]   // 复用
  budgetPlan: { category, amountMinor, currency }[]
  warnings: { code, message, subject }[] // 未解析地点/超预算/日期冲突
}
```

**关键设计 2：模型不产出任何"可验证事实"**

| 字段 | 谁负责 |
|---|---|
| 城市/景点名称 | 模型只输出**候选列表里的序号或名称** |
| 经纬度 | **Places Provider 反查**，绝不由模型生成 |
| 时区 | Places Provider |
| 价格/预算求和 | 服务端按整数 minor unit 求和 |
| 日期序列 | 服务端按 `hints.dates` 计算 |
| `visibility` | 服务端固定为 `private`，不让模型决定 |

**关键设计 3：两套 schema**

`z.toJSONSchema` 表达不了 `packages/contracts` 里的 `superRefine`（endDate≥startDate、budget 成对、originLat/Lng 成对）。因此：
- **模型 schema**：只约束形状（字段/类型/枚举/数组长度）；
- **契约 schema**：模型输出后走现有 Zod 复检，跨字段规则在这里兜底；
- 校验失败 → 把 Zod 错误回灌重试 **1 次**，仍失败 → `AI_SCHEMA_INVALID`。

**关键设计 4：AI 通过工具调用操作产品（不是产出待填草稿）**

参考 Notion MCP（2026-11 官方文档，实测可读）：其官方案例是「一句话建整套结构」，工具为细粒度动作，且**工具以调用者身份运行**、先展示再落库。Roamlog 照此设计。

第一版工具集（**只读 + 只增，绝不提供删除/改权限/改设置**）：

| 工具 | 副作用 |
|---|---|
| `places.search` | 只读 |
| `trips.get` / `stops.list` | 只读 |
| `trips.create` | 增 |
| `stops.add` | 增 |
| `itinerary.addDay` | 增 |
| `packing.add` | 增 |
| `budget.setSummary` | 改（仅该 trip 的预算摘要） |

**两阶段执行（服务端强制，不依赖模型自觉）**
1. `POST /v1/workspaces/{w}/ai/chat` —— 只允许调用**只读工具**收集信息，产出 `{ runId, message, plannedCalls[] }`。**此阶段绝不写库。**
2. `POST /v1/workspaces/{w}/ai/runs/{runId}/execute` —— 用户确认后，按提交的子集顺序**真实执行**；逐条复检授权与校验；部分失败不回滚已成功的；`Idempotency-Key` + `runId` 一次性（Redis 15 分钟）。

**身份与授权**：所有工具以**会话用户的身份**执行，复用 `WorkspaceMembershipAccess` 与既有对象级授权；模型**不得**指定 `workspaceId`/`userId`；多余参数丢弃。

**循环上限** 8 轮，超限 `AI_LOOP_LIMIT`；每次工具调用写审计 `ai.tool_call`（`{runId, tool, ok, entityId, durationMs}`，不含入参全文）。

**后续（本轮不做，已入路线）**
- `Memories`：用户偏好（"喜欢咖啡馆与古寺"、预算习惯），跨会话复用。
- `Skills`：可复用的旅行风格模板（亲子/徒步/美食），workspace 内共享。

**幻觉治理（必须做）**
1. 服务端先调 Places 取候选（≤12 条），把候选（名称/id/国家）注入 prompt；
2. 返回的每个 stop 必须能匹配候选的 `providerPlaceId`；匹配不上 → 丢弃并写入 `warnings[]`（`code: "UNRESOLVED_PLACE"`）；
3. 坐标/时区一律取候选值；
4. 预算非负、币种在允许列表，服务端求和后与 `hints.budgetMinor` 比对，超出则 `warnings`；
5. 日期必须落在 `hints.dates` 内；
6. 提示注入：用户 prompt 与系统指令分离，候选数据以 JSON 注入而非拼接自然语言。

**UI**：`/w/{slug}/ai` 聊天页（SSE 流式），右侧"草稿面板"可逐段编辑，未解析地点以 chip 形式让用户从候选里选；底部「填入新旅行表单」。

**成本**：单次规划 ≤8k 输出；调研给出的量级约 $0.001–0.02/次（视模型）；后台设每日上限与单用户上限。

**分阶段**（不一次做完）
- P1：契约 + golden set（20 条 prompt 的契约测试）+ 三协议 adapter（用 magpie 本地跑通）
- P2：API + SSE + 配额 + 幻觉治理
- P3：Web 草稿面板 + 未解析地点选择器 + 表单预填

## 9. 数据模型变更（一条迁移，串行）

```
SystemSetting          新表
Report / ModerationAction  新表
Media  + livePhoto/motionKey/motionMimeType/motionSize/pairedMediaId
Stop   + address/bbox(Json)/placeId 稳定化
Trip   + aiGenerated boolean default false（标记来源，便于统计与撤销）
```
兼容：全部可空或带默认；空库与现有 3 条 trip 数据都能应用。

## 10. 契约变更（OpenAPI/Zod 同步，一次生成）

`Place`、`Stop`、`Media`、`Trip` 扩字段；新增 `SystemSetting*`、`Report*`、`AiPlan*` 契约与端点；`permissions.ts` 增 `admin:settings:*`、`admin:users:update`、`report:create`、`ai:plan`。

## 11. 实施顺序与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| A | 生产清理 | 文案 grep 0 命中；mock 包移除后 build 绿；线上截图 |
| B1 | 配置底座 + general/seo/theme/limits | 后台改站点名 → 刷新前端生效；写审计；密钥不回显 |
| B2 | mail/storage/media/ai/places 配置 | 各自"测试连接"可用；改错配置被拒且旧值保留 |
| B3 | 用户编辑 + 权限矩阵 + 工作区成员管理 | 四角色矩阵测试；越权 403；审计到位 |
| B4 | 举报与审核 | 用户提交举报 → 后台可筛可裁 → 下架后作者可见申诉；无假数据 |
| C | Geoapify 地点 | 中文/POI/时区/稳定 id e2e；配额耗尽降级 |
| D | 客户端压缩 + Live Photo | 25MB 原图 → <1.5MB 派生；Live Photo 桌面可播、移动有角标 |
| E | AI 规划 | magpie 三协议各跑通；幻觉地点被丢弃；草稿填入表单可用 |

每阶段独立验收（本地热更新 + 必要处 Docker），**全部完成后一次性部署生产 rc.5**，生产只做最终真机验收。

## 12. 风险

1. **AI 幻觉**：即便有候选约束，模型仍可能"编造"行程细节 → 全部标注"AI 建议，请核对"。
2. **免费配额**：Geoapify 3000/天对个人够用；异常流量（爬虫）会打爆 → 必须登录后限流 + 每日上限。
3. **配置化带来的复杂度**：DB 配置 + 缓存 + 加密，一旦出错影响全局 → 必须有"回滚到最后可用配置"按钮与启动期兜底默认值。
4. **Live Photo**：Safari/iOS 支持最好，桌面 Chrome 对 HEIC 解码有限制 → 依赖服务端转码兜底。
5. **迁移风险**：一条迁移改多表，需在真实 PG 上验证空库 + 现有数据。
6. **审计缺失**：配置与审核都必须有 audit，否则无法追责。