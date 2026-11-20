# AI_CHAT_COMPLETE 交付报告

生成时间：2026-11-20 18:58 (+08:00)（最后一轮 e2e `3 passed (53.0s)` 之后定稿）· 11 张截图与 `evidence/*.json` 均来自该轮运行
任务 ID：`AI_CHAT_COMPLETE`
状态：**DONE**（三个 Playwright 用例全部在最终代码树 + 真实栈上通过，retry 均为 0；**边界**：本机无法运行 BullMQ（无真 Redis），媒体处理改由 `.audit/tools/media-drain.mts` 直接调用 worker 的 `handleMediaJob` 完成 —— 即「队列传输」本身没有被验证，见文末「未做 / 阻塞」第 1 条）

---

## 第 0 步功能清单（功能 | 上游 path+行号 | 我们现状）

上游唯一来源：**vercel/chatbot `a8989b522fa3672a2ae52f053105e40993b36ca1`**（Apache-2.0）。
所有行号均为在该 commit 上实测（`git fetch --depth 1 origin a8989b5…` 后本地逐文件 `grep -n` / 编号打印）。

| # | 功能 | 上游 path + 行号 | 我们现状 |
|---|------|------------------|----------|
| 1 | 多模态输入：选图上传 | `components/chat/multimodal-input.tsx` L270–L298（`uploadFile`→`POST /api/files/upload`），L300–L323（`handleFileChange` 立即上传、保留 `uploadQueue`） | **已移植**：上传改为复用既有 media presign→PUT→complete（`media-attachment-adapter.ts`），UI 一致（纸夹按钮 + 隐藏 input）。✅ 已端到端验证（含刷新后仍在） |
| 2 | 图片预览 / 移除 / 上传中 spinner | `components/chat/multimodal-input.tsx` L508–L532（预览行），L615–L636（`AttachmentPreviewItem`），`components/chat/preview-attachment.tsx` L6–L56（96×96 瓦片、`isUploading` 遮罩、hover 删除） | **已移植**：`attachment-preview.tsx`（同样的 96px 瓦片 / 遮罩 / 删除），上传中/完成状态改由 assistant-ui `AttachmentAdapter` 驱动 |
| 3 | 剪贴板粘贴图片 | `components/chat/multimodal-input.tsx` L326–L380 | **已移植**：`thread.tsx` `handlePaste`（`clipboardData.items` → `addAttachment`） |
| 4 | 拖拽上传 | `components/chat/multimodal-input.tsx`（`onDragOver`/`onDrop` 全局监听） | **已移植**：`ComposerPrimitive.AttachmentDropzone` |
| 5 | 附件随消息发送（file/image part） | `components/chat/multimodal-input.tsx` L229–L268（`sendMessage({ parts: [...fileParts, text] })`）；`components/chat/message.tsx` L107–L138（从 `parts` 过滤 file 渲染附件） | **已移植**：image part 进 `content`（含 `providerMetadata.roamlog.mediaId`），`message.tsx` `UserImage` 渲染，`order-first` 复现上游「附件在正文上方」 |
| 6 | 模型选择器 | 组件：`components/ai-elements/model-selector.tsx` L21–L213；实例：`components/chat/multimodal-input.tsx` L786–L913（`PureModelSelectorCompact`）；数据：`app/(chat)/api/models/route.ts` L1–L20；默认值 `lib/ai/models.ts` L1 | **已移植**：`chat-controls.tsx` `ModelSelectorCompact` + 新端点 `GET /v1/workspaces/:id/ai/models`。选择器控件由 Radix Popover+cmdk 换成仓库已有 `DropdownMenu`（适配层，见「模型/思考深度」） |
| 7 | 思考深度（reasoningEffort） | **上游没有用户可见控件**。取值 union 在 `lib/ai/models.ts` L23（`"none"\|"minimal"\|"low"\|"medium"\|"high"`），按模型静态声明在 L47 / L55，透传在 `app/(chat)/api/chat/route.ts` L301–L302（`providerOptions.openai.reasoningEffort`） | **适配层新增控件**（上游无 UI）：`ReasoningSelectorCompact`，取值严格等于 L23 的五个值 + 「默认」。后端按协议透传，Anthropic 协议明确不转发 |
| 8 | 建议提示（空态建议） | `components/chat/suggested-actions.tsx` L17–L82；`components/chat/messages.tsx` L72–L79（空态浮层） | 已有（`thread.tsx` `EmptyState` + `SUGGESTIONS`），本轮未改 |
| 9 | 空态 Greeting | `components/chat/greeting.tsx` L3–L22 | 已有（「先计划，后写入」），本轮未改 |
| 10 | 消息编辑 | `components/chat/message-editor.tsx` L7（`submitEditedMessage`）；`components/chat/message-actions.tsx` L14–L23（`onEdit`） | ❌ **未做**：Roamlog 没有「编辑并重发」的持久化端点；`MessageActions` 的 `onEdit` 入口保留但仍未接线 |
| 11 | 重新生成 | `components/chat/message-actions.tsx`（`Reload` 分支）| 已有：`ActionBarPrimitive.Reload` |
| 12 | 复制 | `components/chat/message-actions.tsx`（`Copy` 分支）| 已有：`ActionBarPrimitive.Copy` |
| 13 | 投票（赞/踩） | `components/chat/message-actions.tsx` L14–L23 + `app/(chat)/api/vote/route.ts` | ❌ **未做**：需要新增表与迁移（本任务禁止改 prisma），上游投票也没有中文文案可移植 |
| 14 | 停止生成 | `components/chat/multimodal-input.tsx` L915–L942（`StopButton`） | 已有（`thread.tsx` `StopButton` → `aui.thread.cancelRun()`） |
| 15 | 错误态与重试 | 上游错误经 toast + `Reload`；`components/chat/message.tsx` L261–L324（工具错误文案） | 已有 + 本轮补：错误块红色静止、`data-testid="ai-message-error"`，重试由「重新生成」承担 |
| 16 | 历史侧栏 / 新建 / 删除 | `components/chat/app-sidebar.tsx` L47–L179；`components/chat/sidebar-history.tsx` L101–L364 | 已有（`thread-list.tsx` + `thread-list-adapter.ts`，会话列表来自服务端） |
| 17 | 归档 | **上游此 commit 无归档功能**（全仓 `grep archive` 无非命中） | 我们的 API/适配器有 archive/unarchive，但 UI 未暴露；因为不是上游功能，本任务未补 |
| 18 | 标题生成 | `lib/ai/generate-title.ts` L11（`generateTitleFromUserMessage`）；`app/(chat)/api/chat/route.ts` L227–L233 | 已有（`POST …/title/generate` + 适配器 `generateTitle`） |
| 19 | 移动端抽屉 | 上游用 `components/ui/sheet.tsx`（`ChatHeader` L11–L76 触发） | 已有（`ai-chat.tsx` `drawerOpen` 抽屉 + 移动端头） |
| 20 | **加载 / 思考动画** | `components/chat/message.tsx` L25–L40（`WaitingText` = Shimmer）、L116–L124（`isThinking`）、L355–L357、L398–L414（`ThinkingMessage`）；`components/ai-elements/shimmer.tsx` L27–L78；keyframes `app/globals.css` L278–L285、L287–L298、L353–L362、L364–L366 | **本轮移植**，三态全有可见动效（见下） |
| 21 | 滚动到底部浮钮 | `components/chat/messages.tsx` L139–L155 | 已有（`thread.tsx`，本轮未改） |
| 22 | 工具卡（工具名/状态/耗时/参数/展开） | `components/ai-elements/tool.tsx` L25–L172 | 已有（`cef0b7e`/`6df25df`），本轮把运行中图标换成脉冲圆点 |
| 23 | 快捷键 | `components/chat/multimodal-input.tsx`（Enter 发送 / Shift+Enter 换行；`chat-header` ⌘K 命令面板在侧栏） | 部分：Enter/Shift+Enter 已有；命令面板属应用外壳，不在本页范围 |
| 24 | Artifact / 文档侧栏 | `components/chat/artifact.tsx` 等 | **非目标**：Roamlog 没有 artifact 概念，移植会被丢弃 |
| 25 | 语音/听写、反馈评分 | 上游此 commit 无 | 不涉及 |
| 26 | 图片进模型（多模态推理） | AI SDK `convertToModelMessages`（上游间接依赖，无本项目代码） | **本轮新增**：后端把 image part 转成三种协议的 content part（见「附件链路」） |

