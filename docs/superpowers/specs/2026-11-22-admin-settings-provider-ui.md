# Roamlog 后台设置与多 Provider UI 规格 v1

状态：**APPROVED — design frozen for planning; implementation follows the accepted plan**

日期：2026-11-22

适用范围：Admin 设置、AI/地图/邮件/存储/媒体服务页、Web 用户外观设置、公开分享页和日志编辑器主题/字体消费。

配套后端规格：`2026-11-22-admin-settings-provider-architecture.md`

配套主题规格：`2026-11-22-theme-font-system-design.md`

需求冻结：`2026-11-22-admin-settings-rebuild-requirements.md`

审计证据：`.audit/settings-audit/ui.md`、`.audit/settings-audit/backend.md`

> 本规格通过前，禁止开始实现。Provider 合同冻结前，前端不得自行增加字段或改响应结构。

---

## 1. 设计目标

把当前“固定 key 设置表单”改造成可运营的服务配置台：

1. AI 与地图是 **N 个 Provider 实例**，不是单一服务商 + 单一 Key。
2. 每个实例可独立启用、编辑、测试、删除和排序；排序就是运行时优先级。
3. AI 填好 Base URL 与 Key 后自动发现模型，模型可选、可搜索、可标默认；拉取过程不阻塞输入。
4. 地图可以有腾讯、Geoapify、Photon 多实例，各自有 Key、区域、配额、超时和测试结果。
5. 密钥只写不读；列表只显示 `hasValue/last4`，reveal 是单独审计动作。
6. 所有表单都有完整状态：空、加载、部分失败、冲突、权限拒绝、离线、重试。
7. 运营页是工作型界面，不是 API key 表格的堆叠；技术细节收纳到 Advanced，主路径只问“连接哪个服务、怎么排优先级、是否可用”。
8. 主题与字体是产品能力，不是代码常量：用户可选 light/dark/system、skin、字体，管理员可设默认和是否允许覆盖。

## 2. 非目标

- 不在本次改 AI 对话体验、地图渲染或媒体处理算法。
- 不提供自定义 HTTP header、脚本或任意 URL 模板。
- 不把品牌、SEO、主题、限流等标量设置 Provider 化。
- 不把明文 secret 渲染到 DOM、localStorage、URL、截图或日志。
- 不在第一波自动启用邮件/存储的多 Provider 路由；UI 可以展示实例列表，但必须明确“单一活跃”限制。
- 不用“自动选择第一个模型”替代用户的明确默认模型选择。

## 3. 现状审计摘要

完整证据见 `.audit/settings-audit/ui.md`。

- AI 页只有协议、Base URL、模型文本、Key、超时/配额；没有 Provider 列表、模型发现、健康、优先级。
- 地图页只有单个 `places.provider` 和单个 `places.apiKey`；腾讯 Key 只能来自 env。
- 发信页同时显示 Resend 和 SMTP 的全部凭据，不随 adapter 条件显示。
- 媒体页把两个“未接入”开关作为正常可编辑开关暴露。
- 系统设置把四个组各自做成独立 form；同页四个保存按钮、四套加载状态；每个 form 都会拉一次全量设置。
- 当前没有路由离开保护；只有“重新读取”用 `window.confirm` 保护草稿。
- 当前值来源只用 `envLocked/updatedAt` 推断，可能把“env fallback”显示成“代码默认”；生产存储页就显示了错误的 `localhost:9000`。
- 当前主题仅 dark/system，`system` 没有 light palette；字体写死。
- 390px 没有横向溢出，这是必须保留的基线；但保存按钮只在顶部，长页面操作不便。

当前生产截图索引：

- AI 1440：`../../../.audit/settings-audit/services-ai-1440.png`
- 地图 1440：`../../../.audit/settings-audit/services-places-1440.png`
- 系统设置 1440：`../../../.audit/settings-audit/settings-general-1440.png`
- 发信 1440：`../../../.audit/settings-audit/services-mail-1440.png`
- 存储 1440：`../../../.audit/settings-audit/services-storage-1440.png`
- 媒体 1440：`../../../.audit/settings-audit/services-media-1440.png`
- AI 390：`../../../.audit/settings-audit/services-ai-390.png`
- 地图 390：`../../../.audit/settings-audit/services-places-390.png`

## 4. 信息架构

保留 Admin 现有侧栏分组，服务配置仍是五个一级目的地；不增加第二层设置导航。

```text
平台概览
信任与安全
内容与资产
服务配置
├── AI 服务          /admin/services/ai
├── 存储服务         /admin/services/storage
├── 地图服务         /admin/services/places
├── 发信服务         /admin/services/mail
└── 媒体处理         /admin/services/media
数据与运营
└── 系统设置         /admin/settings
```

`/admin/settings` 内部使用平级 tab，不再把四组纵向堆叠成四个 form：

```text
系统设置
[ 通用 ] [ SEO ] [ 外观与字体 ] [ 限流 ]
```

Tab 可直接深链：

- `/admin/settings?tab=general`（默认）
- `/admin/settings?tab=seo`
- `/admin/settings?tab=appearance`
- `/admin/settings?tab=limits`

服务页面统一结构：

```text
服务名 + 一句话用途
  [整体健康摘要]                         [添加 Provider]
  ┌ 路由策略 ─────────────────────────────────────┐
  │ 路由模式 / 重试次数 / 冷却 / 版本 / 保存策略   │
  └───────────────────────────────────────────────┘
  ┌ Provider 列表 ─────────────────────────────────┐
  │ 顺序  状态  名称/Adapter  模型或区域   可用性  操作 │
  └───────────────────────────────────────────────┘
  [可选：服务默认参数，折叠]
```

