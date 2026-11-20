import {
  SETTINGS_GROUP_LABELS,
  THEME_MODES,
  type SettingValue,
  type SystemSettingGroup,
  type SystemSettingValueType,
} from "@roamlog/contracts";
import { DEFAULT_SETTINGS, type SettingDefaultValue } from "@roamlog/db";
import { z } from "zod";

/**
 * Single source of truth for every operator-editable setting: group, type,
 * default, validation, visibility, and the labels the admin UI renders.
 *
 * Adding a key means adding it here (and to `DEFAULT_SETTINGS`). The registry is
 * immutable at runtime; `SettingsService` refuses unknown keys, and
 * `DEFAULT_SETTINGS` is checked at module load so a key can never exist without
 * a default.
 */

export interface SettingDefinition {
  readonly key: string;
  readonly group: SystemSettingGroup;
  readonly type: SystemSettingValueType;
  readonly defaultValue: SettingDefaultValue;
  readonly schema: z.ZodType;
  readonly isPublic: boolean;
  readonly isSecret: boolean;
  readonly envLocked: boolean;
  /** Environment variable that wins over the DB value when `envLocked`. */
  readonly envVar?: string;
  readonly label: string;
  readonly help: string;
  readonly options?: readonly string[];
}

/** DI token so tests/modules can swap the registry without touching the API. */
export const SETTINGS_REGISTRY_TOKEN = Symbol("roamlog:settings-registry");

function textSetting(label: string, min: number, max: number) {
  return z
    .string({ error: `${label}必须是文本。` })
    .min(min, `${label}不能少于 ${min} 个字符。`)
    .max(max, `${label}不能超过 ${max} 个字符。`);
}

function maxTextSetting(label: string, max: number) {
  return z
    .string({ error: `${label}必须是文本。` })
    .max(max, `${label}不能超过 ${max} 个字符。`);
}

function numberSetting(label: string, min: number, max: number) {
  return z
    .number({ error: `${label}必须是数字。` })
    .int(`${label}必须是整数。`)
    .min(min, `${label}不能小于 ${min}。`)
    .max(max, `${label}不能大于 ${max}。`);
}

function decimalSetting(label: string, min: number, max: number) {
  return z
    .number({ error: `${label}必须是数字。` })
    .min(min, `${label}不能小于 ${min}。`)
    .max(max, `${label}不能大于 ${max}。`);
}

function booleanSetting(label: string) {
  return z.boolean({ error: `${label}必须是布尔值。` });
}

function enumSetting<T extends readonly [string, ...string[]]>(label: string, values: T) {
  return z.enum(values, {
    error: `${label}必须是以下选项之一：${values.join("、")}。`,
  });
}

const HTTP_URL = z
  .string({ error: "URL 必须是文本。" })
  .min(1, "URL 不能为空。")
  .max(2_048, "URL 不能超过 2048 个字符。")
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "必须是 http(s) URL。" },
  );

const IANA_TIME_ZONE = z
  .string({ error: "时区必须是文本。" })
  .min(1, "时区不能为空。")
  .max(64, "时区不能超过 64 个字符。")
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    },
    { message: "必须是 IANA 时区，例如 Asia/Shanghai。" },
  );

const MAIL_FROM = z
  .string({ error: "发件地址必须是文本。" })
  .min(3, "发件地址不能少于 3 个字符。")
  .max(320, "发件地址不能超过 320 个字符。")
  .refine((value) => value.includes("@") && !/[\r\n]/u.test(value), {
    message: "必须是邮件地址，例如 Roamlog <no-reply@example.com>。",
  });

const SECRET = textSetting("密钥", 1, 4_096);

const THEME_ACCENTS = ["white", "amber", "blue", "emerald", "rose"] as const;
const LANGUAGES = ["zh-CN", "en"] as const;
const MAIL_PROVIDERS = ["resend", "smtp"] as const;
const PLACE_PROVIDERS = ["geoapify", "photon", "tencent", "local", "map_pin"] as const;