---

## 已交付阶段

### Stage 1：加载与进行中动画（DONE，有用例 1 的真实浏览器证据）

三种状态都有可见动效，且终态一定停：

1. **等首字节** —— shimmer 扫光的思考占位。
   - 移植：`WaitingText`（上游 `message.tsx` L25–L40）+ `Shimmer`（`ai-elements/shimmer.tsx` L27–L78，`duration={1}`、`spread=2`、`dynamicSpread = children.length * spread`、250% 背景 + `100% center → 0% center` 扫描）。
   - 我们：`shimmer.tsx` + `.roamlog-ai-shimmer`（keyframes `ai-motion.tsx`），`message.tsx` 的 `AssistantProgress` 在 `content.length === 0 && status === running` 时渲染它，并在 `thread.tsx` 补了上游 `messages.tsx` L106–L108 的 `ThinkingMessage` 行（首字节前还没有 assistant 行时）。
2. **工具执行中** —— 脉冲圆点 + `progress.label`。
   - 移植：`dot-pulse`（`globals.css` L287–L298 / L364–L366）。
   - 我们：`tool-card-primitives.tsx` 的 `RunningDots`（三个 `roamlog-ai-dot`，`animation-delay` 0/0.16/0.32s）；标签文字仍是「运行中」，工具订阅的 `progress.label`（如「正在查询地点（1/1）」）照旧显示在工具卡行内。
3. **流式输出中** —— 正文下方状态行 + 闪烁光标。
   - 状态行：`data-testid="ai-stream-status"`（三点 + `progress.label`，`min-h-5` 固定高度）。
   - 光标：`ai-motion.tsx` 用 `.roamlog-ai-body[data-streaming="true"] > .roamlog-ai-text:last-of-type > :last-child::after` 在**最后一个文本块的最后一段**画 2px 闪烁竖线（`@keyframes roamlog-ai-caret`）。