## 5. 服务页面通用 Provider 模式

### 5.1 Provider 列表

桌面 1440px 使用可排序表格；移动 390px 使用卡片列表。两种布局共享同一数据和键盘行为。

列/字段：

| 字段     | 说明                                                                               |
| -------- | ---------------------------------------------------------------------------------- |
| 排序把手 | 仅指针拖拽；键盘用户使用“上移/下移”按钮                                            |
| 优先级   | 显示归一化序号（1, 2, 3）和数值（10, 20, 30）                                      |
| 名称     | 运营可读 label；下方显示 preset 厂商名（如“腾讯地图”）；adapter 只在高级诊断中出现 |
| 状态     | `Healthy / Degraded / Unknown / Unhealthy / Disabled`，文字 + 图标，不只靠颜色     |
| 关键摘要 | AI: 默认模型数/默认模型；地图: 区域 + 配额；邮件/存储: endpoint/host               |
| 最近验证 | 时间 + 延迟；从未测试则明确“从未测试”                                              |
| 启用     | Switch，立即保存并带 undo                                                          |
| 操作     | 测试、编辑、删除；删除是危险样式                                                   |

行主操作：

- 点击行（非开关/按钮区域）或“编辑”打开 Provider 编辑器。
- 启用/停用立即调用 PATCH，成功 toast 带“撤销”。
- 删除弹确认框，说明 soft delete 和运行时影响，确认后可 undo。
- 测试调用 probe，行内显示 spinner，结束后显示状态与延迟。

空态：

```text
还没有 AI Provider
添加第一个 OpenAI-compatible 或 Anthropic Provider，填写 Base URL 和 Key 后会自动发现模型。
[添加 Provider]
```

### 5.2 排序

- 列表顺序 = `priority ASC` 的视觉结果；服务端存 `10, 20, 30...`，UI 展示 1,2,3。
- 拖拽仅改变本地顺序；点击“保存顺序”后 PUT reorder。
- 保存顺序前显示 dirty bar：“顺序未保存 · 取消 · 保存顺序”。
- 键盘：每行操作菜单提供“上移”“下移”；`aria-live` 宣告“腾讯地图移动到第 1 位”。
- 拖拽使用 dnd-kit 或同等 MIT 依赖；必须保留键盘替代，不引入只支持 pointer 的排序库。
- 409 `PROVIDER_ORDER_CONFLICT` 时不得静默覆盖：显示冲突对话框，提供“载入最新顺序”或“保留我的顺序并重试”（后者由后端重新校验）。

### 5.3 路由策略卡

字段由后端 `ProviderGroupPolicy` 决定：

| 字段         | AI                             | 地图                                 | 邮件/存储                 |
| ------------ | ------------------------------ | ------------------------------------ | ------------------------- |
| 路由模式     | `priority`（v1）               | `merge`（默认）/ `priority_failover` | `single` 只读             |
| 最大尝试次数 | 1–5，默认 3                    | 1–5，默认 3                          | 1                         |
| 冷却秒数     | 0–3600，默认 30                | 0–3600，默认 30                      | 0                         |
| 说明         | 同模型优先级/流开始前 failover | 并行合并或顺序回退                   | 不自动重复投递/不路由对象 |

路由模式必须带一行“为什么”：不要只放下拉。

- `priority`：按顺序尝试；网络错误、408、429、5xx 切下一个；401/403 和模型错误默认不切，避免掩盖配置错误。
- `merge`：地图并行召回，priority 用于同分排序；任一 Provider 错误不阻塞其他 Provider。
- `priority_failover`：地图按顺序请求，结果不足或失败才请求下一个，省 quota 但更慢。
- `single`：该组 v1 只允许一个 active；其他实例必须 disabled。

保存策略使用 `expectedVersion`；冲突保留输入并显示载入最新/重试。

### 5.4 Provider 编辑器

桌面使用宽 Dialog/Sheet（建议 640–760px），移动端全屏 Dialog。

```text
┌ 编辑 AI Provider ───────────────────────────────┐
│ [Preset badge] [Healthy] [Enabled]              │
│                                                 │
│ 身份                                             │
│ 名称 [DeepSeek........................]          │
│ 厂商 [DeepSeek v]  ·  高级：openai-chat         │
│                                                 │
│ 连接                                             │
│ Base URL [https://api.deepseek.com/v1.......]   │
│ API Key  ••••a1b2 [更换]                         │
│ 超时 [30000] ms  最大输出 [8192] tokens         │
│                                                 │
│ 模型                                             │
│ 正在获取模型… [取消]                             │
│ 默认模型 [搜索模型............... v]              │
│ [ ] 图片输入  [ ] 推理  [ ] 工具                  │
│                                                 │
│ 测试连接 [测试未保存配置]  结果：1.2s / 42 模型  │
│                                                 │
│ [取消]                         [测试] [保存]     │
└─────────────────────────────────────────────────┘
```

行为：

- 打开已保存 Provider 时只读展示 secret state，不预填明文。
- Provider 的普通 `PATCH` 不携带 secret；仅修改 Base URL/模型/优先级不得清空旧 Key。
- “更换 Key”显示 password 输入和“保存后只显示末四位”。保存时调用独立
  `PUT /v1/admin/providers/:id/secrets/:field`，带 `expectedVersion`；旧密文只进入
  后端 24 小时 history，不出现在 UI、API、Audit 或 toast 中。可取消更换。
