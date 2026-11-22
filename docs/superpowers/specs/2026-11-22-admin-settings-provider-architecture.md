# Roamlog 后台设置与多 Provider 架构规格 v1

状态：**APPROVED — design frozen for planning; implementation follows the accepted plan**

日期：2026-11-22

适用范围：Admin 设置、AI、地图服务，以及后续邮件/存储 Provider 化

需求冻结：`docs/superpowers/specs/2026-11-22-admin-settings-rebuild-requirements.md`

配套 UI 规格：`docs/superpowers/specs/2026-11-22-admin-settings-provider-ui.md`

> 本规格通过前，禁止开始实现；本规格通过后，也不得在全部 Gate 通过前部署生产。

---

## 1. 问题陈述

当前后台把“服务配置”建模成**一组固定的 SystemSetting key**。这个模型适合站点标题、主题、限流等标量设置，但不适合可增删、可排序、多凭据、需要健康检查的 Provider 实例。

用户明确提出的需求是：

1. AI 不能只配置一个厂商/一组 baseUrl + key + model；要能添加多个厂商/端点。
2. AI 填写 API Base URL 和 Key 后要自动获取可用模型，并能选择默认模型。
3. 地图不能只使用一个厂商；腾讯、Geoapify 等要能同时存在并设置逐个优先级。
4. 腾讯地图和 Geoapify 的 key 必须加密写入服务器数据库，而不是继续只放在 env。
5. Admin 设置 UI 和逻辑全面重构，不能继续按当前固定 key 写死；前端要同步。
6. 全部修复、真实 E2E 验收通过后，才允许讨论部署。

## 2. 目标与非目标

### 2.1 目标

- 引入通用 **Provider Group / Provider Connection** 领域模型。
- 同一 group 支持任意数量的 Provider 实例，按优先级排序。
- AI 支持：
  - 多个 OpenAI-compatible / Anthropic Messages Provider；
  - Provider 级 baseUrl、密钥、超时、默认模型；
  - 自动发现模型；
  - 按优先级 failover；
  - 流式响应开始前才允许切换 Provider。
- Places 支持：
  - 腾讯、Geoapify、Photon 多实例；
  - 中国/混合/全球路由；
  - 按优先级 tie-break，或显式 priority failover；
  - Provider 级 quota、timeout、cache TTL、region。
- 所有 Provider 密钥只以密文进入数据库，API 只返回 `hasValue/last4`。
- Admin API 使用乐观版本，支持创建、编辑、禁用、删除、排序、测试、模型刷新。
- 旧的 `SystemSetting` 数据可无损迁移，可一键回退。
- UI 以后只依赖 Provider Catalog + 通用表单描述，新增 Provider 不再要求重写前端。

### 2.2 非目标

- 不在本规格中重新设计 AI 对话本身或地图渲染。
- 不把品牌、SEO、主题、限流等纯标量设置 Provider 化。
- 不在第一波把已存储媒体从一个 bucket 迁移到另一个 bucket。
- 不做跨 Provider 的自动“重发已确认邮件”；邮件失败回退必须避免重复投递。
- 不允许自定义任意 HTTP header、任意脚本或任意 URL 模板执行。
- 不提供明文 secret 的列表读取。只能通过单独的审计 reveal 接口读取单个 secret。

## 3. 强制约束

1. 所有 Provider 协议、模型列表、地图搜索语义必须来自成熟实现或官方文档；不得自创 wire protocol。
2. 只允许 MIT / Apache-2.0 / BSD / ISC 的实现和文档作为移植来源。
3. 外部 Provider 的 HTTP 错误不得原样回显给用户或写进日志。
4. 数据库迁移必须可在空库和已有生产数据上执行。
5. 所有 Provider 写操作、密钥变更、测试、排序、模型刷新必须写 AuditLog。
6. 所有写接口必须继续受 `SessionGuard + PlatformTwoFactorGuard + AdminGuard` 保护，并复用 `admin:settings:read/write` 权限。
7. 不把 secret 写入 Git、env 示例、客户端 bundle、Redis、Sentry、AuditLog 或测试快照。
8. 任何新功能验收必须有真实 API + 数据库 + 浏览器 E2E；不能用组件单测代替。

## 4. 现状审计摘要

完整证据见 `.audit/settings-audit/backend.md`。

### 4.1 静态设置 Registry 无法承载动态 Provider

- `SETTINGS_REGISTRY` 是编译期固定数组：`apps/api/src/modules/settings/settings.registry.ts:144-749`。
- `SETTINGS_GROUPS` 固定为九个 group：`packages/contracts/src/api/admin-settings.ts:15-25`。
- `SettingsService.listAdminSettings()` 只按 registry 生成固定 item：`apps/api/src/modules/settings/settings.service.ts:212-227`。
- `SettingsService.update()` 只接受 registry 中的 key 和单值：`apps/api/src/modules/settings/settings.service.ts:241-373`。
- `SystemSetting` 每个 key 最多一个 `value` 和一个 `secretCipher`：`packages/db/prisma/schema.prisma:987-1002`。

结论：无法用静态 key 表示 N 个 Provider，也无法为每个 Provider 创建独立 secret。

### 4.2 AI 当前是单上游

- `AiSettings` 只有一组 `protocol/baseUrl/apiKey/model`：`apps/api/src/modules/ai/ai.settings.ts:67-110`。
- `ai.baseUrl`、`ai.model`、`ai.apiKey` 是固定 key：`apps/api/src/modules/settings/settings.registry.ts:576-607`。
- `allowedModels` 来自默认模型 + `AI_ALLOWED_MODELS` 环境变量：`apps/api/src/modules/ai/ai.settings.ts:163-186`。
- `AiPlanService.chatModels()` 只渲染这组 allow-list：`apps/api/src/modules/ai/ai-plan.service.ts:767-799`。
- `gatewayModelNames()` 每个进程最多每 5 分钟抓一次当前单个 baseUrl 的 `/models`：`apps/api/src/modules/ai/ai-plan.service.ts:801-850`。
- `vision` 是全局开关，而不是每个 Provider/模型能力：`apps/api/src/modules/ai/ai.settings.ts:97-108`、`settings.registry.ts:608-624`。

当前工作区中存在未提交的单 Provider 模型发现增量：

- `apps/api/src/modules/ai/ai-model-discovery.service.ts`（untracked）
- `apps/api/src/modules/ai/ai-admin-settings.controller.ts`（untracked）
- `apps/admin/components/settings/ai-model-discovery.tsx`（untracked）
- `packages/contracts/src/api/admin-settings.ts` 的 `AiModelDiscovery*`（modified）