function define(entry: Omit<SettingDefinition, "defaultValue">): SettingDefinition {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, entry.key)) {
    throw new Error(`Setting ${entry.key} has no entry in DEFAULT_SETTINGS`);
  }
  const defaultValue = DEFAULT_SETTINGS[entry.key as keyof typeof DEFAULT_SETTINGS];
  if (defaultValue !== null) {
    const parsed = entry.schema.safeParse(defaultValue);
    if (!parsed.success) {
      throw new Error(
        `Default for ${entry.key} does not satisfy its schema: ${parsed.error.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      );
    }
  }
  return { ...entry, defaultValue };
}

export const SETTINGS_REGISTRY: readonly SettingDefinition[] = Object.freeze([
  define({
    key: "site.title",
    group: "general",
    type: "string",
    schema: textSetting("站点标题", 1, 80),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "站点标题",
    help: "显示在浏览器标签页、SEO 标题和站点页头中。",
  }),
  define({
    key: "site.description",
    group: "general",
    type: "string",
    schema: textSetting("站点描述", 1, 300),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "站点描述",
    help: "默认的元描述，也是公开页面展示的简短介绍。",
  }),
  define({
    key: "general.defaultLanguage",
    group: "general",
    type: "string",
    schema: enumSetting("默认语言", LANGUAGES),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "默认语言",
    help: "访客或成员选择语言之前使用的语言。",
    options: LANGUAGES,
  }),
  define({
    key: "general.defaultTimeZone",
    group: "general",
    type: "string",
    schema: IANA_TIME_ZONE,
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "默认时区",
    help: "用于新账户和日期显示的 IANA 时区。",
  }),
  define({
    key: "general.registrationEnabled",
    group: "general",
    type: "boolean",
    schema: booleanSetting("开放注册"),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "开放注册",
    help: "关闭后，新账户将无法自助注册。",
  }),

  // SEO values are public by design: the anonymous web shell has to render the
  // exact `<title>`, description, Open Graph image and robots directive that
  // operators configure here, and crawlers read the same values. None of them
  // is a credential or an internal parameter.
  define({
    key: "seo.titleTemplate",
    group: "seo",
    type: "string",
    schema: textSetting("标题模板", 1, 200),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "标题模板",
    help: "使用 %s 代表页面标题，例如 %s · Roamlog。",
  }),
  define({
    key: "seo.descriptionTemplate",
    group: "seo",
    type: "string",
    schema: textSetting("描述模板", 1, 300),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "描述模板",
    help: "没有独立描述的页面使用的默认描述。",
  }),
  define({
    key: "seo.ogImageUrl",
    group: "seo",
    type: "string",
    schema: HTTP_URL.nullable(),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "社交预览图",
    help: "社交预览图的绝对 URL；留空则不输出。",
  }),
  define({
    key: "seo.robots",
    group: "seo",
    type: "string",
    schema: textSetting("爬虫指令", 1, 100),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "爬虫指令",
    help: "用于 robots meta 标签的值，例如 index,follow。",
  }),
  define({
    key: "seo.sitemapEnabled",
    group: "seo",
    type: "boolean",
    schema: booleanSetting("站点地图"),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "站点地图",
    help: "为公开行程发布 /sitemap.xml。",
  }),

  define({
    key: "theme.accent",
    group: "theme",
    type: "string",
    schema: enumSetting("强调色", THEME_ACCENTS),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "强调色",
    help: "用于按钮、焦点环和图表的强调色。",
    options: THEME_ACCENTS,
  }),
  define({
    key: "theme.defaultMode",
    group: "theme",
    type: "string",
    schema: enumSetting("默认配色模式", THEME_MODES),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "默认配色模式",
    help: "深色或跟随系统；当前没有浅色调色板，跟随系统仍显示深色。",
    options: THEME_MODES,
  }),
  define({
    key: "theme.loginTagline",
    group: "theme",
    type: "string",
    schema: maxTextSetting("登录页标语", 160),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "登录页标语",
    help: "显示在登录标题下方的短句。",
  }),

  define({
    key: "mail.provider",
    group: "mail",
    type: "string",
    schema: enumSetting("邮件服务商", MAIL_PROVIDERS),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "邮件服务商",
    help: "邮件服务商可选 Resend 或 SMTP 中继；下方凭据需与所选服务商匹配。",
    options: MAIL_PROVIDERS,
  }),
  define({
    key: "mail.from",
    group: "mail",
    type: "string",
    schema: MAIL_FROM,
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "发件地址",
    help: "事务邮件中显示的发件人。",
  }),
  define({
    key: "mail.resendApiKey",
    group: "mail",
    type: "secret",
    schema: SECRET,
    isPublic: false,
    isSecret: true,
    envLocked: false,
    label: "邮件 API 密钥（Resend）",
    help: "加密存储，仅显示末四位字符。",
  }),
  define({
    key: "mail.smtpHost",
    group: "mail",
    type: "string",
    schema: textSetting("SMTP 主机", 1, 255),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "SMTP 主机",
    help: "邮件服务商为 SMTP 时使用的中继主机名。",
  }),
  define({
    key: "mail.smtpPort",
    group: "mail",
    type: "number",
    schema: numberSetting("SMTP 端口", 1, 65_535),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "SMTP 端口",
    help: "通常使用 STARTTLS 的 587，或隐式 TLS 的 465。",
  }),
  define({
    key: "mail.smtpUser",
    group: "mail",
    type: "string",
    schema: maxTextSetting("SMTP 用户名", 255),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "SMTP 用户名",
    help: "用于 SMTP 中继的用户名；无认证中继可留空。",
  }),
  define({
    key: "mail.smtpPassword",
    group: "mail",
    type: "secret",
    schema: SECRET,
    isPublic: false,
    isSecret: true,
    envLocked: false,
    label: "SMTP 密码",
    help: "加密存储，设置 API 永不返回。",
  }),

  define({
    key: "storage.endpoint",
    group: "storage",
    type: "string",
    schema: HTTP_URL,
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "存储端点",
    help: "服务端签名使用的 S3 兼容 API 端点。",
  }),
  define({
    key: "storage.publicEndpoint",
    group: "storage",
    type: "string",
    schema: HTTP_URL.nullable(),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "公开访问端点",
    help: "预签名 URL 的浏览器访问源；留空则复用存储端点。",
  }),
  define({
    key: "storage.bucket",
    group: "storage",
    type: "string",
    schema: textSetting("存储桶", 1, 255),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "存储桶",
    help: "保存媒体与导出文件的存储桶。",
  }),
  define({
    key: "storage.region",
    group: "storage",
    type: "string",
    schema: textSetting("区域", 1, 64),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "区域",
    help: "签名区域，例如 us-east-1。",
  }),
  define({
    key: "storage.accessKey",
    group: "storage",
    type: "secret",
    schema: SECRET,
    isPublic: false,
    isSecret: true,
    envLocked: false,
    label: "访问密钥",
    help: "加密存储，仅显示末四位字符。",
  }),
  define({
    key: "storage.secretKey",
    group: "storage",
    type: "secret",
    schema: SECRET,
    isPublic: false,
    isSecret: true,
    envLocked: false,
    label: "私密密钥",
    help: "加密存储，设置 API 永不返回。",
  }),
  define({
    key: "storage.forcePathStyle",
    group: "storage",
    type: "boolean",
    schema: booleanSetting("强制路径样式"),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "强制路径样式",
    help: "使用 MinIO 及部分 B2/Wasabi 部署时需要开启。",
  }),

  // `media` is a mixed group: only the four values the browser compressor
  // genuinely reads are public. `keepOriginal` and `livePhotoEnabled` stay
  // private because neither behavior is wired yet — publishing them would let
  // the admin UI imply a switch works when it does not.
  define({
    key: "media.maxEdge",
    group: "media",
    type: "number",
    schema: numberSetting("最长边（像素）", 500, 8_000),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "最长边（像素）",
    help: "浏览器压缩图片时保留的最长边；Web 客户端从公开投影读取，并限制在 500–4000。",
  }),
  define({
    key: "media.quality",
    group: "media",
    type: "number",
    schema: decimalSetting("WebP 质量", 0.4, 0.95),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "WebP 质量",
    help: "0.4 到 0.95 之间的压缩质量；浏览器以此值作为质量梯度起点。",
  }),
  define({
    key: "media.targetBytes",
    group: "media",
    type: "number",
    schema: numberSetting("目标字节数", 100_000, 10_000_000),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "目标字节数",
    help: "客户端压缩器上传前追求的大小；Web 客户端限制在 100 KB–5 MB。",
  }),
  define({
    key: "media.keepOriginal",
    group: "media",
    type: "boolean",
    schema: booleanSetting("保留原图"),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "保留原图",
    help: "与压缩副本一同上传未经处理的原始文件。当前未接入：改动不影响上传行为。",
  }),
  define({
    key: "media.livePhotoEnabled",
    group: "media",
    type: "boolean",
    schema: booleanSetting("实况照片"),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "实况照片",
    help: "接受 iOS 拍摄的静态图与动态图配对上传。当前未接入：改动不影响上传行为。",
  }),
  define({
    key: "media.maxUploadBytes",
    group: "media",
    type: "number",
    // The server hard-caps presigned uploads at 25 MiB (26,214,400 bytes). The
    // setting stops at the decimal 25 MB mark so an operator can never save a
    // value the presign endpoint would refuse; do not raise this without
    // changing the media module's cap at the same time.
    schema: numberSetting("最大上传字节数", 1_000_000, 25_000_000),
    isPublic: true,
    isSecret: false,
    envLocked: false,
    label: "最大上传字节数",
    help: "预签名端点接受的最大单文件体积。上限 25 MB，由服务端强制；客户端会先拦一次。",
  }),

  define({
    key: "ai.defaultProvider",
    group: "ai",
    type: "string",
    schema: textSetting("默认 AI 服务商", 1, 80),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "默认 AI 服务商",
    help: "工作区未单独指定时使用的服务商标识。",
  }),
  define({
    key: "ai.timeoutMs",
    group: "ai",
    type: "number",
    schema: numberSetting("请求超时（毫秒）", 1_000, 120_000),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "请求超时（毫秒）",
    help: "用于 AI 规划调用的单次请求超时。",
  }),
  define({
    key: "ai.maxOutputTokens",
    group: "ai",
    type: "number",
    schema: numberSetting("最大输出 Token 数", 256, 65_536),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "最大输出 Token 数",
    help: "传给服务商的输出 Token 上限。",
  }),
  define({
    key: "ai.dailyQuota",
    group: "ai",
    type: "number",
    schema: numberSetting("每日配额", 0, 1_000_000),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "每日配额",
    help: "平台每天允许的 AI 调用次数；设为零时停用规划。",
  }),
  define({
    key: "ai.baseUrl",
    group: "ai",
    type: "string",
    schema: textSetting("AI 基础 URL", 1, 200).nullish(),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "AI 基础 URL",
    help: "兼容 OpenAI 的端点，例如 https://api.openai.com/v1。",
  }),
  define({
    key: "ai.model",
    group: "ai",
    type: "string",
    schema: textSetting("AI 模型", 1, 80).nullish(),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "AI 模型",
    help: "基础 URL 提供的模型标识。",
  }),
  define({
    key: "ai.apiKey",
    group: "ai",
    type: "secret",
    schema: SECRET,
    isPublic: false,
    isSecret: true,
    envLocked: false,
    label: "AI API 密钥",
    help: "加密存储，仅显示末四位字符。",
  }),
  define({
    key: "ai.vision",
    group: "ai",
    type: "boolean",
    schema: booleanSetting("支持图片输入"),
    isPublic: false,
    isSecret: false,
    // Not env-locked (the registry keeps that field for future use): a stored
    // value wins, `AI_VISION_SUPPORTED` is the fallback, and the code default is
    // `false`. See `ai.settings.ts` `DEFAULT_AI_VISION`.
    envLocked: false,
    envVar: "AI_VISION_SUPPORTED",
    label: "支持图片输入",
    help:
      "开启后，聊天附件会作为图片内容发送给模型。网关 /v1/models 的 modalities 字段不可信" +
      "（实测声明支持 image 的模型会跳过视觉分析），所以默认关闭；开启前请自行验证该模型确实能读图。",
  }),

  define({
    key: "places.provider",
    group: "places",
    type: "string",
    schema: enumSetting("地点服务商", PLACE_PROVIDERS),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "地点服务商",
    help: "优先使用 Geoapify，无密钥时回退到 Photon。",
    options: PLACE_PROVIDERS,
  }),
  define({
    key: "places.apiKey",
    group: "places",
    type: "secret",
    schema: SECRET,
    isPublic: false,
    isSecret: true,
    envLocked: false,
    label: "地点 API 密钥",
    help: "加密存储，仅显示末四位字符。",
  }),
  define({
    key: "places.lang",
    group: "places",
    type: "string",
    schema: textSetting("搜索语言", 2, 16),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "搜索语言",
    help: "传给支持该参数的服务商的语言代码。",
  }),
  define({
    key: "places.limit",
    group: "places",
    type: "number",
    schema: numberSetting("结果数量上限", 1, 10),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "结果数量上限",
    help: "每次搜索返回的最大建议数量。",
  }),
  define({
    key: "places.cacheTtlSeconds",
    group: "places",
    type: "number",
    schema: numberSetting("缓存有效期（秒）", 60, 86_400),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "缓存有效期（秒）",
    help: "规范化地点结果的缓存时长。",
  }),
  define({
    key: "places.dailyQuota",
    group: "places",
    type: "number",
    schema: numberSetting("每日配额", 0, 1_000_000),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "每日配额",
    help: "每天的服务商调用上限，超出后降级到回退方案。",
  }),

  define({
    key: "limits.searchPerMinute",
    group: "limits",
    type: "number",
    schema: numberSetting("每分钟搜索请求数", 1, 600),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "每分钟搜索请求数",
    help: "每账户的搜索速率限制。",
  }),
  define({
    key: "limits.uploadPerMinute",
    group: "limits",
    type: "number",
    schema: numberSetting("每分钟上传请求数", 1, 600),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "每分钟上传请求数",
    help: "每账户的预签名速率限制。",
  }),
  define({
    key: "limits.uploadMaxFilesPerBatch",
    group: "limits",
    type: "number",
    schema: numberSetting("单批最多张数", 1, 100),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "单次批量上传最多张数",
    help: "一次批量上传最多可包含多少张照片（1–100 张，默认 20 张）。超出部分服务端在写入前整批拒绝，返回 422 MEDIA_BATCH_TOO_MANY_FILES；同时作用于前端可见的文案与上传队列。",
  }),
  define({
    key: "limits.uploadMaxFileBytes",
    group: "limits",
    type: "number",
    schema: numberSetting("单个文件大小上限", 1, 104_857_600),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "单个文件大小上限（字节）",
    help: "单张照片的大小上限，单位为字节（1–104857600 字节，默认 26214400 即 25 MiB）。超出的预签名与完成回调都返回 422 MEDIA_FILE_TOO_LARGE，前端应通过 GET /media/limits 读取此值生成文案，不要硬编码。",
  }),
  define({
    key: "limits.uploadMaxBatchBytes",
    group: "limits",
    type: "number",
    schema: numberSetting("单批合计大小上限", 1, 1_073_741_824),
    isPublic: false,
    isSecret: false,
    envLocked: false,
    label: "单批合计大小上限（字节）",
    help: "一次批量上传所有文件合计的大小上限，单位为字节（1–1073741824 字节，默认 157286400 即 150 MiB）。合计超出时整批返回 422 MEDIA_BATCH_TOO_LARGE，不会写入任何媒体记录。",
  }),
]);

export const SETTINGS_BY_KEY: ReadonlyMap<string, SettingDefinition> = new Map(
  SETTINGS_REGISTRY.map((entry) => [entry.key, entry]),
);

export function requireSettingDefinition(key: string): SettingDefinition {
  const definition = SETTINGS_BY_KEY.get(key);
  if (!definition) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  return definition;
}

export function isSettingsGroup(value: string): value is SystemSettingGroup {
  return value in SETTINGS_GROUP_LABELS;
}

export function groupLabel(group: SystemSettingGroup): string {
  return SETTINGS_GROUP_LABELS[group];
}

/** Values the public projection may expose (non-secret, explicitly public). */
export function publicSettingDefinitions(): readonly SettingDefinition[] {
  return SETTINGS_REGISTRY.filter((entry) => entry.isPublic && !entry.isSecret);
}

export function settingsValueTypeOf(value: SettingValue): SystemSettingValueType {
  if (value === null || typeof value === "object") {
    return "json";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return "number";
  }
  return "string";
}