- “测试”区分 draft 与 saved：draft 调 `/providers/probe`，不写库；saved 调 `/providers/:id/probe`。
- 测试失败不清空表单、不自动关闭、不保存。
- 关闭有 dirty 草稿时确认“放弃未保存修改”；取消后留在编辑器。
- 保存成功关闭编辑器，列表刷新；保存失败保留焦点和已填内容。

### 5.5 Catalog 驱动字段

前端只从 `GET /v1/admin/provider-catalog` 获取 preset + adapter 描述，不按
`preset === "tencent"` 写死表单。

渲染支持：

- `text`
- `url`
- `integer`（min/max/step）
- `boolean`
- `select`
- `multi-select`
- `secret`
- `model`

每个字段必须显示：

- label 和帮助文本
- required 标记
- 当前 secret 状态（仅 secret）
- 字段级错误

没有 catalog 描述时显示“该 Provider 类型不受当前后台版本支持”，不能猜字段。

### 5.6 Secret 控制

- v1 是单 active credential 模型；不展示 primary/standby 多 Key 列表，也不允许
  在前端持久化 secret。
- 列表/普通表单：`••••last4`，或“未设置”。
- 更改：password input；独立 replace endpoint；保存后回到 masked 状态。
- “显示明文”只对已保存 secret 出现，必须二次确认、TOTP、`confirm:true`，并提示已审计；10 秒自动隐藏。
- 禁止在 toast/错误/Audit 日志中出现明文。
- Secret 存储/keyring 不可用时，页面顶部显示阻断 banner，不允许假装保存成功；
  已存在的 `CONFIG_ENCRYPTION_KEY` 不得在 UI 中轮换/替换。

## 6. AI 服务页

### 6.1 Provider 类型

主文案显示厂商 preset，Advanced 才显示 wire adapter：

| preset                     | 主文案                             | adapter              |
| -------------------------- | ---------------------------------- | -------------------- |
| `openai`                   | OpenAI                             | `openai-chat`        |
| `deepseek`                 | DeepSeek                           | `openai-chat`        |
| `openrouter`               | OpenRouter                         | `openai-chat`        |
| `groq`                     | Groq                               | `openai-chat`        |
| `together`                 | Together                           | `openai-chat`        |
| `gemini-openai`            | Google Gemini（OpenAI-compatible） | `openai-chat`        |
| `anthropic`                | Anthropic                          | `anthropic-messages` |
| `openai-responses`         | OpenAI Responses                   | `openai-responses`   |
| `custom-openai-compatible` | 自定义 OpenAI-compatible           | `openai-chat`        |

Gemini/OpenRouter 不新增 native adapter；Gemini 使用官方 OpenAI-compatible
endpoint。若厂商没有可用的 `/models` 目录，UI 允许明确标记“未验证”的手动模型 ID。

### 6.2 模型自动发现

触发条件：

- 有合法 Base URL
- 有新填 Key，或已有 saved secret
- 用户没有在 700ms 内继续输入

状态机：

```text
idle
  -> waiting-for-url
  -> waiting-for-key
  -> loading
  -> ready(models)
  -> empty
  -> error(code, message)
```

要求：

- 请求可取消；新输入/关闭对话框取消旧请求（AbortController）。
- loading 不锁表单；用户可以继续改超时/标签。
- `401/403`：“服务商拒绝了这个 Key，请检查 Key 或选择正确的协议。”
- `404`：“这个 Base URL 没有 /models 端点，检查是否包含 /v1。”
- `timeout`：“服务商 10 秒内没有响应。”
- `429`：可稍后重试，不做自动无限重试。
- `empty`：“已连接，但服务商返回空模型列表；可以手动填写模型 ID（会标记未验证）。”
- 不自动选择第一个模型；若无默认模型，保存时显示“请选择默认模型”，或允许保存为未启用草稿。
- 已保存模型仍在列表时保持选中；不在列表时显示 `当前模型（本次未返回）` 并提示重新验证。
- 搜索匹配 model id 和 display name；列表最多 200 个。
- 模型目录请求/响应不含 secret；不在浏览器持久化 Key。
- 目录不支持时显示 `PROVIDER_MODELS_DISCOVERY_UNSUPPORTED`，允许手动模型但必须
  标注“未验证”，保存后再次刷新目录不能自动替换它。

### 6.3 模型能力

每个模型的 capability 是显式配置：

- 图片输入
- 推理
- 工具

默认继承 provider catalog 的安全默认值（通常全 false）。网关 `/models` 的 modalities 只作为提示，不自动打开“图片输入”。UI 要说明原因：不可信声明会造成静默失败。

### 6.4 AI 页面默认/高级参数

`timeoutMs`、`maxOutputTokens` 属于 Provider config；`dailyQuota` 如果 group policy 存在则显示为“平台每日调用预算”，不与 Provider 级 quota 混淆。

技术 key、field source、consume 状态统一收纳在一个“高级诊断”disclosure 中，默认折叠；主界面不显示 `ai.defaultProvider` 之类的内部 key。

## 7. 地图服务页

### 7.1 Provider 类型

- 腾讯地图（Tencent）
- Geoapify
- Photon（无 Key）

### 7.2 卡片摘要

地图行摘要显示：

- 区域：中国 / 全球 / 二者
- 每日配额剩余（若后端能提供）或 quota 设置
- 最近测试延迟
- 默认路由参与情况

腾讯与 Geoapify 必须可以同时 `enabled=true`，并显示各自的 Key state。

### 7.3 编辑器字段

公共：

- 名称
- enabled
- baseUrl
- timeoutMs
- regions（中国/全球）
- dailyQuota
- cacheTtlSeconds（可选）