它只解决“当前这一组 baseUrl/key 拉模型”，不解决多 Provider、优先级、持久化和 failover。不得把它当作最终实现。

### 4.3 Places 运行时已有多源，配置层仍然单值

- 运行时支持 Tencent / Geoapify / Photon，并并行召回、合并、去重：`apps/api/src/modules/places/places.service.ts:172-306`。
- `eligibleSources()` 已实现中国/混合/全球路由和 source order：`apps/api/src/modules/places/places.service.ts:86-130`。
- 但 `/v1/admin/settings` 只有 `places.provider` 和单个 `places.apiKey`：`settings.registry.ts:626-648`。
- `places.apiKey` 实际上只对应 Geoapify 的 key：`apps/api/src/modules/places/places.settings.ts:381-388`。
- Tencent key 只来自 `TENCENT_MAPS_KEY`：`places.settings.ts:306-307`。
- `sources/sourceOrder` 只能来自 env，不能从后台编辑：`places.settings.ts:373-375`。
- `parseStoredProvider()` 只接受 `geoapify/photon`，即使 registry enum 还包含 tencent/local/map_pin：`places.settings.ts:410-412`。
- `places.dailyQuota` 实际只写入 Geoapify 的 daily limit：`places.settings.ts:549-580`。

结论：用户看到“只能选一个”不是 UI 小问题，而是数据模型和 API 合同缺失。

### 4.4 Provider secret 当前只有单一静态入口

- `SystemSetting` 的 secret 只能是“一个 key 对应一段 ciphertext”。
- `SecretBox` 已支持 AES-256-GCM 与 key ring：`apps/api/src/modules/settings/secret-box.ts:131-220`。
- AAD 当前是静态 setting key，例如 `ai.apiKey`：`settings.service.ts:562-584`。
- key ring 缺少时，只有 secret 写入/读取路径失败；进程可正常启动：
  - `apps/api/src/modules/settings/settings.service.ts:596-615`
  - 当前生产已经出现 `SETTINGS_ENCRYPTION_UNAVAILABLE`。

结论：新模型必须支持“Provider 实例 + 字段”级 secret；迁移时必须显式重新加密或保留可识别 AAD。

### 4.5 Mail / Storage 也是单实例

- Mail 是单个 `mail.provider` + 两组固定凭据：`apps/api/src/modules/settings/mail-settings.consumer.ts:34-57`。
- Storage 是单个 endpoint/bucket/accessKey/secretKey：`settings.registry.ts:377-453`。
- Mail/Storage 已有保存前 live probe：`apps/api/src/modules/settings/settings-save-probe.service.ts:20-58`。
- Mail 的自动 failover 有重复投递风险，Storage 多实例有对象路由问题。

结论：领域模型应从第一版兼容这四个 group，但 Mail/Storage 的多实例路由可分阶段启用；见 §15。

### 4.6 通用设置与标量设置没有同类缺口

General / SEO / Theme / Media / Limits 是纯标量或开关配置，保留 `SystemSetting` 即可。需要同步 UI 的“统一设置外壳”，但不需要 Provider 表。

## 5. 目标领域模型

### 5.1 核心原则

- `SystemSetting` 继续负责标量配置。
- `ProviderGroupPolicy` 负责 group 级路由策略。
- `ProviderConnection` 负责一个可独立启用/排序/测试的 Provider 实例。
- `ProviderSecret` 负责 Provider 实例的多个密钥字段。
- `ProviderModel` 负责 AI 模型目录与每模型能力。
- secret 永不进入 `config` JSON，永不进入 Redis。

### 5.2 Prisma 草案

```prisma
model ProviderGroupPolicy {
  group           String   @id @db.VarChar(40)
  routingMode     String   @default("priority") @db.VarChar(32)
  maxAttempts     Int      @default(1)
  cooldownSeconds Int      @default(30)
  config          Json     @default("{}") @db.JsonB
  version         Int      @default(1)
  updatedById     String?  @db.Uuid
  updatedAt       DateTime @updatedAt @db.Timestamptz(3)
  createdAt       DateTime @default(now()) @db.Timestamptz(3)

  @@map("ProviderGroupPolicy")
}

model ProviderConnection {
  id                  String   @id @default(uuid(7)) @db.Uuid
  group               String   @db.VarChar(40)
  adapter             String   @db.VarChar(40)
  preset              String?  @db.VarChar(40)
  label               String   @db.VarChar(80)
  enabled             Boolean  @default(true)
  priority            Int      @default(100)
  config              Json     @db.JsonB
  version             Int      @default(1)
  healthStatus        String   @default("unknown") @db.VarChar(20)
  consecutiveFailures Int      @default(0)
  cooldownUntil       DateTime? @db.Timestamptz(3)
  lastCheckedAt       DateTime? @db.Timestamptz(3)
  lastErrorCode       String?  @db.VarChar(80)
  legacyKey           String?  @db.VarChar(120)
  createdById         String?  @db.Uuid
  updatedById         String?  @db.Uuid
  createdAt           DateTime @default(now()) @db.Timestamptz(3)
  updatedAt           DateTime @updatedAt @db.Timestamptz(3)
  deletedAt           DateTime? @db.Timestamptz(3)

  secrets ProviderSecret[]
  secretHistory ProviderSecretHistory[]
  models  ProviderModel[]

  @@unique([group, legacyKey])
  @@index([group, deletedAt, enabled, priority])
  @@map("ProviderConnection")
}

model ProviderSecret {
  id         String   @id @default(uuid(7)) @db.Uuid
  providerId String   @db.Uuid
  field      String   @db.VarChar(80)
  ciphertext String
  last4      String?  @db.VarChar(8)
  keyVersion Int      @default(1)
  version    Int      @default(1)
  createdAt  DateTime @default(now()) @db.Timestamptz(3)
  updatedAt  DateTime @updatedAt @db.Timestamptz(3)

  provider ProviderConnection @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@unique([providerId, field])
  @@map("ProviderSecret")
}

model ProviderSecretHistory {
  id         String   @id @default(uuid(7)) @db.Uuid
  providerId String   @db.Uuid
  field      String   @db.VarChar(80)
  ciphertext String
  last4      String?  @db.VarChar(8)
  keyVersion Int
  replacedAt DateTime @default(now()) @db.Timestamptz(3)
  expiresAt  DateTime @db.Timestamptz(3)

  provider ProviderConnection @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@index([providerId, field, expiresAt])
  @@map("ProviderSecretHistory")
}

model ProviderModel {
  id           String   @id @default(uuid(7)) @db.Uuid
  providerId   String   @db.Uuid
  modelId      String   @db.VarChar(200)
  displayName  String   @db.VarChar(160)
  ownedBy      String?  @db.VarChar(80)
  enabled      Boolean  @default(true)
  isDefault    Boolean  @default(false)
  capabilities Json     @default("{}") @db.JsonB
  discoveredAt DateTime @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt @db.Timestamptz(3)

  provider ProviderConnection @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@unique([providerId, modelId])
  @@index([providerId, enabled])
  @@map("ProviderModel")
}
```

