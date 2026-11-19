# 后台系统设置 + 客户端图片处理 / Live Photo：开源调研与 Roamlog 落地方案

- 任务 ID：`RESEARCH_ADMIN_MEDIA`（只调研，不写产品代码）
- 调研时间：2026-11-19（Asia/Shanghai）
- 调研范围：A. 后台系统设置；B. 浏览器端图片压缩；C. iOS Live Photo / Android Motion Photo；D. 存储桶后台配置
- 数据口径：stars / 最后 push 通过 `ungh.cc/repos/<owner>/<repo>` 于 2026-11-19 读取；license 通过仓库根 `LICENSE` 原文核对；npm 版本 / 周下载量来自 npm registry 与 `api.npmjs.org` 当日快照；仓库内文件路径与行号来自 CodeGraph 当前索引（`roamlog/.codegraph`，1,485 文件）。
- 边界：未修改 `apps/`、`packages/` 下任何文件；未安装依赖；本文件是唯一产物。
- 未验证项统一标 `未验证`，并在 §7 汇总。

---

## 1. 结论摘要（6 条）

1. **不要从零设计设置模型，直接抄 Hoppscotch 的 `InfraConfig` 表 + Immich 的 Zod/可见性分层。** Hoppscotch 是 NestJS + Prisma 的精确栈匹配（`InfraConfig`：`id / name unique / value / isEncrypted / lastSyncedEnvFileValue`），Immich 则给出了目前开源里最完整的「一份配置 → Admin / User / Public 三种投影」的 Zod 实现。两者组合即可覆盖 Roamlog 缺的全部设置分组。
2. **敏感配置必须"只写不读"，不要学 Hoppscotch 把解密后的值返回给管理员。** Hoppscotch 的 `isEncrypted` 只解决落盘加密，`cast()` 仍把明文交给 GraphQL；Roamlog 应改为 `hasValue + last4 + updatedAt`，密文用 AES-256-GCM 逐键加密，密钥来自独立 env（key ring，可轮转）。
3. **生效方式选「DB + 读穿缓存 + Redis pub/sub 失效」，不要重启、不要配置中心。** 单体 Next + Nest + Worker 的规模，重启会让后台"保存后无反馈"、多实例不一致；配置中心（Consul/Apollo）是过度设计。只有 `DATABASE_URL / REDIS_URL / SETTINGS_ENCRYPTION_*` 这类引导密钥留在 env。
4. **客户端压缩用「手写 OffscreenCanvas Worker + `@jsquash/webp` 兜底」最稳，不建议把 `browser-image-compression` 当唯一方案。** 后者内置 Worker 但仓库最后 push 是 **2024-03-08**、不支持 HEIC、无法精确控制目标字节；`compressorjs` 在主线程；`pica` 只做缩放不做编码；`@jsquash/*` 是 WASM codec、可在 Worker 内用，但 AVIF 包 8.36 MB（unpacked）。
5. **服务端 sharp 必须保留，但职责改为「校验 + 剥 EXIF + 缩略图/blurhash + 可选 AVIF」，不再重复全量压缩。** 客户端产出 2000px WebP 后，服务端只从它生成 thumb/blurhash；若 `variants.client` 存在且校验通过，跳过 medium/large 重编码。HEIC 原图在 sharp 预编译二进制上能否解码 `未验证`（专利/编译选项相关），不能作为唯一路径。
6. **Live Photo 的可行路径是「同名配对 + 内容标识校验 + 一条 Media + 一条 MediaMotion」，展示用 `<video muted playsinline preload="none">`；但 iOS Safari 文件选择器是否会把 HEIC+MOV 一起交给网页，必须真机验证。** 这是整个 C 节最大的产品风险，不是代码风险。Android Motion Photo（JPEG 内嵌 MP4）可复用同一 motion 资产模型，增量成本约 1–2 天。

---

## 2. A 节：后台「系统设置」的成熟实现

### 2.1 总表（5 个真实项目）