4. **终态停止**：完成 → 无动画；错误 → 红色静止文案（`ai-message-error`）；终止 → 「已停止」/「已取消」静止（`ai-run-stopped`）。`data-streaming` 只在 `status.type === "running"` 时为 `true`，所以结束即无光标、无 shimmer、无圆点。
5. **`prefers-reduced-motion: reduce`** → 所有动画 `animation: none`，shimmer 退化为普通 muted 文字（不留透明字）。用例 1 里用 `page.emulateMedia({reducedMotion:"reduce"})` 断言 `animationName === "none"`。
6. **布局不跳动**：思考行/状态行都是 `min-h-5`（=20px），占位始终存在，动画切换不改变高度。

### Stage 2：附件与图片（DONE，含真实浏览器验收）

**本轮为让附件真正可用而修的四处（逐条可复查）**：
1. **渲染**：assistant-ui 把附件放在 `message.attachments`、不并入 `content`，所以补了 `MessagePrimitive.Attachments`（对应上游 `message.tsx` L126–L138 的附件行）。刷新后 image part 在 `content` 里，由 `Parts → UserImage` 渲染，两者不重复。
2. **请求体**：`attachmentsFromMessage()` 同时读 `message.attachments`（本轮会话）与 `content`（刷新后），按 mediaId 去重，再写进 `body.attachments`。
3. **状态机**：`add()` 上传完成后 yield `complete`（带 content），不是 `requires-action` —— 后者会让运行时走 `_prepareSubmission`，最终把附件从消息里丢掉（实测就是「消息里没有图、请求体没有 attachments」）。
4. **持久化**：服务端 `appendUserMessage` 接受 `content` parts 并把 image part 写进历史（原实现只写 `content: input.text` 纯字符串，图片永远进不了历史）；`upsertMessage` 走 `touchConversation()` 更新 `lastMessageAt` 与占位标题（否则会话沉到侧栏底部、刷新后打不开）。

**验收过程中修掉的两个真实缺陷**（不是为测试打的补丁）：
1. assistant-ui 把附件放在 `message.attachments`、不并入 `content` → 补 `MessagePrimitive.Attachments`（对应上游 `message.tsx` L126–L138），并把附件 parts 一起写进请求（`attachmentsFromMessage` 同时读两处）。
2. **服务端持久化原本只存纯文本**：`appendUserMessage` 写的是 `content: input.text`（字符串），所以历史里从来没有 image part，刷新必丢缩略图；`upsertMessage` 也不更新 `lastMessageAt`/标题，客户端写入的会话会沉到侧栏底部、刷新后打不开。现在 `appendUserMessage` 接受 `content` parts、`upsertMessage` 走 `touchConversation()`。

- 契约 `AiAttachmentSchema`：`mediaId`(UUIDv7) + `kind:"image"|"file"` + `name` + `mimeType`（6 种图片白名单）+ `sizeBytes`（≤20 MB），数组 ≤5 条，`.strict()`。`AiChatRequestSchema.attachments` 可选。
- 复用既有 media 链路，**没有新建上传体系**：`media-attachment-adapter.ts` 调 `lib/api/media.ts` 的 `createCoverMediaClient()`（`presign` → `putObjectToSignedUrl` → `complete` → `fetchMedia`），API 侧仍是 `apps/api/src/modules/media/**`。
- 后端把图片变成模型可读 part：`AiPlanService.resolveAttachmentImages()` 用 `MediaService.getOne(actor, membership, mediaId)`（与 media HTTP 路由**同一套** workspace 边界 + `media:read` 权限）拿签名 URL → `fetch` 字节 → `data:<mime>;base64,…`；三个适配器分别转成
  - `openai-chat`：`[{type:"text"},{type:"image_url",image_url:{url}}]`
  - `openai-responses`：`[{type:"input_text"},{type:"input_image",image_url}]`
  - `anthropic-messages`：`[{type:"text"},{type:"image",source:{type:"base64",media_type,data}}]`
  失败统一 400 `AI_ATTACHMENT_INVALID`（未知/未就绪/超限/读不到）。
- 持久化：image part 带 `providerMetadata.roamlog = { mediaId, mimeType, sizeBytes, name, kind }`，随 `content` 落库（`thread-list-adapter.upsertMessage` 保存 `item.message.content`）。刷新后 `UserImage` 若发现图片加载失败，会用 `mediaId` 重新 `fetchMedia` 换新签名 URL，因此过期链接不会留破图。

### Stage 3：模型切换 + 思考深度（DONE，有用例 3 的真实浏览器证据）

- 契约：`model?: string (1..200)`、`reasoningEffort?: "none"|"minimal"|"low"|"medium"|"high"`（**取值逐字来自上游 `lib/ai/models.ts` L23**，未编造）。
- 白名单：`ai.settings.ts` 的 `parseAllowedModels(env, model)` = 管理员在设置里配的 `ai.model`（永远第一位）+ 运维 `AI_ALLOWED_MODELS`（逗号分隔、去重、≤20）。越权请求在 `resolveAdapter()` 抛 **400 `AI_MODEL_NOT_ALLOWED`**（上游 `route.ts` L97–L99 是「不认识就退回默认」，我们选择**显式拒绝**，避免用户以为换了模型却拿到默认模型答案）。
- 选择器的数据来自新端点 `GET /v1/workspaces/:id/ai/models`（上游 `app/(chat)/api/models/route.ts` L1–L20 的对应物），所以 UI 不可能列出服务端不接受的模型。
- 模型名：优先网关 `/models` 的 `display_name`（上游 `getAllGatewayModels` L122–L150 的对应物），失败则 `readableModelName(id)` 兜底，**前端没有硬编码映射表**。实测返回 `DeepSeek V4.1 Flash`。
- `reasoningEffort` 是**真透传**，不是前端假装：`openai-chat` → `reasoning_effort`，`openai-responses` → `reasoning.effort`，值原样转发；`"none"` 用「省略该参数」表达（wire 上没有 none 这个值）。`anthropic-messages` 没有等价字段，**不转发**，UI 对不支持的情况禁用该控件并说明。
  是否被网关真正采纳我们无法从本侧验证——所以报告里明确：**这是透传，不是我们侧生效的开关**。