迁移 SQL 必须补充 CHECK：

- `ProviderConnection.group IN ('ai','places','mail','storage')`
- `priority >= 0`
- `version > 0`
- `healthStatus IN ('unknown','healthy','degraded','unhealthy')`
- `ProviderGroupPolicy.routingMode`：`ai=priority`，`places=merge|priority_failover`，
  `mail=single`，`storage=single`

### 5.3 数据不变量

1. 同一 group 中，enabled Provider 按 `priority ASC, createdAt ASC` 排序。
2. priority 不要求全局唯一，但重排 API 会规范化为 `10,20,30...`。
3. 每个 Provider 的 `label` 在 group 内对运营可读即可；不做唯一约束，避免软删除后无法复用名称。
4. AI 每个 Provider 至少有一个启用的默认模型，或允许“尚未配置模型”的 draft 状态。
5. Provider soft delete 后，其 model 与 secret 不再参与运行时解析；数据库保留用于审计/回滚。
6. `ProviderSecret.ciphertext` 的 AAD 使用 `provider:${providerId}:${field}`；禁止只使用字段名。
7. `legacyKey` 只用于一次性迁移幂等；新 Provider 必须为 null。
8. `ProviderSecret` 只保存一个 active credential；`PUT .../secrets/:field` 原子替换后，旧密文写入 `ProviderSecretHistory`，保留 24 小时供回滚，永不出现在 API 响应。
9. 每个 Provider 最多一个 `ProviderModel.isDefault=true`；该不变量由服务层事务保证，并有唯一性测试。

## 6. Adapter 合同

### 6.1 Provider Catalog

前端不得为每个 Provider 写一套表单。后端提供受保护的 catalog：

`GET /v1/admin/provider-catalog`

```json
{
  "groups": [
    {
      "group": "ai",
      "label": "AI 服务",
      "routingModes": ["priority"],
      "adapters": [
        {
          "adapter": "openai-chat",
          "label": "OpenAI Chat Completions",
          "capabilities": ["model_discovery", "probe", "priority"],
          "configFields": [
            { "key": "baseUrl", "type": "url", "required": true },
            { "key": "defaultModel", "type": "model", "required": false },
            { "key": "timeoutMs", "type": "integer", "min": 1000, "max": 120000, "default": 30000 },
            {
              "key": "maxOutputTokens",
              "type": "integer",
              "min": 256,
              "max": 65536,
              "default": 4096
            }
          ],
          "presets": [
            {
              "preset": "openai",
              "label": "OpenAI",
              "defaultBaseUrl": "https://api.openai.com/v1"
            },
            {
              "preset": "deepseek",
              "label": "DeepSeek",
              "defaultBaseUrl": "https://api.deepseek.com/v1"
            },
            {
              "preset": "openrouter",
              "label": "OpenRouter",
              "defaultBaseUrl": "https://openrouter.ai/api/v1"
            },
            {
              "preset": "custom-openai-compatible",
              "label": "Custom OpenAI-compatible",
              "defaultBaseUrl": null
            }
          ],
          "secretFields": [{ "key": "apiKey", "label": "API Key", "required": false }]
        }
      ]
    }
  ],
  "version": 1
}
```

Catalog 由代码注册表生成，不来自数据库；它让 UI 可以通用渲染表单，同时新增 adapter 不需要改前端。
实际响应必须包含 §6.2 的全部 presets 和 §6.3 的 places adapters，不是只返回示例中的一条。

### 6.2 AI Adapter and vendor presets

支持的 adapter 与现有 `AiProtocolSchema` 对齐：

- `openai-chat`
- `openai-responses`
- `anthropic-messages`

`preset` 是运营可见的厂商预设，不是 wire protocol。它必须属于对应 adapter；
允许自定义 `baseUrl`，但不得改变 adapter 的鉴权/流式语义。v1 冻结以下预设：

| preset                     | adapter              | 默认 baseUrl                                              | 模型发现                                                                |
| -------------------------- | -------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `openai`                   | `openai-chat`        | `https://api.openai.com/v1`                               | `GET {baseUrl}/models`，Bearer                                          |
| `deepseek`                 | `openai-chat`        | `https://api.deepseek.com/v1`                             | `GET {baseUrl}/models`，Bearer                                          |
| `openrouter`               | `openai-chat`        | `https://openrouter.ai/api/v1`                            | `GET {baseUrl}/models`，Bearer                                          |
| `groq`                     | `openai-chat`        | `https://api.groq.com/openai/v1`                          | `GET {baseUrl}/models`，Bearer                                          |
| `together`                 | `openai-chat`        | `https://api.together.xyz/v1`                             | `GET {baseUrl}/models`，Bearer                                          |
| `gemini-openai`            | `openai-chat`        | `https://generativelanguage.googleapis.com/v1beta/openai` | 优先 `GET {baseUrl}/models`；不公开目录时返回 unsupported，允许手动模型 |
| `anthropic`                | `anthropic-messages` | `https://api.anthropic.com/v1`                            | `GET {baseUrl}/models` + `x-api-key` + `anthropic-version: 2023-06-01`  |
| `openai-responses`         | `openai-responses`   | `https://api.openai.com/v1`                               | OpenAI `/models` 合同                                                   |
| `custom-openai-compatible` | `openai-chat`        | 由运营填写                                                | `GET {baseUrl}/models`；失败可手动模型，必须标记未验证                  |

没有原生 Gemini/OpenRouter adapter；它们通过官方 OpenAI-compatible endpoint
接入。新增 native adapter 必须单独立规格，不能把厂商名直接当 wire protocol。

`ProviderConnection.config`：

```ts
{
  baseUrl: string;
  defaultModel?: string;
  timeoutMs: number;
  maxOutputTokens: number;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
}
```

`ProviderSecret.field`：

- `apiKey`：可空，因为本地 gateway 可以无密钥。

`ProviderModel.capabilities`：

```ts
{
  reasoning?: boolean;
  vision?: boolean;
  tools?: boolean;
}
```

能力只能由管理员显式确认；模型目录里的 `modalities` 不能自动开启 `vision`。