Secret：

- 腾讯：apiKey 必填
- Geoapify：apiKey 必填
- Photon：无 secret

### 7.4 路由模式 UI

`merge` 默认。切换为 `priority_failover` 时显示确认说明“更省配额，但延迟可能更高，部分结果会减少”。保存时更新 group version 并清 places cache。

Priority 在列表中可调整；改变顺序后出现“顺序未保存”bar。

### 7.5 测试

“测试地图 Provider”执行：

- 腾讯：一次小型 forward geocode 或 suggestion
- Geoapify：一次 autocomplete
- Photon：一次搜索

结果必须显示延迟和结果数量；错误只显示安全 code 和可操作文案，不显示完整 URL/Key。

## 8. 邮件服务页

### 8.1 第一波限制

- 使用同一 Provider 列表，但路由模式只读为 `single`。
- 新增第二个实例时提示：“多实例邮件 failover 尚在安全评审；当前实例会保存为停用。”
- 尝试启用第二个实例时 API 返回 `409 PROVIDER_ACTIVE_CONFLICT`，UI 保持停用状态并
  提示先停用当前实例；不允许静默切换 active。
- 不允许自动重发已提交的邮件。

### 8.2 条件字段

- Resend：发件地址、Resend API Key
- SMTP：发件地址、host、port、secure、user（非 secret）、password（secret）

切换 adapter 时，未使用字段隐藏但不删除已有值；提示“切回该类型时保留原值”。

### 8.3 测试

页内 “发送测试邮件”：

- 目的地址输入
- 速率限制提示
- 成功显示 provider/latency
- 失败显示安全 code 和可操作建议
- 测试动作写审计

## 9. 存储服务页

- 第一波单 active Provider；列表仍支持多实例模型，但第二实例默认停用，启用第二个
  实例返回 `409 PROVIDER_ACTIVE_CONFLICT`。
- 条件字段按 catalog：S3 endpoint/publicEndpoint/bucket/region/forcePathStyle/accessKey/secretKey。
- 显示“当前运行值”时必须来自后端 effective config，而不是代码默认；source 为 `database | environment | default`。
- 显式“测试连接”按钮调用现有 probe API；保存时仍执行 probe，但用户可以先测。
- 保存失败显示缺失字段/凭据/桶/签名步骤，不显示原始异常栈。
- 不允许把 endpoint 从生产值静默改成本地默认；如果用户输入 localhost/私网地址，显示高风险确认。

## 10. 媒体处理页

保留标量设置，但改成分区：

1. 浏览器上传与压缩（已接入）：最长边、WebP 质量、目标字节、最大上传字节。
2. 处理能力（未接入）：保留原图、实况照片。

未接入字段：

- 默认折叠/禁用，不能保存为“已生效”
- 显示“未接入，当前改动不会生效”
- 如果产品决定本发布实现，先完成后端运行时再接 UI；不能把开关做成假功能

保存一次，而不是每个字段独立保存。

## 11. 系统设置与外观

### 11.1 系统设置外壳

`/admin/settings` 只加载一次 scalar settings，并在 tab 间共享缓存。每个 tab 有自己的 draft 和保存范围；切换 tab 有 dirty 时确认。

- 通用：站点标题、描述、语言、时区、注册
- SEO：标题模板、描述模板、OG 图、robots、sitemap
- 外观与字体：见 §11.2
- 限流：搜索/上传速率、单批/单文件上限

每个 tab 只有一个主保存按钮；高级诊断（内部 key、source、updatedBy、cache version）默认折叠。

### 11.2 外观与字体

这是平台默认，不是 Admin 自身换肤。**Admin console 固定为深色操作台**，不随
平台/用户 skin、字体或 light/system 模式变化；Admin 只设置 Web 默认值并展示
Web 预览。

平台设置：

- `theme.defaultMode`：`light | dark | system`，默认 `system`
- `theme.defaultSkin`：`editorial-noir | catppuccin | tokyo-night | rose-pine | kanagawa | everforest`
- `theme.defaultFont`：`editorial-classic | literary-warm | modern-editorial | expressive-serif | cjk-editorial | swiss-modern`
- `theme.allowUserOverride`：允许已登录用户覆盖，默认开启
- 预览：用真实组件渲染选中的 skin/font 的首页卡片、日志正文、分享页、错误/空态

已登录用户在 Web `/w/<slug>/settings/appearance` 可选：

- `mode`：Light / Dark / System
- `skin`（卡片 + swatch）
- `fontPairing`（sample text）
- “恢复平台默认”

持久化与首屏：

- 登录用户的 DB 偏好是 canonical source；同用户、同 `updatedAt` 的
  `roamlog_appearance` cookie 只作为首屏缓存，不能覆盖较新的 DB 值。
- 游客仅使用 cookie；没有 cookie 时使用平台默认 + OS `prefers-color-scheme`。
- 默认由平台设置注入 SSR；cookie/DB 命中时在首屏前应用，不能出现 light/dark
  或字体闪烁。
- 变更后无需刷新，立即应用到 Web、公开分享、编辑器；分享页无登录态时用平台默认。
- `theme.allowUserOverride=false` 时忽略用户/游客覆盖，服务端返回平台默认。
- Admin 预览只读，不改变 Admin 侧栏主题；Admin 固定深色的验收不能与 Web 浅色混淆。

旧 `theme.accent` 仅在未存 `theme.defaultSkin` 时按以下确定性规则迁移：