| 项目 | ★ | 最近 push | 许可证 | 技术栈 | 配置数据模型 | 最值得借鉴 |
|---|---:|---|---|---|---|---|
| [immich-app/immich](https://github.com/immich-app/immich) | 119,583 | 2026-11-18 | AGPL-3.0 | NestJS + SvelteKit + Kysely | **单份嵌套配置**（Zod schema + `defaults`），按 Admin/User/Public 三种可见性投影 | 类型/默认值/校验/可见性分层；`ConfigValidate` → `ConfigUpdate` 事件；env 覆盖时禁止改 |
| [hoppscotch/hoppscotch](https://github.com/hoppscotch/hoppscotch) | 80,841 | 2026-11-05 | MIT | **NestJS + Prisma** + Vue | **KV 表** `InfraConfig`，`isEncrypted` 标记密文，启动时从 env 播种，记录 `lastSyncedEnvFileValue` | Prisma 表 / 迁移 / 启动播种 / env 冲突检测；但"改完重启"和"解密后返回"要改掉 |
| [ToolJet/ToolJet](https://github.com/ToolJet/ToolJet) | 41,247 | 2026-11-18 | AGPL-3.0 | NestJS + TypeORM + React | **行式设置** `instance_settings`：`key / value / data_type / type(user\|system) / label / helper_text` | 把后台表单需要的 `dataType`、i18n label、helper text 直接放进表，前端可自动渲染 |
| [RocketChat/Rocket.Chat](https://github.com/RocketChat/Rocket.Chat) | 46,488 | 2026-11-18 | MIT（核心；`ee/` 单独许可） | Meteor + MongoDB + React | **文档式设置** `settings`：`type`（20+ 种）/ `group` / `section` / `public` / `secret` / `env` / `packageValue` / `processEnvValue` / `valueSource` | **env / 默认值 / DB 值三级优先级**，以及 `public/hidden/secret/blocked` 语义 |
| [TryGhost/Ghost](https://github.com/TryGhost/Ghost) | 55,850 | 2026-11-18 | MIT | Node + Bookshelf + Ember | **经典 KV** `settings`：`key / value / type / flags / group` + 内存 `settingsCache` | 最小字段集；`type + flags + group` 就够支撑后台分组与主题只读项；缓存失效简单 |

> 说明：五者没有一个是 "NestJS + Prisma + Next" 的完整同构项目。Hoppscotch 是后端同构度最高的（NestJS + Prisma），Immich 是设置语义最完整的，Rocket.Chat 的 env 优先级最值得抄。Directus 的 `directus_settings` 是 singleton 宽表方案，但其根 `LICENSE` 在 `main` 上 404，未纳入本表。

### 2.2 逐项回答

#### （1）配置项的数据模型

**Immich — 一份嵌套 JSON，Zod 定义，带默认值与可见性**

- 文件：[`server/src/dtos/config.dto.ts`](https://github.com/immich-app/immich/blob/main/server/src/dtos/config.dto.ts)
- 结构（节选，字段名逐字来自源码）：

```ts
const AdminConfigSchemaWithVisibility = z.object({
  backup: z.object({ beta, database: { enabled, cronExpression, keepLastAmount } }),
  ffmpeg: z.object({ crf, threads, preset, targetVideoCodec, ..., realtime: {...} }),
  image: z.object({
    thumbnail: { format, size, quality, progressive, effort },
    preview:   { format, size, quality, progressive, effort },
    fullsize:  { enabled, format, quality, progressive, effort },
    colorspace, extractEmbedded,
  }),
  job: z.object({ thumbnailGeneration: { concurrency }, metadataExtraction: {...}, ... }),
  logging: { enabled, level },
  machineLearning: { enabled, urls, clip, facialRecognition, ocr, ... },
  map: { enabled, lightStyle, darkStyle },
  notifications: { smtp: { enabled, from, replyTo, transport: { host, port, secure, username, password } } },
  oauth: { clientId, clientSecret, issuerUrl, scope, ... },
  server: { externalDomain, loginPageMessage, publicUsers },
  theme: { customCss },
  trash: { enabled, days },
  user: { deleteDelay },
});
export type SystemConfig = z.infer<typeof AdminConfigSchemaWithVisibility>;
export const defaults = Object.freeze<SystemConfig>({ ... });
export class AdminConfigDto extends createZodDto(AdminConfigSchema) {}
export class UserConfigDto  extends createZodDto(UserConfigSchema) {}
export class PublicConfigDto extends createZodDto(PublicConfigSchema) {}
```

- 关键设计：每个字段可挂 `.meta({ visibility: User | Public })`，`applyVisibility()` 递归裁剪出三套 schema；敏感字段默认 `Admin`，因此 **User/Public 投影天然不包含 `oauth.clientSecret`、SMTP `password`**。
- 校验：`updateAdminConfig()` 触发 `ConfigValidate` 事件，任何订阅者抛错都会变成 `BadRequestException`；若 `IMMICH_CONFIG_FILE` 环境变量存在，直接拒绝写入（文件是唯一 source of truth）。
- 生效：`ConfigUpdate` 事件 + `clearConfigCache()`，无需重启。

**Hoppscotch — KV 表 + 加密标记 + env 同步**

- 迁移原文（[`20231124104640_infra_config/migration.sql`](https://github.com/hoppscotch/hoppscotch/blob/main/packages/hoppscotch-backend/prisma/migrations/20231124104640_infra_config/migration.sql)）：

```sql
CREATE TABLE "InfraConfig" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "value" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedOn" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InfraConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InfraConfig_name_key" ON "InfraConfig"("name");
```

- 后续演进：[`infra_config_encryption`](https://github.com/hoppscotch/hoppscotch/blob/main/packages/hoppscotch-backend/prisma/migrations/20240725043411_infra_config_encryption/migration.sql) 加 `isEncrypted BOOLEAN DEFAULT false`；[`infra_config_sync_with_env_file`](https://github.com/hoppscotch/hoppscotch/blob/main/packages/hoppscotch-backend/prisma/migrations/20241118054346_infra_config_sync_with_env_file/migration.sql) 去掉 `active`、加 `lastSyncedEnvFileValue TEXT`。
- 键清单在 [`src/types/InfraConfig.ts`](https://github.com/hoppscotch/hoppscotch/blob/main/packages/hoppscotch-backend/src/types/InfraConfig.ts)：JWT/SESSION secret、SMTP 全套、Google/GitHub/Microsoft OAuth、限流、分析开关、onboarding。

**ToolJet — 行式设置 + UI 元数据**

- [`server/src/entities/instance_settings.entity.ts`](https://github.com/ToolJet/ToolJet/blob/develop/server/src/entities/instance_settings.entity.ts)：

```ts
@Entity({ name: 'instance_settings' })
export class InstanceSettings extends BaseEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() label: string;
  @Column({ name: 'label_key' }) labelKey: string;
  @Column({ unique: true }) key: string;
  @Column() value: string;
  @Column({ name: 'data_type' }) dataType: string;
  @Column({ name: 'helper_text' }) helperText: string;
  @Column({ name: 'helper_text_key' }) helperTextKey: string;
  @Column({ type: 'enum', enum: ['user', 'system'], default: 'user' }) type: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
```

- `value` 永远是字符串，`data_type` 决定反序列化；`type=user|system` 区分用户偏好与平台配置。这一套最适合 Next 后台做"按 dataType 渲染控件"。

**Rocket.Chat — 最完整的设置文档**

- [`packages/core-typings/src/ISetting.ts`](https://github.com/RocketChat/Rocket.Chat/blob/develop/packages/core-typings/src/ISetting.ts) 字段（逐字）：

```ts
type: 'boolean' | 'timezone' | 'string' | 'relativeUrl' | 'password' | 'int' | 'select'
    | 'multiSelect' | 'language' | 'color' | 'font' | 'code' | 'action' | 'asset'
    | 'roomPick' | 'group' | 'date' | 'lookup' | 'multiLookup' | 'range' | 'timespan';
public: boolean;
env: boolean;                    // env 锁定时为 true
group?: string | null;
section?: string;
tab?: string;
i18nLabel: string;
i18nDescription?: string;
value: SettingValue;
packageValue: SettingValue;      // 代码默认值
processEnvValue?: SettingValue;  // env 值
meteorSettingsValue?: SettingValue;
valueSource?: 'packageValue' | 'processEnvValue';
blocked: boolean;
hidden?: boolean;
secret?: boolean;
enterprise?: boolean;
requiredOnWizard?: boolean;
validation?: SettingValidation;  // cron / query 等
enableQuery?: EnableQuery;       // 满足条件才可改
displayQuery?: EnableQuery;
invalidValue?: SettingValue;
sorter: number;
values?: Array<ISettingSelectOption>;
wizard?: { step: number; order: number } | null;
```

- 读写实现 [`packages/models/src/models/Settings.ts`](https://github.com/RocketChat/Rocket.Chat/blob/develop/packages/models/src/models/Settings.ts) 里，`updateValueById` 自带 `blocked !== true` 与 `value !== 新值` 守卫；`resetValueById` 用 `valueSource || 'packageValue'` 决定回退到默认还是 env；`findNotHiddenPublic` 用 projection 只暴露 public 字段。这是"设置行自带行为"的典范。

**Ghost — 最小 KV**

- `settings` 表：`key`（unique）、`value`（text）、`type`（string/number/boolean/json）、`flags`（如 `PUBLIC`、`RO`）、`group`（site/theme/email/members/analytics…），外加 `created_at/updated_at`。
- 运行时 `settingsCache` 常驻内存，`SettingsBreadService.edit()` 写库后发事件清缓存；后台按 `group` 渲染。
- 说明：`ghost/core/core/server/data/schema/schema.js` 在当前 `main` 上取不到（404），以上字段按 Ghost 5.x 公开表结构整理，**路径与字段未逐行核对当前 main**。

#### （2）敏感配置如何存与展示

| 项目 | 落盘 | 管理端读取 | 轮转 | 评价 |
|---|---|---|---|---|
| Immich | 明文存在配置 JSON | Admin 视图返回明文；User/Public 投影裁掉 | 无 | 可见性隔离，不是加密；DB 泄露即泄露 |
| Hoppscotch | `isEncrypted` 行用 `encrypt()/decrypt()` | `cast()` 解密后返回给 admin GraphQL | 无 key version | 有加密但"可读"，且密钥轮转未建模 |
| ToolJet | 明文 `value` | 后台直接显示 | 无 | 依赖 DB 权限 |
| Rocket.Chat | 明文在 Mongo | `secret: true` 的项在 UI 掩码；`public: false` 不下发客户端 | 无 | 语义完整，落盘不加密 |
| Ghost | 明文 `settings.value` | 仅 admin API 可见；Mailgun key 等由 UI 掩码 | 无 | 同上 |

**Roamlog 应采用（比以上都严格）：**

- 逐键信封加密：`AES-256-GCM`，`iv` 12B，`tag` 16B，AAD = `system-setting:<key>:v<keyVersion>`，防止把 A 键密文搬到 B 键。
- 列表/详情 API 永不返回密文或明文，只返回：

```json
{ "key": "storage.secretKey", "isSecret": true, "hasValue": true, "last4": "9f3a", "updatedAt": "...", "updatedBy": "..." }
```

- 写入是 write-only：`PUT` 传新值；传空字符串表示"清除"；传 `null` 表示"不变"。前端不做"显示密码"。
- 密钥轮转：`SETTINGS_ENCRYPTION_KEYS={"1":"<base64 32B>","2":"<base64 32B>"}` + `SETTINGS_ENCRYPTION_ACTIVE_VERSION=2`；解密按行内 `keyVersion` 选 key；后台提供"轮转任务"，逐行 re-encrypt，完成后可移除旧 key。
- 审计只记 `oldValueHash/newValueHash`（SHA-256）与 `secret: true`，绝不记明文。

#### （3）生效方式：立即生效 vs 重启 vs 配置中心

| 方案 | 代表 | 优点 | 缺点 | 对 Roamlog 的适配 |
|---|---|---|---|---|
| 读 DB，立即生效 | Immich、Ghost、Rocket.Chat | 保存即生效；多实例一致；可回滚 | 每次读要缓存/失效；热更新客户端要重建 | **推荐** |
| 写 env/文件，重启 | Hoppscotch（`stopApp()`） | 实现最简单；启动时校验一次 | 后台"保存后服务重启"；容器编排依赖 restart policy；多实例滚动期间配置不一致 | 只用于引导密钥 |
| 配置中心（Consul/Apollo/Nacos） | 大型多云系统 | 灰度、版本、推送 | 多一个高可用组件；本地开发复杂 | 过度设计 |

**推荐落地：**

- `SystemSettingsService` 读穿缓存：进程内 `Map` + 30s TTL；写入后 `publish('settings:invalidate', { keys, version })`；API 与 Worker 各订阅一个 Redis channel，收到即清本地缓存。
- 读路径：`env override > DB > default`。`envLocked` 在启动时计算（`process.env[ENV_NAME] !== undefined`），后台显示"由环境变量 `MAIL_SMTP_HOST` 锁定"，只读。
- 写入路径：`Zod parse → 业务校验（如 SMTP 配对、S3 HeadBucket）→ 加密 → 事务写 → 审计 → 发布失效`。保存按钮明确写"保存并应用"。
- 失败回滚：保存前先跑校验/探测，失败不落库；需要"先落库再异步验证"的场景（如邮件）标记 `status: unverified`，后台显示未验证。

**只按代码量排序：写 env + 重启最省事；按"产品体验 + 运维"排序：读 DB + 进程内缓存 + Redis 失效最省事。** Roamlog 已经有 Redis（BullMQ/队列），不需要新增组件；"立即生效"的增量大约只有 150 行（一个 SettingsService + 一个订阅），比维护"改完必须重启"的部署脚本更便宜。

#### （4）权限、审计、二次确认

- **谁能改**：Roamlog 现有角色是 Owner/Admin/Editor/Viewer；后台还有平台 `super_admin`。建议：
  - `admin:settings:read`：平台 admin；
  - `admin:settings:write`：仅 `super_admin`；
  - `storage` / `mail` / `security` 三组写入额外要求 **5 分钟内二次认证**（密码 + TOTP），复用 [`platform-two-factor.guard.ts`](roamlog/apps/api/src/modules/admin/platform-two-factor.guard.ts) 的思路，增加 `x-roamlog-reauth` 短时 token。
- **审计**：复用 [`AuditService`](roamlog/apps/api/src/modules/audit/audit.service.ts)，每个键一条 `admin.settings.updated`，metadata 含 `key/group/oldHash/newHash/secret/envLocked`；`storage.test` 也记审计（谁在何时探测了哪个 endpoint）。
- **二次确认**：敏感组用"输入站点名确认"或 TOTP；存储配置提供"测试连接"必须成功后才能保存（或允许"保存但不启用"）。
- **并发**：每行 `version` 乐观锁；两个管理员同时改，后写返回 409。
- **2FA**：不是所有设置都要 2FA；`theme/seo` 可只要求 super_admin，`mail/storage/security` 要求 re-auth。

#### （5）典型分组（Roamlog 版）

| group | 键（示例） | 类型 | 敏感 | 说明 |
|---|---|---|---|---|
| `general` | `site.name`、`site.url`、`site.supportEmail`、`site.locale`、`site.timezone` | string/url/email | 否 | 站点身份 |
| `seo` | `seo.titleTemplate`、`seo.defaultDescription`、`seo.ogImageMediaId`、`seo.robots`、`seo.twitterHandle` | string/enum | 否 | Next `generateMetadata` 读取 |
| `theme` | `theme.accentColor`、`theme.defaultMode`、`theme.customCss`、`theme.logoMediaId`、`theme.faviconMediaId` | string/enum/json | 否 | 自定义 CSS 要 sanitize |
| `mail` | `mail.provider`、`mail.fromName`、`mail.fromEmail`、`mail.replyTo`、`mail.smtpHost/Port/Secure/User/Password`、`mail.resendApiKey` | enum/string/secret | **是** | 保存后可发测试邮件 |
| `storage` | `storage.driver`、`storage.endpoint`、`storage.publicEndpoint`、`storage.publicBaseUrl`、`storage.region`、`storage.bucket`、`storage.accessKey`、`storage.secretKey`、`storage.forcePathStyle`、`storage.signedUrlTtlSeconds`、`storage.mediaSignedUrlTtlSeconds` | enum/url/string/secret/bool/int | **是** | D 节详述 |
| `media` | `media.maxUploadBytes`、`media.clientTargetBytes`、`media.maxEdge`、`media.webpQuality`、`media.avifEnabled`、`media.keepOriginalDefault`、`media.stripExif`、`media.livePhotoEnabled`、`media.motionPhotoEnabled`、`media.variantWidths` | int/bool/json | 否 | 客户端与服务端共用 |
| `rateLimit` | `rateLimit.presignPerMinute`、`rateLimit.uploadsPerHour`、`rateLimit.loginAttempts` | int | 否 | 与现有 guard 配合 |
| `flags` | `flags.registrationOpen`、`flags.invitesOnly`、`flags.commentsEnabled`、`flags.aiEnabled`、`flags.maintenanceMode` | bool | 否 | 现有 feature flags 的补充，长期应合并 |
| `security` | `security.allowedOrigins`、`security.sessionTtlMinutes`、`security.require2faForAdmins`、`security.passwordMinLength` | json/int/bool | 部分 | 改动需 re-auth |

#### （6）推荐项目 + 可直接照搬的文件路径

**首选 Hoppscotch（NestJS + Prisma 精确匹配），辅以 Immich 的 schema/可见性。**

可直接照搬/改写：

| 用途 | Hoppscotch 路径 |
|---|---|
| Prisma 表与演进 | `packages/hoppscotch-backend/prisma/migrations/20231124104640_infra_config/migration.sql`、`.../20240725043411_infra_config_encryption/migration.sql`、`.../20241118054346_infra_config_sync_with_env_file/migration.sql` |
| 服务层骨架 | [`packages/hoppscotch-backend/src/infra-config/infra-config.service.ts`](https://github.com/hoppscotch/hoppscotch/blob/main/packages/hoppscotch-backend/src/infra-config/infra-config.service.ts) |
| 键枚举与分组 | [`packages/hoppscotch-backend/src/types/InfraConfig.ts`](https://github.com/hoppscotch/hoppscotch/blob/main/packages/hoppscotch-backend/src/types/InfraConfig.ts) |
| 管理员入口/Guard | `.../src/infra-config/infra-config.controller.ts`、`.../src/infra-config/infra-config.resolver.ts`、`.../src/admin/guards/rest-admin.guard.ts` |
| 测试样例 | `.../src/infra-config/infra-config.service.spec.ts`（18 KB，覆盖 update/加密/重置） |

照搬时必须改掉三点：
1. `updateMany()` 末尾的 `stopApp()` → 改成 `cache.invalidate + pubsub.publish`；
2. `cast()` 解密后返回 `value` → 改成 `hasValue/last4`；
3. 手写 `validateEnvValues()` switch → 改成 Zod schema + 业务校验（Hoppscotch 的 switch 已经 100+ 行，继续加键会失控）。

**可直接照搬的 Prisma 模型（建议版）：**

```prisma
enum SettingType {
  string
  int
  float
  boolean
  json
  url
  email
  enum
  secret
}

model SystemSetting {
  key           String       @id @db.VarChar(120)
  group         String       @db.VarChar(40)
  type          SettingType
  value         Json?        // 非敏感值；敏感值为 null
  isSecret      Boolean      @default(false)
  secretCipher  Bytes?       // AES-256-GCM ciphertext
  secretIv      Bytes?
  secretTag     Bytes?
  secretLast4   String?      @db.VarChar(4)
  keyVersion    Int          @default(1)
  isPublic      Boolean      @default(false) // 可下发到 web 客户端
  envLocked     Boolean      @default(false)
  defaultValue  Json?
  validation    Json?        // { min,max,pattern,options,protocol }
  label         String       @db.VarChar(120)
  description   String?      @db.VarChar(500)
  sort          Int          @default(0)
  version       Int          @default(1)
  updatedById   String?      @db.Uuid
  createdAt     DateTime     @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime     @updatedAt @db.Timestamptz(3)

  @@index([group, sort])
  @@index([isPublic])
}
```

配套 API（建议挂在现有 `AdminModule` 下）：

```text
GET    /v1/admin/settings?group=storage        → 列表（secret 只返回 hasValue/last4）
GET    /v1/admin/settings/:key/effective       → 只读生效值（secret 打码）
PUT    /v1/admin/settings/:key                  → { value, version, reason? }
POST   /v1/admin/settings/storage/test          → 探测，不落库
POST   /v1/admin/settings/mail/test             → 发测试邮件
POST   /v1/admin/settings/rotate-encryption     → super_admin + re-auth
```

后台入口只需在 [`apps/admin/components/admin-shell/admin-nav.ts`](roamlog/apps/admin/components/admin-shell/admin-nav.ts) 的"数据与运营"组加 `{ href: "/admin/settings", label: "系统设置", icon: Settings }`，页面按 group 渲染 Tab；表单控件由 `type` 决定（boolean→Switch、enum→Select、secret→Password + "已配置 ••••last4"、json→CodeMirror/Textarea）。

---

## 3. B 节：客户端图片压缩

### 3.1 库对比（2026-11-19 快照）

| 库 | 版本 | 许可 | npm unpacked | 周下载 | Web Worker | HEIC 输入 | 输出可控性 | 维护 | 结论 |
|---|---|---:|---:|---:|---|---|---|---|---|
| [browser-image-compression](https://www.npmjs.com/package/browser-image-compression) | 2.0.2 | MIT | 863 KB | 2.25M | ✅ 内置（`useWebWorker`） | ❌ | 中：`maxSizeMB/maxWidthOrHeight/fileType/initialQuality`，靠迭代逼近，不保证目标字节 | **仓库最后 push 2024-03-08**，已停滞 | 可用但不要作为唯一路径；API 简单，适合当 fallback |
| [compressorjs](https://www.npmjs.com/package/compressorjs) | 1.4.0 | MIT | 166 KB | 674K | ❌ 主线程 | ❌ | 中：`maxWidth/maxHeight/quality/mimeType/checkOrientation` | 活跃（1.4.0，2026） | 体积最小，但会卡 UI；只适合小图/兜底 |
| [pica](https://www.npmjs.com/package/pica) | 10.0.3 | MIT | 1.25 MB | 1.83M | ✅ `pica_worker` / WASM | ❌ | **只缩放不编码**：Lanczos/box，质量高；编码要自己 `canvas.toBlob` | 活跃 | 适合"先 resize 再自己编码"；不做目标字节控制 |
| [@jsquash/webp](https://www.npmjs.com/package/@jsquash/webp) | 1.5.0 | Apache-2.0 | 915 KB | 1.27M | ✅ WASM，Worker 友好 | ❌（需先解码成 ImageData） | 高：`quality/effort/lossless`，编码确定性好 | 2025-05 发布，低维护但稳定 | **推荐作为 WebP 编码器**，配合 OffscreenCanvas |
| [@jsquash/avif](https://www.npmjs.com/package/@jsquash/avif) | 2.1.1 | Apache-2.0 | **8.36 MB** | 342K | ✅ WASM | ❌ | 高：`quality/speed` | 2025-05 | 仅 feature flag 开启；编码慢、包大，不建议默认 |
| [heic-to](https://www.npmjs.com/package/heic-to) | 1.6.7 | **LGPL-3.0** | 未测 | 2.55M | ✅ WASM（Worker 可用） | ✅ | 输出 JPEG/PNG，质量参数有限 | 2026-10 活跃 | 解码能力最好，但 **LGPL 需法务确认**（SaaS 捆绑 WASM 的合规性） |
| [heic2any](https://www.npmjs.com/package/heic2any) | 0.0.4 | MIT | 未测 | 2.2M | 未确认 | ✅ | JPEG/PNG/GIF，质量参数有限 | **2023-03 后未更新** | MIT 备选；libheif 较旧，遇到新 HEIC 可能失败 |
| [@discourse/heic](https://www.npmjs.com/package/@discourse/heic) | 1.0.0 | Apache-2.0 | 未测 | 49K | ✅ WASM decoder | ✅ | 只解码到 `ImageData`，编码另选 | 2026-05 | **许可最干净的 HEIC 解码器**，推荐优先评估 |
| 手写 Canvas / OffscreenCanvas + `createImageBitmap` | — | — | 0 | — | ✅（`OffscreenCanvas`） | ❌（浏览器原生支持才行） | **最高**：尺寸/质量/格式/循环全可控 | 平台 API | **推荐作为主路径**；AVIF 编码不行（Chrome canvas 不支持 AVIF encode） |

补充：

- `exifr@7.1.3`（MIT，3.09M/周）只读元数据，支持 JPEG/HEIC/AVIF 容器与 XMP/ICC；**Apple MakerNote 0x0011 是否默认暴露 `未验证`**。
- `mp4box@2.5.0`（BSD-3，857K/周）可解析 MOV/MP4 box；`music-metadata@12.7.0`（MIT，2.82M/周）浏览器可 `parseBlob`，能读 MP4/MOV 标签；两者能否直接给出 `com.apple.quicktime.content.identifier` **未验证**，见 C 节。
- `browser-image-compression` 的体积/维护数据说明：npm 2.0.2 发布于 2023-03，仓库 push 2024-03，尽管周下载 2.25M，**不适合承担新产品的核心链路**。

### 3.2 为什么必须在 Worker 里做

- 25 MB HEIC 解码后位图可能 100 MB+（25MP × 4B），主线程会明显掉帧，移动端 Safari 可能直接 OOM 崩溃。
- `createImageBitmap(file, { resizeWidth, resizeHeight, resizeQuality: 'high' })` 可以**在解码阶段直接降采样**，避免完整位图常驻；Chrome/Firefox 支持，Safari 的支持情况 `未验证`。
- Worker 内用 `OffscreenCanvas.convertToBlob()` 编码；结果 `ArrayBuffer` 用 `transfer` 零拷贝回主线程。

### 3.3 最小可行 Worker 骨架

```ts
// apps/web/workers/image-compress.worker.ts
export type CompressRequest = {
  file: File;
  maxEdge: number;
  targetBytes: number;
  format: "image/webp" | "image/jpeg";
};

export type CompressResponse = {
  buffer: ArrayBuffer;
  width: number;
  height: number;
  type: string;
  quality: number;
  size: number;
  attempts: number;
};

self.onmessage = async (event: MessageEvent<CompressRequest>) => {
  const { file, maxEdge, targetBytes, format } = event.data;

  // 1) 解码时直接按长边降采样，避免 25MP 全量位图
  const probe = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxEdge / Math.max(probe.width, probe.height));
  const width = Math.max(1, Math.round(probe.width * scale));
  const height = Math.max(1, Math.round(probe.height * scale));
  probe.close();

  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "high",
  });

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  // 2) 质量二分/阶梯下降，最多 4 次编码
  let quality = 0.82;
  let blob: Blob | null = null;
  let attempts = 0;
  for (; attempts < 4; attempts++) {
    blob = await canvas.convertToBlob({ type: format, quality });
    if (blob.size <= targetBytes) break;
    quality = Math.max(0.55, quality - 0.08);
  }
  if (!blob) throw new Error("encode failed");

  // 3) 仍超标：交回主线程决定是否缩到 1600（不要在这里无限重试）
  const buffer = await blob.arrayBuffer();
  const response: CompressResponse = {
    buffer,
    width,
    height,
    type: blob.type,
    quality,
    size: blob.size,
    attempts: attempts + 1,
  };
  self.postMessage(response, { transfer: [buffer] });
};
```

主线程：

```ts
const worker = new Worker(new URL("../workers/image-compress.worker.ts", import.meta.url), {
  type: "module",
});
worker.postMessage({ file, maxEdge: 2000, targetBytes: 1_500_000, format: "image/webp" });
worker.onmessage = (event: MessageEvent<CompressResponse>) => {
  const blob = new Blob([event.data.buffer], { type: event.data.type });
  // 预览 + 直接 PUT 到 presigned URL
};
```

注意：

- `File` 是结构化克隆，不是 transferable；`ArrayBuffer` 才是。
- 失败/超时（>20s）降级到主线程 `compressorjs` 或直接上传原图 + 服务端 sharp。
- 同时只跑 1 个 Worker；批量上传排队，避免内存峰值。
- 若 `OffscreenCanvas` 或 `convertToBlob` 不可用（旧 Safari），检测后走主线程 + `canvas.toBlob`，并提示"设备较旧，压缩可能较慢"。

### 3.4 目标参数与质量控制

| 参数 | 建议值 | 说明 |
|---|---|---|
| 长边 | **2000 px** | 覆盖 2x 桌面与大多数手机屏；再大对网页无收益 |
| 目标字节 | **1.5 MB** | 2000px WebP q≈0.75–0.82 通常在 0.4–1.2 MB；1.5 MB 是上限不是目标 |
| 编码 | WebP q=0.82 起，阶梯降到 0.55 | 4 次以内；0.55 仍超 → 缩到 1600px 再编一次 |
| AVIF | 默认关闭 | 只在 feature flag 下；q=50–55、speed 6–8；编码 2–5s，不能阻塞上传 |
| 原图 | 可选保留 | `keepOriginal` 默认 false；开启时额外占 2–3 倍存储 |
| 跳过压缩 | 已是 WebP/AVIF 且 ≤1.5MB 且长边 ≤2000 | 避免二次压缩 |
| 方向 | `imageOrientation: "from-image"` | 方向烘焙进像素，后续不需要 EXIF Orientation |
| ICC | 输出 sRGB；原图保留 ICC | Canvas 默认转 sRGB；P3 广色域图会变色，若用户选"保留原图"则原图不动 |
| EXIF | 派生图**全部剥离** | Canvas 重绘天然丢 EXIF；服务端再剥一次（防御） |
| 并发 | 1 | 移动端内存优先 |

**避免重复压缩：**

- 客户端在上传完成时带 `clientCompressed: { encoder: "offscreen-webp", quality, sourceWidth, sourceHeight, sourceHash }`。
- 服务端把这段写进 `variants.client`；Worker 看到 `variants.client` 且 `sourceHash` 与下载对象 SHA-256 一致，就**只生成 thumb/blurhash**，不再生成 medium/large 的 WebP/JPEG 全量变体。
- 若客户端上传的是原图（未压缩），服务端才走原有 sharp 全量管线。

### 3.5 服务端还要不要 sharp？

**要，但换职责。** 建议：

| 职责 | 客户端 | 服务端 sharp |
|---|---|---|
| 解码/方向 | ✅ | ✅（兜底） |
| 主压缩（2000px WebP） | ✅ | ❌（除非客户端没做） |
| 缩略图 400px | ❌ | ✅ |
| blurhash | ❌ | ✅（4×4 raw，现有 `encodeBlurhash`） |
| magic bytes / 尺寸 / 像素上限 | 部分 | ✅（不可信客户端） |
| EXIF/ICC 剥离 | 部分 | ✅（默认 `sharp` 不保留元数据） |
| AVIF 转码 | 可选 | ✅（异步，按需） |
| HEIC 解码 | 浏览器原生/ WASM | **不依赖**（预编译 sharp 对 HEIC 支持 `未验证`） |

具体：

- 保留现有 [`createImageProcessor()`](roamlog/apps/worker/src/dependencies.ts) 的 thumb/blurhash 逻辑，但 medium/large 改为"仅在无 `variants.client` 时生成"。
- 校验：`sharp(source, { failOn: "error", limitInputPixels: 50_000_000 }).metadata()`，拒绝 >50MP、非图片、magic bytes 不符、声明 mime 不符（现有 `detectImageMime` 已做）。
- 剥 EXIF：`sharp(buf).rotate().toBuffer()` 默认不写回元数据；不要调用 `withMetadata()`。
- AVIF：`sharp(buf).avif({ quality: 50, effort: 4 })` 只在 `Accept: image/avif` 且 feature flag 开启时异步生成；生成失败不影响 ready。
- HEIC：API 已允许 `image/heic|heif`（[`media-rules.ts`](roamlog/apps/api/src/modules/media/media-rules.ts)），但 worker 的 sharp 可能解不了。建议：**客户端先转 WebP 再上传**；若用户坚持上传 HEIC 原图，则只存原图 + 标记 `variants.clientMissing`，后台提示"该图无法生成缩略图"，不要让整个上传失败。

---

## 4. C 节：Live Photo / Motion Photo

### 4.1 iOS Live Photo 的本质

一对资源，用同一个 **asset identifier（UUID 字符串）** 配对：

1. **静图**（HEIC 或 JPEG）：Apple MakerNote 字典的 **tag 17（0x0011）= ContentIdentifier**。ExifTool 的 Apple 标签表明确列出 `0x0011 ContentIdentifier string`（[ExifTool Apple Tags](https://exiftool.org/TagNames/Apple.html)）。
2. **MOV**：QuickTime metadata `com.apple.quicktime.content.identifier = <同一 UUID>`；另有一条 timed metadata track，键 `com.apple.quicktime.still-image-time`，值 `0xFF`，标记静图在视频时间轴上的位置。
3. 参考：[Apple `quickTimeMetadataContentIdentifier`](https://developer.apple.com/documentation/avfoundation/avmetadataidentifier/quicktimemetadatacontentidentifier)、[LimitPoint/LivePhoto README](https://github.com/LimitPoint/LivePhoto)（格式说明逐字：JPEG 的 `[17 : assetIdentifier]` + MOV 的两个 metadata）。

**Web 上如何识别一对文件：**

```text
同名（basename 去扩展名，大小写不敏感）
  + 静图 MakerNote tag 17
  + MOV com.apple.quicktime.content.identifier
  + 两者字符串相等 → 高置信配对
```

只有同名、没有 ID → 中置信，配对但标记 `pairingConfidence: "filename"`，后台可人工修正；ID 冲突 → 不配对，提示"这两个文件不是同一张 Live Photo"。

```ts
async function groupLivePhotoCandidates(files: File[]) {
  const byBase = new Map<string, { still?: File; motion?: File }>();
  for (const file of files) {
    const base = file.name.replace(/\.[^.]+$/, "").toLowerCase();
    const slot = byBase.get(base) ?? {};
    if (/\.(heic|heif|jpe?g)$/i.test(file.name)) slot.still = file;
    else if (/\.mov$/i.test(file.name)) slot.motion = file;
    byBase.set(base, slot);
  }
  // 下一步：读 still 的 MakerNote 0x0011 与 MOV 的 content identifier，
  // 两者相等才标记 pairingConfidence: "identifier"。
  return [...byBase.entries()].map(([base, slot]) => ({ base, ...slot }));
}
```

### 4.2 现成实现与包（真实包名 / 浏览器可用性）

| 包 | 版本 / 许可 | 浏览器 | 能做什么 | 不能做什么 | 成熟度 |
|---|---|---|---|---|---|
| [livephotoskit](https://www.npmjs.com/package/livephotoskit) | 1.5.6 / `SEE LICENSE IN LICENSE.md`（Apple，非 OSI） | ✅ | Apple 官方播放器：`photoSrc + videoSrc`，长按/悬停播放 | 不做配对、不解析 MOV 元数据；**许可不适合直接嵌入开源/闭源产品，需法务** | 官方但 2019 年后未发版 |
| [live-photo](https://www.npmjs.com/package/live-photo) | 0.2.0 / MIT | ✅ 零依赖 | 纯 viewer：`photoSrc + videoSrc`，hover/长按、lazy load、a11y | 不做配对、不解析元数据 | **21 次/周下载**，很新，不可当基础设施 |
| [motion-photo](https://www.npmjs.com/package/motion-photo) | 0.2.2 / MIT | ✅ | 解析 **Android Motion Photo**（XMP + 尾部 MP4），也接受 `{imgSrc, videoSrc}` 的预拆分 iPhone 对；React/Vue/vanilla | 不接受 HEIC+MOV 自动配对；不解析 content identifier | **10 次/周下载**，2026 新库 |
| [livephoto-check](https://www.npmjs.com/package/livephoto-check) | 0.4.2 / MIT | ✅ | 检查 Live Photo 是否能作为 iOS 锁屏壁纸（解析 HEIC/MOV 元数据） | 不是播放器；偏工具 | 小众 |
| [exifr](https://www.npmjs.com/package/exifr) | 7.1.3 / MIT | ✅ | HEIC/JPEG EXIF、XMP、ICC、MakerNote（需开选项） | 是否暴露 Apple 0x0011 `未验证`；不解析 MOV | 稳定但 2021 后无新版 |
| [mp4box](https://www.npmjs.com/package/mp4box) | 2.5.0 / BSD-3 | ✅ | 解析 MOV/MP4 box（`moov/meta/keys/ilst`） | 需自己写 30–60 行读 `keys`/`ilst` | 活跃 |
| [music-metadata](https://www.npmjs.com/package/music-metadata) | 12.7.0 / MIT | ✅ `parseBlob` | 读 MP4/MOV 标签、时长、封面 | 是否直接给出 content identifier `未验证` | 活跃 |

**关于 `apple-live-photo`：** npm 上并不存在 `apple-live-photo`、`apple-live-photos` 或 `apple-livephoto`（registry 均返回 404），没有可直接安装的 Apple 官方"配对库"。Apple 官方可用的只有：`livephotoskit@1.5.6`（播放器，非配对，许可见 LICENSE.md）与原生 `PHLivePhoto` API。ExifTool 可直接提取配对 id：

```bash
exiftool -a -G1 -s -ContentIdentifier IMG_1234.HEIC IMG_1234.MOV
```

两条 `ContentIdentifier` 相等即为同一张 Live Photo；`com.apple.quicktime.still-image-time` 属于 timed metadata，读取时通常需要 `-ee`（具体输出以样本为准，`未验证`）。

**结论：没有一个包能"输入 HEIC+MOV 自动配对并播放"。** 最省事的组合是：

- 自己写 60 行配对器（HEIC 用 `exifr` 或自写 MakerNote IFD；MOV 用 `mp4box` 或字节扫描）；
- 播放用 30 行原生 `<video>` 组件（或 vendor `live-photo` 的交互逻辑，但它只有 21 次/周下载，不建议直接依赖）；
- Apple `livephotoskit` 只作为"体验参考"，不进入产品依赖。

### 4.3 展示方案

```tsx
"use client";
import { useEffect, useRef, useState } from "react";

export function LivePhoto({
  stillUrl, motionUrl, alt, reducedMotion,
}: { stillUrl: string; motionUrl: string; alt: string; reducedMotion: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const play = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();          // 必须在用户手势的调用栈里
      setPlaying(true);
    } catch {
      setPlaying(false);           // iOS 低电量模式/自动播放策略会 reject
    }
  };
  const stop = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    setPlaying(false);
  };
  const startLongPress = () => {
    if (reducedMotion) return;
    timerRef.current = window.setTimeout(play, 250);
  };
  const cancelLongPress = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => cancelLongPress(), []);

  return (
    <button
      type="button"
      className="relative block overflow-hidden rounded-lg"
      aria-label={`${alt}（实况照片，长按播放）`}
      onPointerDown={startLongPress}
      onPointerUp={() => { cancelLongPress(); stop(); }}
      onPointerLeave={() => { cancelLongPress(); stop(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); } }}
      onKeyUp={stop}
    >
      <img src={stillUrl} alt={alt} className="h-full w-full object-cover" />
      <video
        ref={videoRef}
        src={motionUrl}
        muted
        playsInline
        preload="none"
        poster={stillUrl}
        className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
          playing ? "opacity-100" : "opacity-0"
        }`}
      />
      <span className="absolute left-2 top-2 rounded bg-black/50 px-1.5 text-[10px] text-white">LIVE</span>
    </button>
  );
}
```

要点：

- `muted` + `playsInline` 是 iOS 内联播放的前提；`preload="none"` 避免列表页一次性拉所有 MOV。
- 长按 250ms 启动；`pointermove` 超过 10px 取消，避免滚动时误触。
- Safari 的 `play()` 必须由用户手势触发；`await play()` 要 catch，低电量模式会 reject。
- 列表页用 `IntersectionObserver` 在进入视口 200px 时才设置 `video.src`（或 `preload="metadata"`）。
- `prefers-reduced-motion: reduce` 时禁用长按自动播放，只显示"播放"按钮。
- 视频需要支持 Range 请求（S3 原生支持；CDN 必须转发 `Range`，否则拖动进度会失败）。

### 4.4 存储组织：与现有 `Media` 模型兼容

现有 `Media`（[`packages/db/prisma/schema.prisma:608`](roamlog/packages/db/prisma/schema.prisma)）已有：`id / workspaceId / tripId / uploaderId / bucket / key / mimeType / size / width / height / blurhash / variants Json / status / error / caption / date / location / deletedAt`。

**推荐：一条 `Media` + 一条 `MediaMotion`（1:1），不要两条 Media。**

理由：

- 现有封面、相册、权限、删除、审计都围绕 `Media`；拆成两条会让 `entryMedia`、`coveredTrips`、`expenseReceipts` 的语义翻倍。
- motion 是附属资产，生命周期必须跟随 still；`onDelete: Cascade` 最干净。
- Android Motion Photo 也是"一张 JPEG + 一段 MP4"，同一张表可复用。

```prisma
model MediaMotion {
  mediaId      String      @id @db.Uuid
  workspaceId  String      @db.Uuid
  bucket       String
  key          String
  mimeType     String      @default("video/quicktime")
  size         Int
  durationMs   Int?
  stillTimeMs  Int?        // com.apple.quicktime.still-image-time
  width        Int?
  height       Int?
  status       MediaStatus @default(pending)
  error        String?
  createdAt    DateTime    @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime    @updatedAt @db.Timestamptz(3)
  media        Media       @relation(fields: [mediaId], references: [id], onDelete: Cascade)

  @@index([workspaceId, status])
}
```

`Media` 加一行关系与可选 `kind`：

```prisma
model Media {
  // ...existing fields
  kind    MediaKind @default(image)  // image | live_photo | motion_photo
  motion  MediaMotion?
}

enum MediaKind { image  live_photo  motion_photo }
```

**上传链路（建议，不破坏现有 presign）：**

1. `POST /v1/workspaces/:id/media/presign` 仍只创建 still 的 `Media`（`status=pending`）。
2. 客户端配对成功后，调 `POST /v1/media/:mediaId/motion/presign`，body `{ fileName, mimeType: "video/quicktime", size, durationMs?, stillTimeMs? }`；服务端建 `MediaMotion(status=pending)` 并返回第二个 presigned PUT。
3. `POST /v1/media/:mediaId/complete` 扩展 `motion: { size, etag? }`；服务端 `HeadObject` 校验 motion 大小/类型，事务内把两条都置 `processing`，入队 `media.process`。
4. Worker 处理：still → 现有 variants/thumb/blurhash；motion → `ffprobe`/`exiftool` 校验容器与 content identifier，必要时转码为 H.264 MP4（iOS 的 HEVC MOV 在 Chrome/Android 上可能不能播！）。
5. 删除：现有 `media.cleanup` 读取 `variants` 的 key；扩展为同时删除 `motion.key`，并保留 `data.keys` 兼容旧任务。

**关键兼容点：**

- `variants` 是 `Json`，无须改；把 client 压缩信息写进 `variants.client`，motion 单独表。
- `MediaPresignResponseSchema` 是 `.strict()`，新增字段必须同步 `packages/contracts` + Orval 生成，否则前端拿不到。
- 现有 `MediaSchema` 的 `mimeType` 只校验字符串；motion 的 `video/quicktime` 不要塞进 `Media.mimeType`，放 `MediaMotion.mimeType`。

### 4.5 Android Motion Photo 是否顺手支持？

**可以，成本约 1–2 天，复用同一 motion 表与播放器。**

- 格式：一张 JPEG，文件尾部追加 MP4；XMP 里：
  - 新格式：`Camera:MotionPhoto="1"`、`Camera:MotionPhotoVersion="1"`、`Camera:MotionPhotoPresentationTimestampUs="..."`；
  - Google Camera 旧格式：`GCamera:MicroVideo="1"`、`GCamera:MicroVideoOffset="<bytes>"`（偏移是"文件末尾往前数"的字节数）。
- 识别：解析 JPEG 的 APP1 XMP；取 `MotionPhoto=1`；有 `MicroVideoOffset` 用 `fileSize - offset` 得 MP4 起点；无 offset 但有 `MotionPhoto` 则从 EOI 后找 `ftyp`。
- 提取：客户端 `File.slice(videoStart)` 得 MP4 Blob；或服务端 Worker 解析后 `PutObject` 到 motion key。
- 展示：与 Live Photo 完全一样（静图 + `<video>`）；`stillTimeMs` 取 `MotionPhotoPresentationTimestampUs / 1000`。
- 风险：不同厂商 XMP 字段不一致；三星/小米/OPPO 有各自变体；必须以真实样本回归。`motion-photo@0.2.2` 已实现 XMP + 尾部提取，可读其源码（MIT）但不要直接依赖（10 次/周下载）。

### 4.6 iOS 上传的现实约束（必须真机验证）

- iOS Safari 的 `<input type="file" accept="image/*" multiple>` 在"照片"里选择 Live Photo 时，**很可能只把静图（且可能转成 JPEG）交给网页，不附带 MOV**；这是 Web 平台没有 Live Photo API 导致的，不是代码 bug。
- 可行路径：
  1. 让用户从"文件"App 选择已导出的 `.HEIC + .MOV` 对（或 `.livp` 压缩包，客户端解 zip）；
  2. 桌面端 iCloud 导出后上传；
  3. 原生 App / Share Extension（长期）。
- 产品上应把"Live Photo 上传"做成**渐进增强**：检测到配对就显示 LIVE 标记；检测不到就按普通图片上传，不阻塞。
- `未验证`：iOS 17/18/26 各版本 Safari 的文件选择器行为；需要至少 3 台真机（iPhone 12/15/17）覆盖。

---

## 5. D 节：存储桶后台配置

### 5.1 现状（已核对）

- [`StorageSettings`](roamlog/apps/api/src/config/storage-settings.ts) 已有：`endpoint`、`publicEndpoint`、`publicBaseUrl`、`bucket`、`accessKey`、`secretKey`、`region`、`forcePathStyle`、`signedUrlTtlSeconds`、`mediaSignedUrlTtlSeconds`。
- [`StorageService`](roamlog/apps/api/src/modules/storage/storage.service.ts) 已经做了**双客户端**：内部 `client` 用于 Head/Delete/Health，`signingClient` 用 `publicEndpoint` 签 presigned URL；注释明确 "Nginx 必须保留 Host 头，否则签名失效"。
- `checkHealth()` 只做 `HeadBucket`；`createPresignedUpload`/`createSignedReadUrl` 已限制 TTL ≤ 7 天。
- 配置来源仍是 env（`AppConfigService.storageSettings`），后台不可改。

### 5.2 两种方案对比

| 维度 | 方案 A：DB + 运行时重建客户端（推荐） | 方案 B：DB + 改后重启 |
|---|---|---|
| 生效 | 保存即生效（版本号 + 缓存失效） | 保存后写 `restartRequired=true`，等滚动重启 |
| 多实例 | Redis pub/sub 一致 | 各实例重启时间不同，窗口内不一致 |
| 回滚 | 保留旧版本客户端 60s，可秒回 | 回滚也要重启 |
| 实现成本 | 中：`StorageClientFactory` + 版本 + pub/sub | 低：写库 + 重启脚本 |
| 故障半径 | 配置错误会影响新请求；旧请求用旧客户端 | 配置错误会让所有实例起不来 |
| 适用 | 单 Nest + Worker、有 Redis | 纯静态 env、无 Redis、运维强约束 |

**推荐 A 的混合版：**

> 若团队只有单实例、没有 Redis、且能接受"保存后手动重启"，B 的代码量最小；Roamlog 已有 Redis 与多进程（API + Worker），A 的边际成本很低，因此选 A。

- 所有存储字段存 `SystemSetting`（`storage.*`），secret 加密；`env` 中只保留 `SETTINGS_ENCRYPTION_KEYS` 与 `DATABASE_URL/REDIS_URL`。
- `StorageSettingsService.resolve()`：`env override > DB > default`；缓存 30s；`envLocked` 字段标记被 env 锁定的键（例如迁移期 `S3_BUCKET` 仍存在时，后台只读并提示）。
- `StorageClientFactory` 以 `version` 为 key 缓存 `{client, signingClient}`；`version` 每次保存 +1；收到 `settings:storage:updated` 清缓存；旧 client 延迟 60s `destroy()`，让在途请求完成。
- 单实例部署也建议走 pub/sub；没有 Redis 时退化为 30s TTL，仍比重启好。

```ts
@Injectable()
export class StorageClientFactory {
  private cache = new Map<number, { client: S3Client; signing: S3Client; timer?: NodeJS.Timeout }>();

  constructor(private readonly settings: StorageSettingsService) {}

  async get() {
    const cfg = await this.settings.getStorageConfig(); // { ...StorageSettings, version: number }
    const hit = this.cache.get(cfg.version);
    if (hit) return hit;

    const client = createS3Client(cfg);
    const signing = createS3Client(cfg, cfg.publicEndpoint ?? cfg.endpoint);
    const entry = { client, signing };
    this.cache.set(cfg.version, entry);
    // 只保留最近 2 个版本；旧版本 60s 后销毁
    for (const [version, old] of this.cache) {
      if (version < cfg.version - 1 && !old.timer) {
        old.timer = setTimeout(() => { old.client.destroy(); old.signing.destroy(); this.cache.delete(version); }, 60_000);
      }
    }
    return entry;
  }
}
```

### 5.3 如何验证配置可用

后台"测试连接"分 6 步，任何一步失败都返回**可操作的错误码 + 建议**，不要只抛 SDK 原始错误：

| 步骤 | 调用 | 验证什么 | 失败提示（示例） |
|---|---|---|---|
| 1 | `HeadBucket` | endpoint/DNS/TLS/凭证/桶存在 | `STORAGE_ENDPOINT_UNREACHABLE`：检查 endpoint、VPC/DNS、证书 |
| 2 | `PutObject` 探针 `_roamlog/healthcheck/<uuid>.txt`（`Content-Type: text/plain`，body `roamlog-probe`） | 写权限、bucket policy、region | `STORAGE_WRITE_DENIED`：检查 Access Key 的 PutObject 权限 |
| 3 | `HeadObject` / `GetObject` 对比字节与 ETag | 读权限、一致性 | `STORAGE_READ_MISMATCH`：检查 CDN/代理是否改写 body |
| 4 | `GetSignedUrl(GetObject, 60s)`，把 URL 返回给**浏览器**执行 `fetch` | 公网可达 + CORS | `STORAGE_SIGNED_READ_FAILED`：检查 publicEndpoint、CORS、Host |
| 5 | `GetSignedUrl(PutObject, 60s)`，浏览器 `PUT` 一个小文件 | 上传签名 + CORS 预检 | `STORAGE_CORS_PUT_FAILED`：检查 AllowedMethods/AllowedHeaders/ExposeHeaders |
| 6 | 删除探针 + 可选 `publicBaseUrl` HEAD | 清理、公开域名 | `STORAGE_PUBLIC_URL_FAILED`：检查 CDN/自定义域 |

关键：**第 4/5 步必须由浏览器执行**，服务端 `fetch` 只能验证服务端网络，验证不了 CORS 与公网 DNS。后台把测试结果按步骤展示，允许"部分通过"。

**错误映射：**

- `ENOTFOUND` / `ECONNREFUSED` / TLS → endpoint、DNS、证书、容器网络。
- `403 SignatureDoesNotMatch` → secret 错、region 错、系统时钟偏差 >15 分钟。
- `404 NoSuchBucket` → 桶名错、region 错。
- `301 PermanentRedirect` / `PermanentRedirect` → endpoint 与 region 不匹配。
- `AccessDenied` on PutObject → 凭证权限/桶策略。
- CORS 预检失败 → 桶 CORS 缺 `PUT`、`Content-Type`、`ExposeHeaders: ETag`。
- `XAmzContentSHA256Mismatch` / `InvalidRequest` → 代理改 body 或 SDK 校验和不兼容（见下）。
- 超时 → 代理/防火墙、endpoint 不是 S3 API 端口。

### 5.4 R2 / Backblaze / Wasabi 注意点

| 服务 | endpoint / region | path-style | 公网 URL | 主要坑 |
|---|---|---|---|---|
| Cloudflare R2 | `https://<account_id>.r2.cloudflarestorage.com`；`region: "auto"` | 不需要（virtual-hosted 可用） | 自定义域，或 `r2.dev`（限速，不建议生产） | AWS SDK v3 默认校验和可能不被支持 → `requestChecksumCalculation: "WHEN_REQUIRED"`、`responseChecksumValidation: "WHEN_REQUIRED"`；不支持 ACL，别传 `ACL`；CORS 需在 R2 控制台配置 |
| Backblaze B2 | `https://s3.<region>.backblazeb2.com`；region 如 `us-west-004` | 视桶/区域，失败时试 `forcePathStyle: true` | `https://f<cluster>.backblazeb2.com/file/<bucket>/<key>` | 桶名全局唯一；Application Key 权限；CORS 在桶设置；region 必须与 endpoint 一致 |
| Wasabi | `https://s3.<region>.wasabisys.com`；region 如 `us-east-1` | 通常 virtual-hosted | 桶策略公开或 CDN | region 与 endpoint 必须匹配；部分区域签名/时钟敏感；CORS 在桶策略 |
| MinIO | `http://minio:9000` 内部；`https://media.example.com` 公网 | **必须 `forcePathStyle: true`** | Nginx/CDN 反代，保留 Host | presign 必须用公网 endpoint 签；反代改写 Host 会 403；`MINIO_SERVER_URL` 要与公网一致 |

**AWS SDK v3 校验和问题（2025-01 起）：**

- v3.729.0 起默认对 `PutObject` 计算 CRC32 并在请求头带 `x-amz-checksum-crc32`；部分 S3 兼容端（R2/MinIO 旧版本/代理）会拒绝或返回校验和不匹配。
- 解决：客户端配置

```ts
new S3Client({
  endpoint,
  region,
  forcePathStyle,
  credentials,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
```

- 链接：[AWS SDK v3 S3 checksums 文档](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html)；当前仓库 `@aws-sdk/client-s3` 为 **3.1170.0**，已包含该行为。

**公网 endpoint 与签名：**

- SigV4 签的是 `Host` 头；如果把内部 endpoint 签出的 URL 改写成 CDN 域名，必然 403。
- 现有 `StorageService` 的双客户端设计是正确的：`signingClient` 用 `publicEndpoint`；如果 CDN 只做反代且保留 Host，则 `publicEndpoint` 应与内部 endpoint 的 Host 一致。
- `publicBaseUrl` 目前"保留未使用"；如果要走公开 CDN（非签名），需要单独的读路径与缓存策略，private media 继续用 presigned。

---

## 6. 风险与坑

1. **HEIC 服务端解码不确定。** `sharp@0.35.5` 预编译二进制对 HEIC 的支持取决于 libvips 的 libheif/HEVC 编译选项，且涉及专利；`未验证`。不要把"上传 HEIC 原图 → 服务端出图"作为唯一路径；客户端先转 WebP，或只存原图并标记无缩略图。
2. **LGPL 的 `heic-to`。** 它是目前最好用的浏览器 HEIC 解码器，但 LGPL-3.0 对 SaaS 捆绑 WASM 的合规性需要法务判断；优先评估 `@discourse/heic`（Apache-2.0）或 `heic2any`（MIT，但 2023 后未更新）。
3. **iOS Safari 不保证把 Live Photo 的 MOV 交给网页。** 这是产品可行性风险，必须真机验证；不要把"支持 Live Photo"写成无条件承诺，要做渐进增强与"从文件 App 选择"的兜底。
4. **EXIF/GPS 隐私。** 原图含 GPS、设备序列号、OwnerName、MakerNote；派生图必须剥，原图是否保留要用户显式选择；后台预览也不应展示 GPS，除非有权限。
5. **重复压缩。** 客户端压一次、服务端再压一次会明显掉画质；用 `variants.client` + `sourceHash` 标记跳过，服务端只生成 thumb/blurhash。
6. **大文件与内存。** 25MB HEIC 解码后可能 100MB+；必须用 `createImageBitmap` 的 `resizeWidth/Height` 在解码阶段降采样，Worker 并发 1，失败降级。
7. **Safari 的 OffscreenCanvas/`convertToBlob` 支持不完整。** 旧版 Safari 可能不支持 Worker 内编码；检测失败走主线程 `canvas.toBlob`，并提示设备较旧。
8. **AVIF 编码慢且包大。** `@jsquash/avif` unpacked 8.36MB，编码 2–5s；不要默认开启，不要阻塞上传；服务端异步转码更合适。
9. **CORS 与 presigned Host。** 上传失败最常见的原因不是密钥，是桶 CORS 缺 `PUT`/`Content-Type`/`ExposeHeaders: ETag`，或反代改写 Host；测试必须由浏览器执行。
10. **S3 兼容端的校验和。** R2/B2/MinIO 对 AWS SDK v3 默认 CRC32 的行为不一致；统一 `WHEN_REQUIRED`，并在"测试连接"里显式验证 PutObject。
11. **敏感配置的读接口。** 一旦 API 返回明文，前端 DevTools、日志、错误上报都会泄露；只返回 `hasValue/last4`，审计只记 hash。
12. **配置缓存不一致。** 30s TTL 在多实例下会出现"刚改完 A 实例生效、B 实例仍旧值"；用 Redis pub/sub + version，后台显示"已应用到 N 个实例"（可选）。
13. **Live Photo 的 MOV 编码。** iPhone 的 MOV 是 HEVC/H.265，Chrome/Android 可能不能播；服务端需转 H.264 MP4（或提供 H.264 代理），否则"能上传不能播"。
14. **Range 请求。** 视频拖动依赖 `Range`；S3 原生支持，CDN/反代必须转发，否则只能从头播。

---

## 7. 未验证项（交付前必须补测）

1. `sharp@0.35.5` 预编译二进制能否解码 iPhone HEIC（macOS/Linux 两套二进制）。
2. `exifr@7.1.3` 是否默认/可选暴露 Apple MakerNote tag `0x0011`；若不暴露，自写 IFD 解析或服务端 exiftool。
3. `mp4box@2.5.0` / `music-metadata@12.7.0` 是否能直接读出 `com.apple.quicktime.content.identifier`；否则用字节扫描 `keys/ilst` 或服务端 ffprobe。
4. iOS Safari（iOS 17/18/26）文件选择器对 Live Photo 的行为：是否附带 MOV、是否转码 HEIC。
5. Safari 对 `OffscreenCanvas.convertToBlob`、`createImageBitmap({resizeWidth})` 的支持版本。
6. Cloudflare R2 对 AWS SDK v3 默认 CRC32 的具体报错与 `WHEN_REQUIRED` 修复效果。
7. Ghost 当前 `main` 的 `settings` 表 schema 文件路径（本次 raw 取不到，字段按 5.x 公开结构整理）。
8. B2/Wasabi 的 `forcePathStyle` 最佳值（不同桶/区域可能不同，需实测）。
9. `live-photo@0.2.0` / `motion-photo@0.2.2` 在真实 HEIC/MOV 上的行为（下载量极低，不能只看 README）。

---

## 8. 参考资料

**A. 设置实现**

- Immich：[repo](https://github.com/immich-app/immich) · [config.dto.ts](https://github.com/immich-app/immich/blob/main/server/src/dtos/config.dto.ts) · [system-config.service.ts](https://github.com/immich-app/immich/blob/main/server/src/services/system-config.service.ts) · [config.repository.ts](https://github.com/immich-app/immich/blob/main/server/src/repositories/config.repository.ts)
- Hoppscotch：[repo](https://github.com/hoppscotch/hoppscotch) · [infra-config.service.ts](https://github.com/hoppscotch/hoppscotch/blob/main/packages/hoppscotch-backend/src/infra-config/infra-config.service.ts) · [InfraConfig enum](https://github.com/hoppscotch/hoppscotch/blob/main/packages/hoppscotch-backend/src/types/InfraConfig.ts) · [init migration](https://github.com/hoppscotch/hoppscotch/blob/main/packages/hoppscotch-backend/prisma/migrations/20231124104640_infra_config/migration.sql) · [encryption migration](https://github.com/hoppscotch/hoppscotch/blob/main/packages/hoppscotch-backend/prisma/migrations/20240725043411_infra_config_encryption/migration.sql) · [env-sync migration](https://github.com/hoppscotch/hoppscotch/blob/main/packages/hoppscotch-backend/prisma/migrations/20241118054346_infra_config_sync_with_env_file/migration.sql)
- ToolJet：[repo](https://github.com/ToolJet/ToolJet) · [instance_settings.entity.ts](https://github.com/ToolJet/ToolJet/blob/develop/server/src/entities/instance_settings.entity.ts)
- Rocket.Chat：[repo](https://github.com/RocketChat/Rocket.Chat) · [ISetting.ts](https://github.com/RocketChat/Rocket.Chat/blob/develop/packages/core-typings/src/ISetting.ts) · [Settings.ts](https://github.com/RocketChat/Rocket.Chat/blob/develop/packages/models/src/models/Settings.ts)
- Ghost：[repo](https://github.com/TryGhost/Ghost)

**B. 浏览器压缩**

- [browser-image-compression](https://www.npmjs.com/package/browser-image-compression)（2.0.2） · [compressorjs](https://www.npmjs.com/package/compressorjs)（1.4.0） · [pica](https://www.npmjs.com/package/pica)（10.0.3）
- [@jsquash/webp](https://www.npmjs.com/package/@jsquash/webp)（1.5.0） · [@jsquash/avif](https://www.npmjs.com/package/@jsquash/avif)（2.1.1） · [@jsquash/resize](https://www.npmjs.com/package/@jsquash/resize)（2.1.1）
- [heic-to](https://www.npmjs.com/package/heic-to)（1.6.7，LGPL-3.0） · [heic2any](https://www.npmjs.com/package/heic2any)（0.0.4，MIT） · [@discourse/heic](https://www.npmjs.com/package/@discourse/heic)（1.0.0，Apache-2.0）
- MDN：[createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/createImageBitmap) · [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) · [convertToBlob](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob)
- sharp：[repo](https://github.com/lovell/sharp) · [API](https://sharp.pixelplumbing.com/)

**C. Live Photo / Motion Photo**

- Apple：[quickTimeMetadataContentIdentifier](https://developer.apple.com/documentation/avfoundation/avmetadataidentifier/quicktimemetadatacontentidentifier) · [quickTimeMetadataStillImageTime](https://developer.apple.com/documentation/avfoundation/avmetadataidentifier/quicktimemetadatastillimagetime)
- ExifTool：[Apple Tags（0x0011 ContentIdentifier）](https://exiftool.org/TagNames/Apple.html)
- 格式说明：[LimitPoint/LivePhoto](https://github.com/LimitPoint/LivePhoto)（JPEG `[17: assetIdentifier]` + MOV 两个 metadata）
- 包：[livephotoskit](https://www.npmjs.com/package/livephotoskit) · [live-photo](https://www.npmjs.com/package/live-photo) · [motion-photo](https://www.npmjs.com/package/motion-photo) · [livephoto-check](https://www.npmjs.com/package/livephoto-check) · [exifr](https://www.npmjs.com/package/exifr) · [mp4box](https://www.npmjs.com/package/mp4box) · [music-metadata](https://www.npmjs.com/package/music-metadata)

**D. 存储**

- AWS SDK v3：[S3 checksums](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html) · [`@aws-sdk/client-s3`](https://www.npmjs.com/package/@aws-sdk/client-s3)（3.1172.0）
- Cloudflare R2：[S3 API](https://developers.cloudflare.com/r2/api/s3/api/) · [Presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) · [CORS](https://developers.cloudflare.com/r2/buckets/cors/) · [Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- Backblaze B2：[S3-compatible API](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api)
- MinIO：[docs](https://min.io/docs/minio/linux/index.html)

---

## 9. 附录：方法与 CodeGraph 证据

### 9.1 仓库事实核对

- `codegraph_explore`（projectPath `C:\Users\BY9700\Desktop\UI\roamlog`）查询 `Media model prisma image variants sharp worker blurhash admin settings config` → 命中：
  - `apps/worker/src/jobs/media.ts`：`processMedia`、`mediaVariantKey`、`detectImageMime`（magic bytes 已覆盖 `ftyp`/`heic`）；
  - `apps/worker/src/jobs/types.ts`：`ImageProcessor`、`ProcessedVariant`、`ImageProcessingResult`；
  - `apps/worker/src/dependencies.ts:103`：`createImageProcessor()` 生成 `thumb/medium/large` 的 WebP+JPEG + blurhash；
  - `apps/api/src/modules/admin/admin-media.service.ts`：`list/remove`、`admin:media:read|delete`。
- 查询 `processMedia mediaVariantKey createImageProcessor sharp admin navigation layout config module environment schema Media prisma` → 命中 `apps/api/src/config/environment.ts:438 Environment`、`apps/api/src/config/app-config.service.ts`、`apps/api/src/modules/admin/admin.module.ts`。
- `ops_grep` 命中 `packages/db/prisma/schema.prisma:608 model Media` 与 `:93 enum MediaStatus`；`Media` 现有字段见 §4.4。
- `ops_grep` 命中 `apps/api/src/config/storage-settings.ts:18 StorageSettings`；`StorageService` 双客户端与 `publicEndpoint` 逻辑见 §5.1。
- 仓库版本：Next **16.4.6**、`@aws-sdk/client-s3` **3.1170.0**、`sharp` **0.35.5**、Prisma **7.10.1**（`package.json`）。
- 现有 Admin 导航在 `apps/admin/components/admin-shell/admin-nav.ts`，目前只有总览/用户/工作区/审计/内容/媒体/邮件/队列/功能开关/系统健康，**没有系统设置**；新增页只需在此数组加一项。

### 9.2 数据获取方式

- stars / last push：`ungh.cc/repos/<owner>/<repo>`，读取字段 `stars`、`pushedAt`（2026-11-19）。
- license：`raw.githubusercontent.com/<owner>/<repo>/<branch>/LICENSE` 原文；Immich=AGPL-3.0、Hoppscotch=MIT、ToolJet=AGPL-3.0、Rocket.Chat=MIT（核心，`ee/` 单独）、Ghost=MIT。
- npm：`registry.npmjs.org/<pkg>/latest` 取 `version/license/unpackedSize`；`api.npmjs.org/downloads/point/last-week/<pkg>` 取周下载。
- 未使用任何本地依赖安装；未修改 `apps/`、`packages/`。

### 9.3 交付边界

- 本文件位于工作区根 `.audit/research-admin-media.md`，并同步一份到 `roamlog/.audit/research-admin-media.md` 供仓库审计引用；两处均不在 `apps/`、`packages/` 内。
- 所有代码片段是建议/骨架，未编译、未运行；落地时需按仓库 lint/typecheck 规则改写。