### 6.3 Places Adapter

支持的 adapter：

- `tencent`
- `geoapify`
- `photon`

`preset` 与 adapter 一一对应，允许 `custom` 仅用于调整 `baseUrl`；不允许把
Tencent key 配到 Geoapify adapter。

`ProviderConnection.config`：

```ts
{
  baseUrl: string;
  timeoutMs: number;
  regions: ("cn" | "global")[];
  dailyQuota: number;
  cacheTtlSeconds?: number;
}
```

`ProviderSecret.field`：

- `tencent`: `apiKey` 必填
- `geoapify`: `apiKey` 必填
- `photon`: 无 secret

内置 `local` / `map_pin` 不是网络 Provider；它们保留为搜索没有结果时的 fallback 语义，不进入 ProviderConnection 列表。

### 6.4 Mail Adapter

`mail` group 使用同一领域模型和 Provider UI，v1 只允许一个 active Provider：

- `resend`: config `{from}`，secret `apiKey`
- `smtp`: config `{from,host,port,secure}`，secret `password`（可选 `user` 为非 secret）

默认且唯一 `routingMode = "single"`。第二个启用请求返回
`409 PROVIDER_ACTIVE_CONFLICT`；UI 必须提示先停用当前实例。多 Provider
failover 只有确认不会造成重复投递后，才另立规格开启。

### 6.5 Storage Adapter

`storage` group 也使用同一 Provider UI，v1 只允许一个 active Provider：

- `s3`: config `{endpoint,publicEndpoint,bucket,region,forcePathStyle}`，secrets `accessKey/secretKey`

多 Storage Provider 需要对象级路由和媒体迁移，不在第一波自动启用。保存第二个
实例时它必须保持 disabled，启用时返回 `409 PROVIDER_ACTIVE_CONFLICT`。

## 7. 路由与 Fallback

### 7.1 AI：priority failover

新增 `AiProviderRouter`，替代当前单 `AiSettings` 直接构造 adapter 的路径。

解析步骤：

1. 从 `ProviderGroupPolicy(group='ai')` 读取 routing mode、`maxAttempts`、cooldown。
2. 从 `ProviderConnection` 读取 enabled、未删除、未 cooldown 的 Provider，按 priority 排序。
3. 只保留 adapter 属于 AI 且 config/schema 有效的 Provider。
4. 如果请求指定 `model`：
   - 查找 `ProviderModel.modelId = model AND enabled = true` 的 Provider；
   - 多个 Provider 有同模型时，按 priority；
   - 找不到 → 400 `AI_MODEL_NOT_ALLOWED`。
5. 按顺序尝试 Provider，每次使用自己的 baseUrl、secret、timeout 和 adapter。
6. 成功后将 `providerId/adapter/preset/model/attempt` 写入现有 AI run/审计/指标。

Failover 分类：

| 上游结果                      | 是否换下一个 | 说明                                                                     |
| ----------------------------- | ------------ | ------------------------------------------------------------------------ |
| timeout / DNS / network / TLS | 是           | 记录 `network`，进入短期 cooldown                                        |
| 408 / 429 / 500-599           | 是           | 429 遵守 `Retry-After`                                                   |
| 401 / 403                     | 默认否       | 配置错误必须暴露，允许管理员在 Provider 上显式开启 `failoverOnAuthError` |
| 400 / 404 / 422               | 默认否       | 请求/模型错误不应被另一个 Provider 静默掩盖                              |
| 2xx 已开始 stream             | 否           | 流式响应一旦写下第一个 token，不得换 Provider                            |

流式约束：

- 在收到第一个 SSE data/token 前，可以 failover。
- 收到第一个 token 后，只允许发出一个安全的 `AI_PROVIDER_STREAM_FAILED` 终止事件，不得重放用户消息。

模型发现：

- OpenAI-compatible：`GET {baseUrl}/models` + `Authorization: Bearer <key>`。
- Anthropic：`GET {baseUrl}/models` + `x-api-key` + `anthropic-version`。
- 结果最多 200 个模型、最多 256 KiB、10 秒超时。
- 解析 `data[].id`、`display_name`/`name`，保存到 `ProviderModel`。
- 目录中的能力字段不得直接开启 vision/工具；只能作为提示。
- 刷新失败不清空已有模型目录；只更新 `lastCheckedAt/lastErrorCode`。
- 目录端点不支持时返回稳定 `PROVIDER_MODELS_DISCOVERY_UNSUPPORTED`；允许运营
  手动输入模型 ID，但必须标记“未验证”，且不能自动设为默认。

### 7.2 Places：merge 与 priority failover

Places 冻结两种合法模式：

- `merge`（默认，兼容当前多源召回）：
  - 对所有 region-eligible、enabled、未 cooldown 的 Provider 并行召回；
  - priority 决定同分候选 tie-break、来源顺序和权威行政层级优先；它不表示
    请求严格串行；
  - 任一 Provider 失败不阻塞其他 Provider；
  - 响应仍使用公开合同 `provider` = 实际胜出 adapter。
- `priority_failover`（显式切换）：
  - 按 priority 顺序请求；
  - 若结果为空或上游失败，再请求下一个；
  - 满足 `minResults` 后停止；
  - 适合节省 quota，但延迟通常更高。

Reverse geocode 与 autocomplete 使用 group policy 的同一个显式 mode；实现不得
偷偷固定成另一种顺序。UI 必须解释：“merge 使用全部已启用来源，priority 先在
合并排序中生效；只有 priority_failover 才严格逐个请求。”

Region 规则：

- route `china`、`mixed`：Tencent 可参与；
- route `global`：默认只有 `regions` 包含 `global` 的 Provider；
- `regions` 中没有兼容 Provider → 返回空结果 + degraded，不伪造 provider。

Priority 规则：

- 排序 API 写入 `10,20,30...`；
- 同分候选按 priority、providerId 稳定排序；
- 修改 priority 必须 bump group version，使 places cache 失效。

Quota/circuit：

- 每个 Provider 独立维护 daily quota；
- 超过 quota → 跳过并记录 `QUOTA_EXCEEDED`；
- 连续失败阈值后进入 cooldown，半开时允许一次探测；
- 永远不把一个 Provider 的 key 用于另一个 adapter。

### 7.3 健康与 cooldown

`ProviderGroupPolicy` 默认：

- AI `maxAttempts=3`, `cooldownSeconds=30`
- Places `maxAttempts=3`, `cooldownSeconds=30`
- Mail/Storage `maxAttempts=1`

Provider 状态：

- `unknown`：尚未测试/刷新
- `healthy`：最近测试成功
- `degraded`：有失败但未超过阈值
- `unhealthy`：超过阈值或在 cooldown