| 旧 accent | 新 skin          |
| --------- | ---------------- |
| `white`   | `editorial-noir` |
| `amber`   | `catppuccin`     |
| `blue`    | `tokyo-night`    |
| `emerald` | `everforest`     |
| `rose`    | `rose-pine`      |

### 11.3 冻结的皮肤与字体目录

UI 只使用 `2026-11-22-theme-font-system-design.md` 中冻结的目录和来源；本规格
不另造 skin 或字体。每套皮肤都有完整浅色/深色语义 token，颜色来自 MIT/Apache
上游调色板的可移植映射，`editorial-noir` 的现有深色基线是已批准的产品现状。

Skin：

1. `editorial-noir`（编辑黑）：现有 Roamlog 深色 + Radix Colors light roles。
2. `catppuccin`（猫咖）：Catppuccin Latte / Mocha。
3. `tokyo-night`（东京夜）：Tokyo Night Day / Storm（必须移植上游 inversion 算法）。
4. `rose-pine`（玫瑰松）：Rosé Pine Dawn / Moon。
5. `kanagawa`（神奈川）：Kanagawa Lotus / Wave。
6. `everforest`（常青林）：Everforest Light / Dark medium。

每个 skin 必须定义完整语义 token：

- canvas / surface 1/2/deep
- ink/body/muted/ash/stone
- hairline/hairline-strong/divider
- accent orange/blue/green/red/yellow/slate
- focus ring、selection、chart、map、editor、share、dialog、toast

字体配对（全部本地 Fontsource/OFL-1.1）：

1. `editorial-classic`：Instrument Serif + Geist + Geist Mono + Noto Serif/Sans SC。
2. `literary-warm`：Newsreader + Manrope + JetBrains Mono + Noto Serif/Sans SC。
3. `modern-editorial`：Instrument Serif + Inter + Geist Mono + Noto Serif/Sans SC。
4. `expressive-serif`：Fraunces + Inter + JetBrains Mono + Noto Serif/Sans SC。
5. `cjk-editorial`：Noto Serif SC + Noto Sans SC + Geist Mono。
6. `swiss-modern`：Geist + Geist + JetBrains Mono + Noto Serif/Sans SC。

要求：

- 只使用仓库内自托管字体（Fontsource 或 repo assets）；不请求 Google Fonts/CDN。
- 每个字体包保留 OFL/Apache license；LXGW WenKai 首版排除。
- 字体选择有 sample text（Latin + 中文 + 数字/代码）和 line-height/中文行高预览。
- Admin 预览不得加载所有字体到首屏；按需预加载选中 pairing。选中 pairing 的
  Latin 首屏压缩传输预算 ≤400 KiB，中文正文页总字体传输 ≤4 MiB。
- 26 个硬编码颜色文件的 token 迁移清单以主题规范的 file-level checklist 为准；
  UI 验收不能只测设置页。

### 11.4 当前主题缺陷

- `ThemeMode` 只有 `dark | system`，`system` 没有 light palette。
- `tokens.css` 的 `:root` 是 dark，`color-scheme: dark` 写死。
- Web 与 Admin 都通过静态 imports 加载固定五套字体，没有选择/回退 UI。
- Web settings 没有 appearance 路由；`settings-nav.tsx` 只有 profile/security/notifications/workspace/danger。

## 12. 状态与错误

### 12.1 统一状态

每个保存/probe/discover 动作都要有：

- idle
- dirty
- loading
- success
- field-errors
- conflict
- permission
- network
- unavailable

### 12.2 文案映射

| 服务端/状态                       | UI 标题                          | 处理                                                   |
| --------------------------------- | -------------------------------- | ------------------------------------------------------ |
| `SETTINGS_ENCRYPTION_UNAVAILABLE` | “密钥存储未就绪”                 | 阻断保存，链到系统健康/环境检查；不显示 “Server Error” |
| `PROVIDER_VERSION_CONFLICT`       | “这个 Provider 已被其他运营修改” | 保留草稿；载入最新/重新保存                            |
| `PROVIDER_ORDER_CONFLICT`         | “Provider 顺序已变化”            | 重新排序/保留我的顺序                                  |
| `PROVIDER_ACTIVE_CONFLICT`        | “该服务已有启用中的 Provider”    | Mail/Storage 第二实例保持停用；先停用当前实例          |
| `ADMIN_2FA_REQUIRED`              | “需要完成两步验证”               | 链到 2FA，草稿保留                                     |
| `PROVIDER_SECRETS_UNAVAILABLE`    | “密钥服务不可用”                 | 禁用 secret 写入，显示重试                             |
| `PROVIDER_SECRET_HISTORY_EXPIRED` | “旧密钥回滚窗口已过期”           | 不允许恢复旧密文；要求重新录入/轮换                    |
| provider 401/403                  | “服务商拒绝凭据”                 | 不自动 failover 掩盖；给出 adapter 提示                |
| provider 429                      | “服务商限流”                     | 显示 retry-after，可手动测试                           |
| provider timeout                  | “服务商超时”                     | 显示超时值；可切换下一个 Provider                      |
| model 404                         | “Base URL 没有 /models”          | 提示检查 /v1 或手动模型                                |
| model discovery unsupported       | “该厂商不支持自动模型目录”       | 允许显式手动模型，必须标记“未验证”                     |
| empty models                      | “没有返回模型”                   | 允许手动模型但标记未验证                               |
| network                           | “无法连接后台 API”               | 保留草稿；重试                                         |

错误详情默认折叠；不把内部 URL、Authorization、Key、堆栈放进可见 UI。

## 13. 响应式

### Desktop ≥1280