### Stage 4：清单里剩下的功能

- 见第 0 步表格「我们现状」列：已有的（建议提示、空态、复制、重新生成、停止、历史侧栏、标题生成、移动端抽屉、错误态、工具卡、滚动到底部）保持不动并复核；本轮新增了「附件 / 模型 / 思考深度 / 三态动画」。
- 明确未做：**消息编辑**（无端点）、**投票**（需建表迁移，被禁止）、**归档 UI**（上游无此功能）、**artifact 侧栏**（非目标）、**命令面板**（应用外壳，不在本页）。

---

## 变更文件

新增（全部在允许范围内）：
- `apps/web/components/ai/ai-motion.tsx`（keyframes + reduced-motion + 光标规则）
- `apps/web/components/ai/shimmer.tsx`
- `apps/web/components/ai/chat-selection.ts`（模型/思考深度选择的外部 store）
- `apps/web/components/ai/chat-controls.tsx`（模型选择器 + 思考深度选择器）
- `apps/web/components/ai/media-attachment-adapter.ts`
- `apps/web/components/ai/attachment-preview.tsx`
- `apps/api/src/modules/ai/__tests__/ai-multimodal.spec.ts`
- `e2e/web/ai-chat-complete.spec.ts`

修改：
- 契约：`packages/contracts/src/api/ai.ts`（attachments / model / reasoningEffort / models DTO / 两个错误码）、`packages/contracts/src/__tests__/ai.test.ts`
- 后端：`ai.settings.ts`（allowedModels + reasoningEffort）、`ai-plan.service.ts`（白名单、模型名、附件解析、images 入参）、`ai.controller.ts`（`GET models`）、`ai.module.ts`（import MediaModule）、`adapters/{adapter,openai-chat,openai-responses,anthropic-messages}.ts`
- 后端测试 fixture 同步：`__tests__/{ai-fixtures,conversation.spec,sse.spec}.ts`
- 前端：`message.tsx`（shimmer/状态行/光标/图片）、`thread.tsx`（composer 附件 + 两个选择器 + ThinkingMessage 行 + 动效样式挂载）、`tool-card-primitives.tsx`（脉冲圆点）、`ai-chat.tsx`（attachments adapter + workspaceId）、`chat-model-adapter.ts`（请求体带 attachments/model/reasoningEffort）、`lib/api/ai.ts`（`fetchAiModels` + body 字段）
- 生成物：`packages/contracts/openapi.json`（`contracts:generate`）、`packages/api-client/src/generated/schemas/*4`（`api-client:generate`，**修复的是既有漂移**：这四个 tool 枚举文件本来就和 spec 不一致，与本次功能无关；AI 端点本来就不在 OpenAPI 注册表里，所以没有新增 path）

未触碰：`apps/admin/**`、`packages/db/prisma/**`、`plan-card.tsx`、`copy.ts`。

---

## 移植来源（逐功能）

| 功能 | 来源 |
|------|------|
| 思考占位 / ThinkingMessage / 流式内容布局 | vercel/chatbot `components/chat/message.tsx` L25–L40、L107–L138、L116–L124、L355–L357、L398–L414 @ a8989b5 |
| Shimmer 扫光几何与扫描 | `components/ai-elements/shimmer.tsx` L27–L78（`spread`/`duration`/250%/`100%→0% center`）@ a8989b5 |
| shimmer / dot-pulse keyframes 与 utility | `app/globals.css` L278–L285、L287–L298、L353–L362、L364–L366 @ a8989b5 |
| 空态思考行的挂载时机 | `components/chat/messages.tsx` L106–L108 @ a8989b5 |
| 附件上传 / 预览 / 粘贴 / 提交 | `components/chat/multimodal-input.tsx` L229–L268、L270–L298、L300–L323、L326–L380、L508–L532、L638–L682 @ a8989b5 |
| 附件瓦片（96px/spinner/删除） | `components/chat/preview-attachment.tsx` L6–L56 @ a8989b5 |
| 消息内附件渲染 | `components/chat/message.tsx` L107–L138 @ a8989b5 |
| 模型选择器（结构+数据源） | `components/ai-elements/model-selector.tsx` L21–L213；`components/chat/multimodal-input.tsx` L786–L913；`app/(chat)/api/models/route.ts` L1–L20 @ a8989b5 |
| 模型白名单语义 | `app/(chat)/api/chat/route.ts` L97–L99；`lib/ai/models.ts` L152–L156 @ a8989b5 |
| 网关模型目录 → 显示名 | `lib/ai/models.ts` L122–L150 @ a8989b5 |
| reasoningEffort 取值与透传 | `lib/ai/models.ts` L23、L47、L55；`app/(chat)/api/chat/route.ts` L301–L302 @ a8989b5 |
| 工具运行中指示 | `components/ai-elements/tool.tsx` L25–L172 + `globals.css` L287–L298 @ a8989b5 |