健康状态是运行时辅助，不是保存配置的强制门禁。管理员可以在 Provider 故障时保留配置；但用失败配置替换当前健康配置时，响应必须提示风险。

## 8. Secret 与密钥管理

### 8.1 启动前置

生产环境当前已经配置 `CONFIG_ENCRYPTION_KEY`，真实 `PATCH /v1/admin/settings`
已返回 200。后续每次部署仍必须执行 preflight，但**不得为这次迁移生成第二把
key**；腾讯/Geoapify 的导入使用当前 keyring。

部署 preflight：

```bash
pnpm check:env
```

以下条件必须显式校验：

- `APP_ENV=production` 时 `CONFIG_ENCRYPTION_KEY` 或 `CONFIG_ENCRYPTION_KEYS` 至少一个有效；
- 每个 key 都是 base64 编码的 32 字节；
- API 启动日志只记录 key fingerprint（sha256 前 8 位），不记录 key；
- `/v1/ready` 或 Admin System 页暴露 `secrets: up|unavailable`；
- 不可用时，Provider secret 的读写返回稳定的 503 `PROVIDER_SECRETS_UNAVAILABLE`，而不是模糊 500。

没有 keyring 时允许进程启动（避免整个站点不可用），但 Admin UI 必须显示阻断式修复提示；Provider secret 写操作必须被 preflight 拒绝。

当前 key id/指纹与离线备份状态记录在受控的
`.audit/settings-encryption/report.md` 和安全运维记录中；本规格不重复密钥值。
上线前必须确认该 key 有一份与主机分离的离线备份；丢失会让已保存凭据不可解密。

### 8.2 Provider secret

- AAD：`provider:${providerId}:${field}`
- 加密：沿用 `SecretBox` AES-256-GCM
- 写入：单个 provider 的 secrets 在一个数据库事务里 upsert
- 读取：
  - 列表只返回 `{ field, hasValue, last4, version }`
  - 运行时按需解密到进程内存，不写 Redis
  - `secret` 只允许 super_admin + verified TOTP + `confirm:true` reveal
- 轮换：
  - 新 secret 使用 key ring 第一项
  - 旧 ciphertext 继续用旧 keyId 解密
  - `PUT /v1/admin/providers/:id/secrets/:field` 原子替换当前密文，旧密文写入
    `ProviderSecretHistory` 24 小时；历史只用于受控回滚，不通过 Admin API 返回
  - 迁移后至少做一次“旧 key 解密 → 新 key 加密”的 rotation 验证

### 8.3 旧 secret 迁移

旧的 `SystemSetting.secretCipher` 使用 setting key 作为 AAD。迁移到 `ProviderSecret` 有两条合法路径：

1. **推荐**：在同一进程内用旧 SecretBox 解密，再用 provider AAD 重新加密；事务成功后写 `ProviderSecret`。
2. 若现有 keyring 无法解密旧密文，则禁止复制 ciphertext；必须阻塞迁移并提示运维修复 keyring。

禁止直接把旧 ciphertext 塞进 `ProviderSecret` 并使用新 AAD，否则运行时会解密失败。

### 8.4 日志脱敏

必须补充 Pino redact：

- `*.apiKey`
- `*.secretKey`
- `*.password`
- `*.totpSecret`
- `req.body.apiKey`
- `req.body.secret`
- `res.body.*secret*`

禁止记录：

- provider config JSON 原文
- Authorization / x-api-key / cookie
- 带 query key 的完整 URL

错误只返回稳定 code 和安全 message。

## 9. Admin API

### 9.1 Endpoints

所有接口都要求 Admin session + 2FA + `admin:settings:read/write`。

| Method | Path                                            | 用途                             |
| ------ | ----------------------------------------------- | -------------------------------- |
| GET    | `/v1/admin/provider-catalog`                    | 通用表单描述                     |
| GET    | `/v1/admin/provider-groups/:group`              | group policy + ordered providers |
| PATCH  | `/v1/admin/provider-groups/:group`              | routingMode/maxAttempts/cooldown |
| PUT    | `/v1/admin/provider-groups/:group/order`        | 批量重排                         |
| POST   | `/v1/admin/providers`                           | 创建 Provider                    |
| PATCH  | `/v1/admin/providers/:id`                       | 编辑 Provider                    |
| DELETE | `/v1/admin/providers/:id`                       | soft delete                      |
| POST   | `/v1/admin/providers/:id/probe`                 | 已保存 Provider 测试             |
| POST   | `/v1/admin/providers/probe`                     | draft 配置测试（不落库）         |
| POST   | `/v1/admin/provider-models/discover`            | draft 或 saved Provider 拉模型   |
| POST   | `/v1/admin/providers/:id/models/refresh`        | 已保存 Provider 刷新模型         |
| PATCH  | `/v1/admin/providers/:id/models/:modelId`       | 启用/默认/能力                   |
| PUT    | `/v1/admin/providers/:id/secrets/:field`        | 原子替换 active secret           |
| POST   | `/v1/admin/providers/:id/secrets/:field/reveal` | super_admin reveal               |

`GET /v1/admin/settings` 继续返回标量设置；Admin UI 组合调用两组接口，不把所有 Provider 强行塞进 `SystemSetting` 响应。

### 9.2 读响应示例

```json
{
  "group": "places",
  "label": "地图服务",
  "routingMode": "merge",
  "maxAttempts": 3,
  "cooldownSeconds": 30,
  "version": 7,
  "providers": [
    {
      "id": "019c...",
      "adapter": "tencent",
      "preset": "tencent",
      "label": "腾讯地图",
      "enabled": true,
      "priority": 10,
      "version": 2,
      "config": {
        "baseUrl": "https://apis.map.qq.com/ws",
        "timeoutMs": 1500,
        "regions": ["cn"],
        "dailyQuota": 10000
      },
      "secrets": [{ "field": "apiKey", "hasValue": true, "last4": "ab12", "version": 1 }],
      "health": {
        "status": "healthy",
        "lastCheckedAt": "2026-11-22T12:00:00.000Z",
        "lastErrorCode": null,
        "cooldownUntil": null
      }
    }
  ]
}
```

### 9.3 写请求示例

```json
{
  "group": "ai",
  "adapter": "openai-chat",
  "preset": "deepseek",
  "label": "DeepSeek",
  "enabled": true,
  "priority": 20,
  "config": {
    "baseUrl": "https://api.deepseek.com/v1",
    "defaultModel": "deepseek-chat",
    "timeoutMs": 30000,
    "maxOutputTokens": 8192
  },
  "secrets": {
    "apiKey": "plaintext-only-in-this-request"
  }
}
```