- Provider 列表表格 + 路由策略卡上下排列。
- 编辑器 Dialog 最大 760px；侧边安全区 24px。
- 检测到关键操作（保存/测试）固定在 dialog footer。

### Tablet 768–1279

- 表格隐藏次要列（last checked、版本），保留顺序、名称、状态、开关和操作。
- Dialog 宽度 `min(92vw, 720px)`。

### Mobile ≤767

- Provider 列表为卡片，顺序/状态/操作在一行；禁用列折叠到“更多”。
- Dialog 全屏；顶部有返回/关闭，底部 sticky 保存。
- 路由策略卡为单列；顺序调整通过“上移/下移”按钮。
- 所有触控目标 ≥44×44px；不存在横向滚动。

## 14. 可访问性

- Provider 列表使用语义 table（桌面）或 `ul/li`（移动），每行有可读名称。
- 排序把手有可见焦点、`aria-label="拖动排序：腾讯地图"`；键盘替代按钮。
- 拖拽/排序完成后 `aria-live="polite"` 宣告新位置。
- Switch 使用唯一 label；状态同时有文字。
- Dialog focus trap；关闭后焦点回到触发按钮；Esc 可关闭，但 dirty 时先确认。
- 模型列表使用 combobox/listbox 语义；箭头、Home/End、Enter、Esc 可用。
- loading/error 状态 `role=status`/`role=alert`。
- 颜色不是唯一状态信号；错误/健康图标配文字。
- reduced motion：关闭拖拽/展开动画。
- 对比度：light/dark/skin 均需 WCAG AA；小号文字不得低于可读阈值（当前 8–10px 的元数据需上调或移除）。
- 截图中无横向溢出是基线，不是充分条件。

## 15. API 映射

UI 只使用冻结的 Provider API：

| UI 动作            | API                                                  |
| ------------------ | ---------------------------------------------------- |
| 读取 catalog       | `GET /v1/admin/provider-catalog`                     |
| 读取 group         | `GET /v1/admin/provider-groups/:group`               |
| 保存路由策略       | `PATCH /v1/admin/provider-groups/:group`             |
| 保存顺序           | `PUT /v1/admin/provider-groups/:group/order`         |
| 新增 Provider      | `POST /v1/admin/providers`                           |
| 编辑 Provider      | `PATCH /v1/admin/providers/:id`                      |
| 删除 Provider      | `DELETE /v1/admin/providers/:id`                     |
| 测试已保存         | `POST /v1/admin/providers/:id/probe`                 |
| 测试草稿           | `POST /v1/admin/providers/probe`                     |
| 发现模型           | `POST /v1/admin/provider-models/discover`            |
| 刷新模型           | `POST /v1/admin/providers/:id/models/refresh`        |
| 模型启用/默认/能力 | `PATCH /v1/admin/providers/:id/models/:modelId`      |
| 更换密钥           | `PUT /v1/admin/providers/:id/secrets/:field`         |
| 显示 secret        | `POST /v1/admin/providers/:id/secrets/:field/reveal` |

所有写请求携带预期版本；普通 Provider PATCH 不携带 secret；所有 409 映射到
冲突对话框，不丢草稿。

## 16. 旧数据与迁移 UI

- 迁移后首次打开服务页，旧 env/SystemSetting 来源的 Provider 显示“从环境变量导入”标签。
- 若存在多个旧 ordering 来源（`PLACES_SOURCES`、`PLACES_SOURCE_ORDER`、`places.provider`），只展示迁移后的 group policy，不再展示三套输入；迁移报告可下载/查看。
- 旧 secret 无法重新加密时，页面显示阻断说明，不允许出现“已保存但无法读取”的假成功。
- 迁移期间保留旧 SystemSetting 只读兼容；UI 中不再允许编辑已迁移字段。
- 生产 `CONFIG_ENCRYPTION_KEY` 已经配置并通过真实保存验证；UI/运维流程不得生成
  第二把 key，必须使用当前 key id/fingerprint 的记录。
- 腾讯/Geoapify Key 通过安全 stdin/secret manager CLI 导入，UI 不提供明文导入
  入口；导入后只显示 `hasValue=true` 与 last4，日志/截图/Audit 不出现明文。

## 17. 实现边界与波次

### Wave 0（本规格）

- 本 UI 规格 + 后端架构规格 + 主题规格评审。
- 决策已冻结：地图默认 `merge`；Mail/Storage 单 active；6 skin + 6 font；
  Admin 固定深色；腾讯/Geoapify 走安全导入。无未决决策。

### Wave 1

- 合同、catalog、Provider API、Secret API、版本冲突、迁移。
- UI 可以开始 provider shell 与 mock 状态，但不得写临时 API。

### Wave 2（可并行）

- AI adapter/模型发现/路由。
- Places adapter/优先级/测试。

### Wave 3

- Admin Provider 列表/编辑器/排序/密钥/模型/probe。
- 系统设置 shell 与外观。

### Wave 4

- Web 用户外观设置、分享页/编辑器主题、字体，主题回归。

### Wave 5

- Mail/Storage 多实例安全评审与启用；不阻塞 AI/地图上线。v1 仍是统一
  Provider UI + 单 active，第二实例启用返回 `409 PROVIDER_ACTIVE_CONFLICT`。

## 18. 验收矩阵

### 真实浏览器 E2E（1440 / 390）