**适配层（为什么不能原样照搬）**：
1. `Shimmer` 上游用 `motion/react` 驱动 `backgroundPosition`。本仓库没有该依赖且任务禁止新增依赖 → 同一几何用 CSS keyframes 实现（属性、数值、方向一一对应）。
2. 上游把 keyframes 放在 `app/globals.css`；本任务只能写 `apps/web/components/ai/**` → 由 `<AiMotionStyles />`（`thread.tsx` 挂载一次）输出同一批规则，类名加 `roamlog-ai-` 前缀防冲突。
3. 上游 shimmer 亮带用 `--color-background`（浅色底上成立）；Roamlog 是纯黑画布，用它等于看不见 → 亮带改用 `--ink`、底色用 `--muted`（设计 token 适配）。
4. 模型选择器上游是 Radix Popover + cmdk `Command`；本仓库没有 cmdk，用已有 `DropdownMenu` radio group 表达同样的「单选列表」。
5. 上传目标：上游 `/api/files/upload`（Vercel Blob）→ 我们的 media presign→PUT→complete（任务要求「不新建上传体系」）。
6. 附件状态机：上游是 `{name,url,contentType}` + 自己的 `uploadQueue` 组件状态；assistant-ui 是 `AttachmentAdapter`（`add`/`send`/`remove` + pending/complete）。用 generator 汇报「上传中 → 可发送」两态，与上游「立即上传、完成后可发」等价。
7. 文案/`aria-label` 全部中文（i18n）、标签用 `@roamlog/ui` 设计 token。
8. 思考深度**没有上游 UI 可移植**，只移植了取值集合与透传位置；控件本身是适配层（已在上文标注）。

---

## 加载动画三种状态的做法（实现要点）

| 状态 | 判定 | 可见动效 | 结束条件 |
|------|------|----------|----------|
| 等首字节 | `thread.isRunning && 最后一行不是 assistant` → `ThinkingMessage`；或 `message.status.running && content.length === 0` → `AssistantProgress` | `Shimmer`（`--spread = 文本长度×2px`，1s 线性无限扫描）+ 头像 | 首个 part 到达 / 终态 |
| 工具执行中 | 工具 part `status.type === "running"`（或 metadata.state 未定） | `RunningDots` 三点脉冲（1.4s，错峰 delay）+ `progress.label` | `tool.end` |
| 流式输出中 | `message.status.type === "running"` 且已有文本 | 状态行三点脉冲 + 光标（`steps(1,end)` 1s 闪烁） | `done` / error / abort |
| 完成 | `complete` | 无 | —— |
| 错误 | `incomplete + reason:error` | 红色静止文案 | —— |
| 终止 | `incomplete + reason:cancelled` | 「已停止 / 已取消」静止 | —— |

用例 1 的实际断言输出（`.audit/ai-chat-complete/evidence/02-terminal.json`）：
```json
{"terminalCounts":{"ai-thinking-skeleton":0,"ai-stream-status":0,".roamlog-ai-dot":0,"停止生成":0},
 "sawToolCard":true,"sawStreamingStatus":true}
```
shimmer 在跑（`evidence/01-waiting.json`）：`animation.name = roamlog-ai-shimmer`，两次采样 `background-position` `95.0002% → 63.3348%`。

---

## 附件链路（复用了什么，图片怎么进模型）

```
浏览器 File
  → media-attachment-adapter.add()            （立即开始，对应上游 handleFileChange）
  → POST /v1/workspaces/:ws/media/presign      （复用，不新建）
  → PUT 签名 URL（XMLHttpRequest，正文二进制）
  → POST /v1/media/:id/complete
  → GET  /v1/media/:id  → MediaRead.url（签名显示 URL）
  → CompleteAttachment.content = [image part + providerMetadata.roamlog.mediaId]
  → 用户点发送：chat-model-adapter 从最后一条 user 消息的 image part 提取 attachments
  → POST /v1/workspaces/:ws/ai/chat/stream  body.attachments = [{mediaId,kind,name,mimeType,sizeBytes}]
  → AiPlanService.resolveAttachmentImages(): MediaService.getOne(actor, membership, mediaId)
     → 取字节 → data:image/...;base64,...  → 适配器转成 image_url / input_image / image(base64)
  → 同一条 user 消息的 content 落库（含 image part），刷新后缩略图仍在（必要时用 mediaId 重签名）
```

**本机环境的两处替身**：对象存储用 `.audit/tools/s3-stub.mjs`（本机无 Docker/MinIO），媒体处理用 `.audit/tools/media-drain.mts` 直接调用 worker 的 `handleMediaJob`（本机无真 Redis，BullMQ 无法运行）。两者都只替换**基础设施**，业务代码、prisma、sharp 图像管线、S3 签名的生成方（真实 `@aws-sdk/client-s3`）都没有被替换；「队列传输」因此没有被验证（见「未做 / 阻塞」第 1 条）。

---

## 模型 / 思考深度