写响应绝不返回 `secrets` 明文，只返回 secret state。

已存在 Provider 的 secret 替换统一走：

```json
{
  "value": "plaintext-only-in-this-request",
  "expectedVersion": 2
}
```

成功后返回 `{ field, hasValue, last4, version }`，bump secret/version，写审计；
旧密文进入 history，不返回。创建 Provider 时仍允许在 `secrets` 中一次性提交
初始字段；后续修改不得再把 secret 混入普通 Provider PATCH。

### 9.4 乐观版本

- `PATCH` 必须带 `expectedVersion`；版本不匹配返回 409 `PROVIDER_VERSION_CONFLICT`。
- reorder 必须带 `expectedGroupVersion`；不匹配返回 409 `PROVIDER_ORDER_CONFLICT`。
- policy 更新同样使用 `expectedVersion`。
- 所有成功写操作 bump version 并发布缓存失效事件。

### 9.5 稳定错误码

```text
PROVIDER_GROUP_NOT_FOUND
PROVIDER_NOT_FOUND
PROVIDER_VERSION_CONFLICT
PROVIDER_ORDER_CONFLICT
PROVIDER_ADAPTER_UNSUPPORTED
PROVIDER_ACTIVE_CONFLICT
PROVIDER_CONFIG_INVALID
PROVIDER_SECRET_FIELD_UNKNOWN
PROVIDER_SECRETS_UNAVAILABLE
PROVIDER_PROBE_FAILED
PROVIDER_PROBE_TIMEOUT
PROVIDER_MODELS_DISCOVERY_FAILED
PROVIDER_MODELS_DISCOVERY_TIMEOUT
PROVIDER_MODELS_DISCOVERY_UNSUPPORTED
PROVIDER_MODELS_RESPONSE_TOO_LARGE
PROVIDER_EGRESS_BLOCKED
PROVIDER_LIMIT_REACHED
AI_MODEL_NOT_ALLOWED
AI_PROVIDERS_UNAVAILABLE
```

`PROVIDER_PROBE_FAILED` 可以包含安全的 `checks[]`，不能包含上游 body。

## 10. 运行时解析与缓存

### 10.1 ProviderRuntimeResolver

新增：

```ts
interface ProviderRuntime {
  id: string;
  group: "ai" | "places" | "mail" | "storage";
  adapter: string;
  preset: string | null;
  label: string;
  priority: number;
  config: unknown;
  secrets: Readonly<Record<string, string>>;
  health: ProviderHealth;
}
```

职责：

- 一次 DB 查询读取 group policy + providers；
- 批量读取 secrets（只读密文）；
- 使用 Zod adapter schema 校验 config；
- 解密 secrets；
- 过滤 deleted/disabled；
- 按 priority 排序；
- 返回不可变 snapshot。

### 10.2 缓存

- Provider snapshot 进程内缓存 5 秒；secret 只在进程内存。
- Redis 只存 group generation/version，不存 secret。
- 写入后：
  1. `version = version + 1`（事务内）
  2. 清空本进程 cache
  3. publish `provider-config:invalidate`（group、version、providerIds）
- 其他实例收到 invalidate 后清空。
- Places cache key 必须包含 group version + 有资格的 provider IDs，不能只缓存 query route。
- AI 的模型名称/目录缓存以 providerId 为 key，不能继续使用单个全局 5 分钟 cache。
- `ProviderSecretHistory` 由清理任务按 `expiresAt` 删除；回滚读取必须有独立审计。

### 10.3 兼容层

`ProviderConfigMode = "legacy" | "shadow" | "v2"`，按 group 配置或环境变量：

- `legacy`：读旧 SystemSetting，行为不变。
- `shadow`：并行解析 legacy 与 v2，只记录 redacted 差异，不实际使用 v2。
- `v2`：实际使用 ProviderConnection。

默认发布顺序：

1. 代码部署但 mode=legacy；
2. 确认现有生产 keyring（不要重复生成）；
3. 导入 Provider/密钥；
4. mode=shadow 观察 24h；
5. mode=v2；
6. 保留 legacy 至少一个发布周期；
7. 最后再考虑删除旧 key。

## 11. Admin UI 合同

完整交互由配套 UI 规格定义。后端必须提供：

- group policy + ordered providers；
- provider catalog；
- `preset` 目录与 adapter 映射；
- secret state；
- 健康/检查状态；
- 模型列表与能力；
- 版本冲突错误；
- 安全的 probe/discovery 错误码。

UI 不应：

- 根据 provider 名称硬编码表单；
- 读取完整 secret；
- 在前端持久化 secret；
- 在请求失败时丢弃用户已填内容；
- 把多个 Provider 拼成一段逗号分隔字符串。

## 12. 迁移与 Key 导入

### 12.1 新迁移

建议下一个 migration：`0016_provider_connections`。

要求：

- 只新增表/索引/约束，不删除/重命名旧表；
- 空库执行通过；
- 已有 `SystemSetting` 数据执行通过；
- 迁移后 `SystemSetting` 行保持只读兼容；
- 不允许 migration 在缺少 keyring 时自动复制 secret。

### 12.2 Legacy 映射

| 旧数据                    | 新模型                                                             |
| ------------------------- | ------------------------------------------------------------------ |
| `ai.defaultProvider`      | AI Provider.adapter（旧值实际是 protocol）；preset 按 adapter 映射 |
| `ai.baseUrl` / `ai.model` | AI Provider.config 与默认模型                                      |
| `ai.apiKey`               | ProviderSecret.field=apiKey                                        |
| `ai.vision`               | 旧 Provider 默认模型的 capability.vision                           |
| `places.provider`         | Places Provider.adapter/preset                                     |
| `places.apiKey`           | Geoapify ProviderSecret（仅 Geoapify）                             |
| `TENCENT_MAPS_KEY`        | Tencent ProviderSecret（一次性导入，priority 10）                  |
| `GEOAPIFY_API_KEY`        | Geoapify ProviderSecret（一次性导入，priority 20）                 |
| `PLACES_SOURCES/ORDER`    | group policy + priority                                            |
| `mail.*`                  | Mail Provider + secrets                                            |
| `storage.*`               | Storage Provider + secrets                                         |

`local` / `map_pin` 不迁移为网络 Provider，继续作为 fallback 语义。

### 12.3 安全导入命令

必须提供 CLI，实际 key 不接受命令行明文参数：