| ID           | 场景                        | 断言                                                                         |
| ------------ | --------------------------- | ---------------------------------------------------------------------------- |
| UI-AI-01     | 新增 AI Provider            | 自动发现模型；选择默认；保存；刷新后仍在                                     |
| UI-AI-02     | 模型发现错误                | 401/404/timeout/empty 有可读文案；输入保留                                   |
| UI-AI-03     | 多 Provider + failover      | 第一 Provider 500 时第二接管；stub 明确                                      |
| UI-AI-04     | preset / adapter / 手动模型 | 主文案显示厂商 preset；Advanced 显示 adapter；目录不支持时可手动标记“未验证” |
| UI-MAP-01    | 腾讯 + Geoapify 同时启用    | 两行、两 secret state、排序可见                                              |
| UI-MAP-02    | merge 下重排后搜索          | 真实 API 结果和 source order 按 priority 变化                                |
| UI-MAP-03    | probe                       | 延迟/结果数/错误可见                                                         |
| UI-MAP-04    | priority_failover           | 第一 Provider 失败时严格按 priority 回退；第二接管                           |
| UI-MAP-05    | Key 入库                    | 腾讯/Geoapify 两 secret state；DB 只有密文/last4                             |
| UI-SEC-01    | secret 生命周期             | 列表 masked；reveal 二次确认；审计无明文                                     |
| UI-SEC-02    | secret replace              | 独立 PUT；expectedVersion；旧密文 history 不返回 UI/API                      |
| UI-SEC-03    | keyring unavailable         | 阻断保存；不出现假成功 toast；错误文案可操作                                 |
| UI-SAVE-01   | 保存失败/恢复               | 503、409、422、网络失败均保留草稿                                            |
| UI-MAIL-01   | Mail/Storage active 冲突    | 第二实例启用得到 409，界面保持停用并提示先停用当前实例                       |
| UI-NAV-01    | dirty 导航                  | 侧栏切换弹出确认，取消留在原页                                               |
| UI-PERM-01   | analyst/viewer              | 只读；无添加/编辑/排序/测试权限                                              |
| UI-THEME-01  | 6 skins light/dark/system   | Web/分享/编辑器无闪烁；对比度通过；Admin 始终深色                            |
| UI-THEME-02  | 6 font pairings             | 自托管字库加载、sample、持久化/reset；无外部字体请求                         |
| UI-THEME-03  | cookie/DB 偏好冲突          | 登录用户 DB 为准；过期/错用户 cookie 被覆盖；reset 生效                      |
| UI-MOBILE-01 | 390 全流程                  | 无横向滚动；sticky 保存；排序按钮可达                                        |
| UI-CSP-01    | 生产 console                | 无 Cloudflare beacon CSP 错误                                                |

证据路径：`.audit/settings-provider-e2e/`，每场景 1440 与 390 截图 + JSON + 真实 API/DB 断言。

### 非功能 Gate

- `pnpm contracts:check`
- `pnpm typecheck`
- 相关 web/api/admin vitest
- `pnpm --filter @roamlog/admin build`
- Playwright E2E
- 页面无 CSP console error（处理 Cloudflare beacon 或移除）
- 无 secret 出现在 HTML、screenshot、JSON、日志、Audit
- 无外部字体/CDN 请求；6 套字体均由应用 origin 提供

## 19. 验收禁止项

- 只有组件单测，没有真实浏览器。
- 用 mock Provider 但不说明 stub。
- 只用一张 1440 截图代表移动端。
- 保存后不刷新就宣称持久化。
- 只显示“成功”不证明运行时实际使用新 Provider。
- 通过把旧值塞进一个逗号字符串实现“多 Provider”。
- 用深色截图冒充 light/system 验收。
- 为了通过测试把 Key 写进 fixture、URL 或 localStorage。

## 20. 冻结决策

1. Admin console 固定深色操作台；用户主题只作用于 Web、公开分享和日志编辑器。
2. Storage/Mail v1 使用统一 Provider UI，但运行时只允许一个 active；多实例路由后续单独立项。
3. Places 默认 `merge`，priority 决定 tie-break/source order；UI 必须提供显式
   `priority_failover`，验收覆盖两者。
4. 首发皮肤固定为 6 套：`editorial-noir`、`catppuccin`、`tokyo-night`、
   `rose-pine`、`kanagawa`、`everforest`；字体固定为 6 套。
5. 默认 mode 为 `system`；用户可选 light/dark/system。
6. Keyring 已配置，不生成第二把 key；腾讯/Geoapify 通过安全 stdin/secret
   manager 导入当前 keyring。
7. `ai.vision` 迁移到 per-model capability，UI 不再展示全局假开关。
8. Provider 用户主文案使用 preset，adapter 仅在高级诊断显示。
9. v1 不做 workspace 级 Provider/外观覆盖；平台默认 + 用户外观覆盖。

## 21. 来源与许可证

以下均为设计/交互模式来源，不复制代码，除非后续实现任务明确选用并逐文件标注。

### 内部

- 现有设置表单状态机：`apps/admin/components/settings/settings-group-form.tsx`
- 现有 secret reveal 与 probe 错误：`setting-field.tsx`、`probe-error-copy.ts`
- 现有设计 tokens：`packages/ui/src/styles/tokens.css`
- 现有地图多源召回：`apps/api/src/modules/places/places.service.ts`
- WIP 模型发现解析：`apps/api/src/modules/ai/ai-model-discovery.service.ts`（只复用安全解析，不复用单 Provider UI）

### 外部

- One API（MIT），多 channel/priority/models/启停/测试：
  - repo `songquanpeng/one-api` @ `8df4a2670b98266bd287c698243fff327d9748cf`
  - `web/default/src/components/ChannelsTable.js:435-687`
  - `web/default/src/pages/Channel/EditChannel.js:41-690`
  - `model/channel.go:20-41`