- 白名单：`allowedModels = [管理员配置的 ai.model, ...AI_ALLOWED_MODELS]`，`resolveAdapter()` 校验，越权 400 `AI_MODEL_NOT_ALLOWED`；`GET …/ai/models` 只返回白名单，二者同一来源。
- 名字：网关 `display_name` 优先，`readableModelName` 兜底（`auto/deepseek-v4.1-flash` → `Deepseek V4.1 Flash`）。
- 思考深度：`reasoning_effort` / `reasoning.effort` **真透传**；Anthropic 协议无字段 → 不转发，`reasoningSupported:false` 时 UI 禁用控件。
- 用例 3 截获的请求体（`evidence/05-model-reasoning.json`）：
```json
{"message":"用一句话说说京都","conversationId":"01a1f835-9d4a-768e-b970-ef93431cfdaa",
 "clientMessageId":"eCx0y0P","assistantMessageId":"bRGVbNh",
 "model":"auto/deepseek-v4.1-flash","reasoningEffort":"high"}
```
UI 同屏显示：`DeepSeek V4.1 Flash` / `高`。

---

## 测试清单（名称 + 结果）

| 层 | 命令 | 结果 |
|----|------|------|
| contracts 单测 | `node node_modules/vitest/vitest.mjs run`（`packages/contracts`） | **156 passed**；其中 `ai.test.ts` **41 passed**（新增 6 条：附件上限/白名单/严格模式、reasoning 取值穷举、models DTO、错误码） |
| api 单测 | `node node_modules/vitest/vitest.mjs run src/modules/ai`（`apps/api`） | **177 passed, 28 skipped**（含新增 `ai-multimodal.spec.ts` **9 passed**：三协议 image part 形状 + text-only 不变、`reasoning_effort` 原样 / `none` 省略、responses `reasoning.effort`、anthropic 不转发、allowedModels 解析） |
| web 单测 | `node node_modules/vitest/vitest.mjs run components/ai`（`apps/web`） | **80 passed (9 files)**；全量 `components/ai` 之外：`vitest run` **551 passed (66 files)** |
| tsc（api） | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | **exit 0，0 error**（曾经出现的 4 个已修：3 个 fixture + controller 的 readonly 数组） |
| tsc（web） | 同上（`apps/web`） | **exit 0，0 error**（曾经出现的 2 个已修：`ReadonlyJSONObject` 用对象字面量；`aui.composer.attachment({id}).remove()` 替换不存在的 `removeAttachment`） |
| e2e 用例 1 | `… -g "1\)"` | **PASS，retry=0**；`ANIMATION_STOPPED` 三项计数全 0 |
| e2e 用例 3 | 同上 `-g "model + thinking depth"` | **PASS，retry=0** |
| e2e 用例 2 | 同上 `-g "attachment upload"` | **PASS，retry=0（37.4s）**：上传→预览→发送→消息缩略图→刷新后仍在→390 移动截图 |

e2e 重试：`test.describe.configure({ retries: 2 })`（最多 3 次，原因：网关偶发 `AI_UPSTREAM`）；**最终一轮三个用例全部首次通过（retry = 0）**。

---

## 真实 UI 截图（`.audit/ai-chat-complete/`）

时间戳（+08:00）：**11 张全部来自最后一次全量 e2e（18:56–18:57，`3 passed (53.0s)`）**，即最终代码树 + 真实栈；`evidence/*.json` 与截图同批生成（`evidence/03-attachment.json` 的 `retry: 0`、`attachments` 与 `persistedImagePart` 均为该次运行）。

桌面 1440：
- ![等待 shimmer](./ai-chat-complete/01-waiting-1440.png) `01-waiting-1440.png` — 等首字节，思考行 shimmer + 底部 composer 的模型/思考深度控件
- ![工具运行](./ai-chat-complete/02-tool-running-1440.png) `02-tool-running-1440.png` — 工具卡运行中（脉冲圆点）
- ![流式输出](./ai-chat-complete/03-streaming-1440.png) `03-streaming-1440.png` — 流式正文 + 状态行
- ![终态](./ai-chat-complete/04-final-1440.png) `04-final-1440.png` — 终态（工具卡完成 + 真实检索结果，动画已停）
- ![附件预览](./ai-chat-complete/05-attachment-preview-1440.png) `05-attachment-preview-1440.png` — 附件预览瓦片（上传中/已完成）
- ![附件消息](./ai-chat-complete/06-attachment-message-1440.png) `06-attachment-message-1440.png` — 发送后用户消息里的缩略图
- ![刷新后](./ai-chat-complete/07-attachment-after-refresh-1440.png) `07-attachment-after-refresh-1440.png` — **刷新后**缩略图仍在
- ![移动端](./ai-chat-complete/08-attachment-message-390.png) `08-attachment-message-390.png` — 390px 移动端同一会话
- ![模型选择器](./ai-chat-complete/09-model-selector-1440.png) `09-model-selector-1440.png` — 模型选择器打开
- ![思考深度](./ai-chat-complete/10-thinking-depth-1440.png) `10-thinking-depth-1440.png` — 思考深度选择器（默认 + 五档）
- ![切换后](./ai-chat-complete/11-after-model-switch-1440.png) `11-after-model-switch-1440.png` — 选择「高」之后

移动 390：见 `08-attachment-message-390.png`（同一会话、390×844，附件缩略图仍在，且断言横向溢出 ≤1px）。

---

## 验证命令与结果