```bash
pnpm providers:import \
  --group=places \
  --adapter=tencent \
  --preset=tencent \
  --label="腾讯地图" \
  --priority=10 \
  --api-key-stdin
```

行为：

- 从 stdin 读取 key，不 echo；
- 校验现有 keyring，不存在则 fail closed；不得创建第二把 key；
- 查重 `(group, adapter, label)`；
- 幂等：已存在时默认只更新非 secret 配置，`--replace-secret` 才更新 secret；
- 写 `ProviderSecret` + AuditLog；
- stdout 最多输出 providerId、adapter/preset、secret last4、是否新建。
- 导入腾讯与 Geoapify 后默认 priority 分别为 10/20；运营可在 UI 重排。

用户明确要求的腾讯/Geoapify key 导入验收：

1. `ProviderConnection` 中有 `tencent` 和 `geoapify` 两行；
2. `ProviderSecret` 两行均有 ciphertext，无 plaintext；
3. API 列表显示 `hasValue=true` + 正确 last4；
4. 运行时实际搜索可命中两个 Provider；
5. 重排后 priority 生效；
6. 任何 API/HTML/日志/Audit 中都不出现明文 key。
7. 两者默认同时 enabled，places group mode=`merge`；严格顺序通过
   `priority_failover` 验收。

### 12.4 回滚

- 保留 legacy `SystemSetting` 行至少一个发布周期；
- 保留 `ProviderConnection/Secret/Model` 表；
- 可把 group mode 切回 `legacy`；
- 不回滚 secret keyring；
- 不在回滚时删除 key 或 ciphertext。

## 13. 可观测性与审计

每次 Provider 操作记录：

- `admin.provider.created`
- `admin.provider.updated`
- `admin.provider.deleted`
- `admin.provider.reordered`
- `admin.provider.probed`
- `admin.provider.models_refreshed`
- `admin.provider.secret_revealed`
- `admin.provider.secret_updated`
- `admin.provider.secret_replaced`
- `admin.provider.order_updated`

Audit metadata 只含：

- group
- providerId
- adapter
- preset
- changed field names
- priority
- safe health/error code
- secret field 名和 last4

不含：

- secret 明文
- 完整 URL 的 query
- 上游错误 body
- Authorization header

指标建议：

- `provider_attempts_total{group,adapter,result}`
- `provider_failover_total{group,from_adapter,to_adapter,reason}`
- `provider_cooldown_active{group,adapter}`
- `provider_model_discovery_total{group,adapter,result}`

标签禁止包含 URL、key、用户输入。

## 14. 测试与验收

### 14.1 单元

- Zod 合同：每个 adapter 的合法/非法 config。
- 排序、priority tie-break、reorder 版本冲突。
- secret encrypt/decrypt/AAD/key ring rotation。
- secret 原子替换、history 24h、history 不出 API、history 清理任务。
- 每个 Provider 最多一个默认模型；并发保存不产生双默认。
- failover 分类矩阵（timeout/429/5xx/401/400）。
- 流式开始前/后 failover 行为。
- Places merge 与 priority_failover。
- model catalog 解析（OpenAI `data[]`、Anthropic、unsupported/manual）。
- AI presets -> adapter/baseUrl/discovery 映射。
- Provider `preset` 与 adapter 不匹配时拒绝。
- SSRF：localhost、RFC1918、IPv6 loopback、metadata、redirect、超尺寸 body、超时。

### 14.2 集成

- 空库 migration。
- 已有 `SystemSetting` + secrets 的 migration。
- Provider CRUD + secret upsert + audit 在 Postgres 上通过。
- `PUT secrets/:field` 的 expectedVersion、幂等、history 与审计。
- 两个 API 实例共享 Redis 时，写入后另一实例 5 秒内失效。
- key ring 缺失时 secret 写返回稳定 503。
- Mail/Storage 第二个 active 返回 `PROVIDER_ACTIVE_CONFLICT`。
- 旧数据导入幂等，重复执行不创建副本。
- Probe/discover stub 必须返回固定 schema：`{data:[{id,display_name?,owned_by?}]}`
  或 Anthropic `{data:[{id,display_name?}]}`；断言响应上限、超时、redirect、
  私网/metadata 拒绝，且错误不含上游 body。

### 14.3 真实浏览器 E2E

必须使用真实 dev/prod 构建 + 真实 API + Postgres + Redis + 登录/2FA：

1. 超管打开 AI 服务；
2. 添加两个 AI Provider，分别填 baseUrl/key；
3. 获取模型列表，选择默认模型；
4. 保存后刷新仍在；
5. 调整顺序；
6. 让第一 Provider 失败，验证 fallback 到第二；
7. 添加腾讯和 Geoapify，两个 key 均显示 masked；
8. 调整地图优先级；
9. 通过搜索触发两个 Provider；
10. 关闭/失败一个 Provider 后仍有结果；
11. 切到 `priority_failover`，用第一 Provider 500 验证严格顺序回退；
12. 桌面 1440px + 移动 390px 截图；
13. 断言页面中没有 secret 明文；
14. API 日志中没有 secret 明文；
15. 替换一次 secret，确认 last4/version 变化、旧 history 不暴露。

### 14.4 发布 Gate

- `pnpm typecheck`
- `pnpm test`
- `pnpm contracts:check`
- API/Admin build
- 真实 E2E 全部通过
- `pnpm security:check`
- `pnpm staging:validate`
- 数据库备份/恢复演练
- 验证现有 keyring（不重复生成）、secret 导入、回滚演练

## 15. 交付波次与并行边界

### Wave 0：合同冻结

负责人：architect + contracts owner

- 完成本规格和 UI 规格评审；
- 冻结 Provider/Group/Model/Secret 合同；
- 冻结 catalog；
- 不改 UI。

### Wave 1：数据与 API 基础

负责人：backend_api + db

- migration；
- ProviderConfigService；
- SecretBox 迁移；
- provider CRUD/order/version；
- provider catalog；
- 单元/集成测试。

### Wave 2：AI 运行时 + 模型

负责人：ai backend

- AiProviderRouter；
- model discovery/persistence；
- failover/health/cooldown；
- 删除/降级旧的单实例路径。

### Wave 3：Places 运行时

负责人：places backend

- ProviderRuntime 改造；
- merge/priority_failover；
- per-provider quota/cache/regions；
- Tencent/Geoapify 双 key 导入；
- 真实搜索验证。

### Wave 4：Admin UI

负责人：admin frontend

- 通用 Provider 列表/卡片/表单；
- 排序；
- 模型发现与选择；
- secret 状态；
- probe 状态；
- 响应式/a11y；
- E2E 截图。

### Wave 5：Mail/Storage 单活跃规则与后续多实例