- LibreChat（MIT），Provider key 列表/编辑对话框：
  - repo `danny-avila/LibreChat` @ `4700c44eb77c142b4f9f8b87476924f22890eb39`
  - `client/src/components/Nav/SettingsTabs/ProviderKeys/ProviderKeys.tsx:17-67`
  - `.../ProviderKeyRow.tsx:16-89`
- LiteLLM Router（MIT；enterprise 目录除外）：
  - repo `BerriAI/litellm` @ `90dce4b93bd2b090621a6b9083311294d3358bc6`
  - <https://docs.litellm.ai/docs/routing>
- next-themes（MIT，system preference/no flash 概念）：
  - repo `pacocoursey/next-themes` @ `a7eeabc39cfb37d74ea3d82eac674d0e1851b1cb`
  - <https://github.com/pacocoursey/next-themes>
- Radix Colors（MIT，12-step semantic palettes）：
  - repo `radix-ui/colors` @ `dbdb85470547c7d34b9001f48fddb08ded335979`
  - <https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale>
- Fontsource（MIT 工具链；字体逐个 license）：
  - repo `fontsource/fontsource` @ `a6f1cbbf65a98a962ec93a1d09c9804042214394`
  - <https://fontsource.org/docs/api/introduction>
- OpenAI List Models：<https://platform.openai.com/docs/api-reference/models/list>
- Anthropic List Models：<https://docs.anthropic.com/en/api/models-list>
- 腾讯位置服务 WebService：<https://lbs.qq.com/service/webService/webServiceGuide/webServiceSuggestion>
- Geoapify Address Autocomplete：<https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/>
- Apple HIG Dark Mode：<https://developer.apple.com/design/human-interface-guidelines/dark-mode>
- Material 3 color roles：<https://m3.material.io/styles/color/roles>

主题/字体移植的 source of record 是
`2026-11-22-theme-font-system-design.md` 的 §8/§9/§17。皮肤调色板固定来自：
`radix-ui/colors@dbdb85470547c7d34b9001f48fddb08ded335979`（MIT）、
`catppuccin/palette@07d02aa110ef9eb7e7427afca5c73ba9cf7f8ebd`（MIT）、
`folke/tokyonight.nvim@cdc07ac78467a233fd62c493de29a17e0cf2b2b6`（Apache-2.0）、
`rose-pine/neovim@ff483051a47e27d84bdef47703538df1ed9f4a47`（MIT）、
`rebelot/kanagawa.nvim@bb85e4bfc8d89b0e62c8fa53ccdd13d12e2f77b3`（MIT）、
`sainnhe/everforest@85a86eb62409e3ec88713bff3d1b9d7374e112e4`（MIT）。
字体全部经 Fontsource 本地打包，逐个族核验 OFL-1.1。

许可证限制：本规格不采用 AGPL/SSPL/Commons Clause/自定义社区许可代码；实现前每一个具体文件都要复核 license。

## Appendix A — Provider page wireframe

```text
┌ AI 服务 ─────────────────────────────────────────────────────┐
│ 配置 AI 规划调用的提供商、模型、超时与优先级                │
│ 2 Providers · 1 healthy · 1 needs attention   [添加 Provider]│
├ 路由策略 ─────────────────────────────────────────────────────┤
│ 路由模式 [Priority fallback v]  最大尝试 [3]  冷却 [30s]     │
│ 先把健康、便宜的模型排在前面；流开始后不会切换。  [保存策略]  │
├ 已配置 Provider ──────────────────────────────────────────────┤
│ ⠿ 1  DeepSeek       Healthy  默认: deepseek-chat  测试 1.1s [开] │
│ ⠿ 2  OpenAI         Degraded 默认: gpt-4.1        未测试    [开] │
│ ⠿ 3  Anthropic      Unknown  未设置                       [关] │
└───────────────────────────────────────────────────────────────┘
```

## Appendix B — Provider editor wireframe

```text
┌ 编辑地图 Provider ──────────────────────────────── 760px ─┐
│ [Tencent]  [Healthy]  [Enabled on/off]                   │
│ 名称 [腾讯地图...........................]              │
│ 厂商 [腾讯位置服务 v]  ·  高级：tencent                  │
│ Base URL [https://apis.map.qq.com/ws..............]     │
│ API Key  ••••a1b2 [更换]                                  │
│ 区域  [✓ 中国] [ 全球]   超时 [1500] ms                 │
│ 每日配额 [10000]      缓存 [900] 秒                     │
│ [测试此配置]   最近结果：1.2s · 6 条建议                │
│ [取消]                                   [保存 Provider] │
└───────────────────────────────────────────────────────────┘
```

## Appendix C — system settings wireframe

```text
系统设置
[ 通用 ] [ SEO ] [ 外观与字体 ] [ 限流 ]
┌ 外观与字体 ──────────────────────────────────────────────┐
│ 默认外观  [Light] [Dark] [System]                        │
│ Skin      [编辑黑] [猫咖] [东京夜] [玫瑰松] [神奈川] [常青林] │
│ 字体      [编辑经典] [文学暖调] [现代编辑] [表现衬线] [中文编辑] [瑞士现代] │
│ [✓] 允许已登录用户覆盖                                   │
│ ┌ preview ─────────────────────────────────────────────┐ │
│ │ 首页卡片 / 日志正文 / 分享页 / 空/错状态               │ │
│ └──────────────────────────────────────────────────────┘ │
│ [恢复默认]                                  [保存外观]   │
└──────────────────────────────────────────────────────────┘
```