1. `cd apps/api && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → `exit=0`，`error TS` 计数 **0**。
2. `cd apps/web && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → `exit=0`，空输出。
3. `node node_modules/vitest/vitest.mjs run components/ai`（apps/web）→ `Test Files 9 passed (9) / Tests 80 passed (80)`。
4. e2e 全量：`E2E_SKIP_WEB_SERVER=1 node node_modules/@playwright/test/cli.js test e2e/web/ai-chat-complete.spec.ts --project=web` → `1 failed / 2 passed (5.5m)`。失败用例的诊断文件原文：
```json
{"outcome":"composer-error",
 "consoleLog":["error: Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
               "error: Failed to load resource: net::ERR_CONNECTION_REFUSED",
               "error: [assistant-ui] Failed to send attachments SignedUrlUploadError: 无法连接对象存储。"],
 "requestSent":false,"composerError":["图片上传失败。"],
 "attachmentsStillInComposer":1,"assistantRows":0}
```
5. 对象存储探测：
```
$ grep '^S3_' .env.local
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=roamlog-local
S3_PUBLIC_BASE_URL=http://localhost:9000/roamlog-local
$ curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://127.0.0.1:9000/
000    (exit 7)
$ docker …  → "docker: command not found"（本 shell 无法启动）
```
6. `GET /v1/workspaces/:id/ai/models`（重启后实测，由任务负责人执行）：`200`，`name` 已是 `DeepSeek V4.1 Flash`。
7. **最终树上的全量重跑（18:56–18:57，一次跑完三个用例）**：
```
E2E_SKIP_WEB_SERVER=1 node node_modules/@playwright/test/cli.js test e2e/web/ai-chat-complete.spec.ts --project=web
[1/3] 等待/流式/工具三态动画 …
      ANIMATION_STOPPED {"ai-thinking-skeleton":0,"ai-stream-status":0,".roamlog-ai-dot":0,"停止生成":0}
[2/3] 附件上传 → 预览 → 发送 → 缩略图 → 刷新后仍在
[3/3] 模型 + 思考深度 → 请求体 + UI
  3 passed (53.0s)
```
   `test.describe.configure({ retries: 2 })` 仍开着（网关偶发 `AI_UPSTREAM`），但**三个用例都是第 1 次就通过（retry = 0，无 retry 行输出）**。

8. **附件端到端证据（`evidence/03-attachment.json`，retry 0）**：真实链路 `presign → PUT → complete → media ready → stream` 全部 200，并且——
```json
"requestBody": {"message":"这张照片里是哪里？","conversationId":"01a1f894-d54f-705f-be89-9079f5ff9c0c",
  "clientMessageId":"MNWCxxf","assistantMessageId":"UekH1BC",
  "attachments":[{"mediaId":"01a1f894-d043-7e68-bd58-f941c2891035","kind":"image",
                  "name":"kyoto-sample.png","mimeType":"image/png","sizeBytes":327}]},
"mediaRow": {"httpStatus":200,"status":"ready","mimeType":"image/png","size":327,"hasSignedUrl":true},
"persistedImagePart": {"type":"image","id":"01a1f894-d043-…","filename":"kyoto-sample.png","hasImageUrl":true,
  "providerMetadata":{"roamlog":{"mediaId":"01a1f894-d043-…","mimeType":"image/png","sizeBytes":327,
                                  "name":"kyoto-sample.png","kind":"image"}}},
"conversationTitle": "这张照片里是哪里？"
```
   即：请求体带 attachments、media 行 `ready` 且有签名 URL、**持久化内容里有 image part**（刷新后从 DB 读回渲染），标题也由服务端从文本生成。

## CodeGraph 证据

- `codegraph status` → 索引 up to date（1,668 TS + 304 TSX 文件）；改动后 `codegraph sync` → `Synced 4 changed files`。
- `codegraph_explore`（projectPath `C:\Users\BY9700\Desktop\UI\roamlog`，query `AiChat AI chat request schema stream ChatMessage part attachments`）命中：
  - `AiChat`（`apps/web/components/ai/ai-chat.tsx:139`）— **5 callers in `ai-assistant.tsx`**，tests `thread-list-adapter.test.tsx` / `ai-chat.test.tsx`；
  - 动态派发链：`AiChat → AssistantRuntimeProvider / ChatThread / AiThreadList / createAiChatModelAdapter`；
  - 相关契约：`CreateAiChatBody`（`packages/api-client/src/generated/schemas/createAiChatBody.ts`）4 callers → 说明加字段必须同步生成物（已重新生成）。
  - blast radius 直接决定了我没有改 `AiChat` 的对外 props（只给 `ChatThread` 增加 `workspaceId`，并在 `AiChat` 内部加 memo 化的 attachment adapter）。
- 结论用于：确认 `AiChat` 是唯一挂载点（所以 `AiMotionStyles` 挂在 `thread.tsx` 只渲染一次）、确认 `chat-model-adapter` 是所有 AI 请求的唯一出口（所以 model/attachments 只在那里加）。

---

## 未做 / 阻塞（逐条原因）

1. **「队列传输」没有被验证（环境边界，必须如实记录）** —— 本机没有真 Redis（无 Docker、无 WSL、无二进制），BullMQ 连上仓库自带的 Redis stub 后无法工作（`stalled.forEach is not a function`、`job ingress failed`）。因此 media 处理改为由 `.audit/tools/media-drain.mts` **直接调用 worker 自己的 `handleMediaJob`**（`apps/worker/src/jobs/media.ts`，未改一行）完成，队列投递被替换成「轮询 `status = processing`」。
   - **已验证**：媒体处理管线、变体生成、S3 写入、DB 状态流转（`processing → ready`）、签名 URL、附件进模型、刷新后持久化。
   - **未验证**：队列投递、重试、stalled job 恢复、任务调度。这些需要真 Redis（Memurai / `redis:7` 容器），生产环境具备。
   - 所以本报告**不**声称「worker 端到端通过」，只声称「media 处理管线 + 附件链路通过」。