负责人：backend + admin，单独立项

- v1 在统一 Provider UI 中保存 Mail/Storage 实例，但只允许一个 active；
- Mail 防重复投递评审，Storage 对象路由/迁移方案分别立项；
- 后续版本才允许 Mail/Storage 多实例路由。

并行规则：

- Wave 1 完成前，AI/Places/UI Agent 不得编辑同一 contracts/schema。
- Wave 1 contract 冻结后，AI 和 Places 可并行。
- UI 以 catalog/response 类型为准，不得自行扩展字段。
- QA 独立于实现，只验收真实用户旅程。

## 16. 冻结决策记录

| 决策              | 冻结值                                                                                   | 影响/代价                                                     |
| ----------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Provider 词表     | `group` / `adapter` / `preset` / `label`                                                 | UI 显示 preset，高级诊断显示 adapter                          |
| AI v1 路由        | `priority` only；流开始后不切换                                                          | 不做 round-robin/负载均衡                                     |
| AI presets        | OpenAI/DeepSeek/OpenRouter/Groq/Together/Gemini-OpenAI/Custom/Anthropic/OpenAI Responses | 无 native Gemini/OpenRouter adapter；不支持的目录允许手动模型 |
| Secret v1         | 单 active `ProviderSecret` + 24h history；原子 replace                                   | 不做多 active/standby credential UI                           |
| 默认模型          | 每 Provider 最多一个                                                                     | 服务层事务 + 测试；DB 尽量加约束                              |
| Places 默认       | `merge`，priority 做 tie-break/source order                                              | 严格顺序需显式 `priority_failover`                            |
| Mail/Storage v1   | 统一 Provider UI，只允许一个 active                                                      | 多实例路由后续立项                                            |
| 腾讯/Geoapify key | 当前 keyring + 安全 stdin CLI 导入；priority 10/20                                       | 不生成第二把 key，不打印明文                                  |
| AI vision         | per-model capability，默认 false                                                         | 旧 `ai.vision` 只做兼容读取                                   |
| SSRF              | 生产拒绝私网/metadata/redirect/DNS rebinding                                             | 自托管私网需显式非生产豁免                                    |
| Workspace 范围    | v1 仅平台级 Provider                                                                     | 不做 workspace 覆盖                                           |

用户已明确要求腾讯和 Geoapify key 都进入服务器数据库；安全导入是该需求的
一部分，不由 UI 重录替代。本地 `.env.local` 的键值只能由 root 的安全
importer 读取。

## 17. 来源

检索日期：2026-11-22。

### 内部成熟实现

- 多源地图召回与合并：`apps/api/src/modules/places/places.service.ts:86-130, 172-306, 331-455`
- Provider 级 quota/cache 思路：`apps/api/src/modules/places/places-quota.service.ts`、`places-cache.service.ts`
- secret envelope/key ring：`apps/api/src/modules/settings/secret-box.ts:131-220`
- 设置缓存/审计：`apps/api/src/modules/settings/settings.service.ts:212-373`
- 真实 probe：`apps/api/src/modules/settings/settings-save-probe.service.ts`
- AI 模型 selector/allow-list 已有实现：`apps/api/src/modules/ai/ai-plan.service.ts:767-850`
- AI 模型合同来源：`packages/contracts/src/api/ai.ts` 引用的 vercel/chatbot `lib/ai/models.ts` L17–L24，Apache-2.0。

### 外部模式与官方文档

- LiteLLM Router — load balancing / retries / cooldowns / fallbacks / order：
  - https://docs.litellm.ai/docs/routing
  - `BerriAI/litellm` @ `90dce4b93bd2b090621a6b9083311294d3358bc6`
  - 许可证：企业目录外 MIT（仓库根 LICENSE；企业目录 license 不适用）
  - 规格采用的是 routing/fallback 概念，不复制 Python 代码。
- OpenAI API Reference — List models：
  - https://platform.openai.com/docs/api-reference/models/list
- Anthropic API Reference — List Models：
  - https://docs.anthropic.com/en/api/models-list
- Geoapify Address Autocomplete API：
  - https://apidocs.geoapify.com/docs/geocoding/address-autocomplete/
- 腾讯位置服务 WebService API：
  - https://lbs.qq.com/service/webService/webServiceGuide/webServiceSuggestion

## Appendix A — 建议的迁移文件

```text
packages/db/prisma/migrations/0016_provider_connections/migration.sql
packages/db/prisma/migrations/0016_provider_connections/schema.prisma.patch
```

迁移只新增：

- ProviderGroupPolicy
- ProviderConnection
- ProviderSecret
- ProviderSecretHistory
- ProviderModel
- 必要索引/CHECK

不修改或删除 SystemSetting。

## Appendix B — 实施前检查清单

- [ ] 本规格已由根 Agent 审核，并与 UI 规格同步冻结词表/路由/主题边界
- [x] Storage/Mail 第一波单 active；Places 默认 merge、显式 priority_failover
- [x] 生产已存在 `CONFIG_ENCRYPTION_KEY`；本次不得重复生成
- [ ] 腾讯/Geoapify key 通过当前 keyring + 安全 stdin 导入
- [ ] 迁移备份和回滚演练通过
- [ ] 未提交的单 Provider AI discovery 增量：只复用解析器/安全上限，丢弃旧 UI
- [ ] 各 Wave 文件所有权已拆分，无共享文件并发写

## Appendix C — 需求覆盖矩阵

| 用户需求                     | 本规格位置        | 冻结结果                                               |
| ---------------------------- | ----------------- | ------------------------------------------------------ |
| AI 多厂商、多实例            | §5, §6.2, §7.1    | ProviderConnection + preset/adapter，priority failover |
| 填 API/Key 自动拉模型        | §7.1, §9.1, §14   | 服务端 discovery、持久化 ProviderModel、错误状态       |
| 地图腾讯 + Geoapify          | §6.3, §7.2, §12.3 | 两个 Provider 同时 enabled，默认 merge                 |
| 逐个优先级/回退              | §5.3, §7.2, §14.3 | merge tie-break + 显式 priority_failover               |
| Key 写入数据库               | §5.2, §8, §12     | ProviderSecret + current keyring + 安全 importer       |
| 通用设置 UI/逻辑             | §6.1, §9, §11     | catalog 驱动 Provider 资源，不再写死 key               |
| 企业级 secret/RBAC/2FA/audit | §8, §9.4, §13     | write-only、version、2FA、审计、24h history            |
| 全部修复后再部署             | §14.4, Appendix B | 真实 E2E + Gate 前禁止发布                             |