2. **`kind: "file"` 附件** —— 契约保留（任务给定的形状），但现有 media 管线只接受 6 种图片 MIME（`apps/api/src/modules/media/media-rules.ts`），所以「文件附件」今天不可达；要支持得先扩 media 白名单，属于 media 模块的决策，不在本任务范围。
3. **消息编辑** —— 上游 `message-editor.tsx` 依赖 `setMessages` 重写最后一轮；我们的持久化是 `PUT …/messages/:clientId` 逐条 upsert + parent 链，重写需要「删除该消息之后的分支」端点，本任务未获授权新增端点。
4. **投票** —— 需要新表 + 迁移；任务明确禁止改 `packages/db/prisma/**`。
5. **归档 UI** —— 上游此 commit 没有该功能；我们只是 API/适配器已有能力，未在本页暴露。
6. **Anthropic 协议的思考深度** —— 该协议没有 reasoning effort 字段，明确不转发（UI 会禁用并说明），不是遗漏。
7. **`reasoningEffort` 是否被网关采纳** —— 我们只负责透传；网关侧是否真的降/升思考量，本仓库无法验证（报告不谎称已生效）。

---

## 顺带发现的无关缺陷（只记录，未修）

- 用例 2 的网络日志中出现 `http 500 GET /v1/workspaces/<id>/members?limit=24`（应用外壳的成员列表），与 AI / 附件无关，按仓库规则只记录不顺手修。

## 已知风险

0. **本地 S3 stub 与生产 MinIO 的差异（验收环境限制）**：`.audit/tools/s3-stub.mjs` 只是让浏览器直传能落盘的**测试替身**——它**不校验 presign 签名**（签名仍由真实 `@aws-sdk/client-s3` 在 API 里生成）、**不实现 multipart upload / ListObjectsV2 / 生命周期策略**，也不做并发与断点续传。因此用例 2 证明的是「presign→PUT→complete→读回」这条应用链路正确，**不能**替代对生产 MinIO 的验收；生产环境的签名校验、multipart、list 与 GC 行为仍需在真实对象存储上复验。
0.2 **本机 Redis 只能当缓存用，不能承载 BullMQ**：`e2e/live-support/redis-stub.ts` 是测试替身，不实现 BullMQ 需要的脚本/stalled 检查，因此导出/邮件等**依赖队列调度**的后台任务在本地栈上仍不可运行；媒体处理本次靠 drain 脚本绕过队列完成（见「未做 / 阻塞」第 1 条）。生产环境需在真 Redis 上回归队列投递、重试与 stalled 恢复。
0.3 **`localhost` vs `127.0.0.1` 的坑（本轮踩过三次）**：服务端互连（`.env.local` 的 `S3_ENDPOINT` / `S3_PUBLIC_BASE_URL` / `API_URL`）必须写 `127.0.0.1`，因为 Windows 的 `localhost` 优先解析 `::1` 而服务只监听 IPv4；但**浏览器 origin 必须仍用 `http://localhost:3000`**，Better Auth 的 trusted origins 只包含它（换成 `127.0.0.1:3000` 登录直接 403）。本 spec 的 `page.goto` 走 `WEB_URL`（默认 `http://localhost:3000`），符合这一约束。
0.1 **孤儿对象没有任何清理机制（运维债）**：用户从 composer 移除附件、或上传成功后放弃发送，`media` 行与对象存储里的字节都会保留；`remove()` 只取消前端引用（避免与正在提交的 send 竞争）。当前仓库**没有任何 job / 策略 / 后台任务**回收这些未引用对象，需要后续在 storage 侧做 garbage collection（例如按 `media` 行未被任何 `trip.coverMediaId`、日志条目或 `AiMessage.content` 引用且超过 N 天的规则清理）。

1. **签名 URL 过期**：持久化的是签名 URL；过期后依赖 `UserImage` 的 `onError → fetchMedia(mediaId)` 重签。若对象被删除，缩略图会退化成空白瓦片（有 alt 文本），不会崩页面。
2. **模型白名单的可配置面**：管理员控制面板目前只有 `ai.model` 一个字段（settings registry 不在本任务可写范围），所以「多模型」依靠 `AI_ALLOWED_MODELS` 环境变量；若运维不配，选择器就只有 1 个模型——这符合「只允许管理员配的模型」，但多模型能力的运维入口偏弱，建议后续在 admin 增加一个列表字段。
3. **`gatewayModelNames()` 起了一个对外请求**（`GET {baseUrl}/models`，2.5s 超时、5 分钟缓存）：网关不可达时选择器会短暂等待后回退到可读 id；不影响对话。
4. **`providerMetadata` 的形状校验只在写入时由类型保证**：读取时 `readImageMetadata()` 做运行时校验，非法 metadata 会导致该图片不参与 `attachments`（不会把坏数据发给后端）。
5. **并发改动**：本轮期间 `AI_PLAN_CARD_REBUILD` 也在改 `components/ai/**`（`plan-card.tsx` 一度有 15 个 TS6133，随后自行恢复）；我按最小改动原则只碰了自己新增的段落，最终 tsc 干净。