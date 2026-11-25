import {
  SETTINGS_GROUPS,
  SETTINGS_GROUP_LABELS,
  type AdminSettingItem,
  type AdminSettingUpdate,
  type AdminSettingsResponse,
  type SettingValue,
  type SystemSettingGroup,
  type SystemSettingValueType,
} from "@roamlog/contracts";

/**
 * Pure helpers for the settings console: groups, drafts, validation, dirty
 * detection, and the request payload. Everything here is derived from the
 * contract payload — no setting key, option, default, or bound is hardcoded
 * in the UI.
 */

export const SETTINGS_GROUP_SUMMARIES: Record<SystemSettingGroup, string> = {
  general: "站点身份、默认语言与时区，以及注册策略。",
  seo: "搜索引擎与社交分享使用的默认元数据。",
  theme: "设置平台默认主题、字体和显示模式，以及是否允许成员自行调整。",
  mail: "事务邮件提供商与发信凭据。",
  storage: "文件存储的服务地址、存储桶和访问凭据。",
  media: "客户端压缩目标与上传边界。",
  ai: "AI 规划调用的提供商、默认思考强度、首屏提示词、超时与配额。",
  places: "地点搜索提供商、语言、缓存与配额。",
  limits: "账户级请求速率限制。",
};

/**
 * `/admin/settings` owns only these four system-level groups. Service groups
 * are edited on their own pages under `/admin/services/*`.
 */
export const SYSTEM_SETTINGS_GROUPS = [
  "general",
  "seo",
  "theme",
  "limits",
] as const satisfies readonly SystemSettingGroup[];

export const SERVICE_SETTINGS_PAGES = {
  ai: {
    group: "ai",
    title: "AI 服务",
    description: "配置 AI 规划调用的服务商、服务地址、模型、超时与配额。",
  },
  storage: {
    group: "storage",
    title: "存储服务",
    description: "配置文件存储的服务地址、存储桶、区域和访问凭据。",
  },
  places: {
    group: "places",
    title: "地图服务",
    description: "配置地点搜索服务商、语言、缓存与每日配额。",
  },
  mail: {
    group: "mail",
    title: "发信服务",
    description: "配置事务邮件的服务商、发件地址与发送凭据。",
  },
  media: {
    group: "media",
    title: "媒体处理",
    description: "配置客户端图片压缩目标与上传边界。",
  },
} as const satisfies Record<
  string,
  { group: SystemSettingGroup; title: string; description: string }
>;
export type ServicePageKey = keyof typeof SERVICE_SETTINGS_PAGES;

/** Display names for the contract's field types; the wire values never change. */
export const SETTING_TYPE_LABELS: Record<SystemSettingValueType, string> = {
  string: "文本",
  number: "数字",
  boolean: "开关",
  json: "高级数据（JSON）",
  secret: "密钥",
};

/** Display-only labels for enum option values; stored values stay untouched. */
export const SETTING_OPTION_LABELS: Readonly<Record<string, string>> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
  white: "白色",
  amber: "琥珀色",
  blue: "蓝色",
  emerald: "翡翠色",
  rose: "玫瑰色",
  "zh-CN": "简体中文",
  en: "英语",
  resend: "Resend",
  smtp: "SMTP",
  geoapify: "Geoapify",
  photon: "Photon",
  tencent: "腾讯地图",
  local: "本地数据",
  map_pin: "手动选点",
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
};

export function settingOptionLabel(option: string): string {
  return SETTING_OPTION_LABELS[option] ?? option;
}

export type SettingsConsumptionStatus = "frontend" | "backend" | "unwired";

/**
 * Presentation-only help overrides for server-provided settings whose original
 * copy exposes implementation vocabulary. Stored keys, labels and values are
 * untouched; only the operator-facing explanation changes.
 */
export const SETTING_HELP_OVERRIDES: Readonly<Record<string, string>> = {
  "general.defaultTimeZone": "用于新账户和日期显示的时区，例如 Asia/Shanghai。",
  "media.maxEdge": "浏览器压缩图片时保留的最长边，限制在 500–4000 像素。",
  "media.targetBytes":
    "浏览器在上传前尽量压缩到的文件大小，限制在 100 KB–5 MB。",
  "media.maxUploadBytes":
    "单个文件允许的最大上传体积，上限 25 MB；系统会在写入前检查，浏览器也会提前拦截。",
  "limits.searchPerMinute": "每个账户每分钟允许发起的地点搜索请求数。",
  "limits.uploadPerMinute": "每个账户每分钟允许发起的上传请求数。",
  "limits.uploadMaxFilesPerBatch":
    "一次批量上传最多可包含多少张照片（1–100 张，默认 20 张）。超过上限时整批不会写入；该限制也用于上传队列与提示文案。",
};

export function settingHelp(item: AdminSettingItem): string | null {
  return SETTING_HELP_OVERRIDES[item.key] ?? item.help ?? null;
}

export interface SettingsConsumption {
  status: SettingsConsumptionStatus;
  label: string;
}

/**
 * Read-only truth about how far each group's values travel. This is a static
 * constant, deliberately not a runtime probe: the admin UI cannot observe the
 * web frontend or the worker, so it must not pretend it can.
 *
 * - `frontend`: the web client really reads the value.
 * - `backend`: a backend module really reads the value at request time.
 * - `unwired`: stored in the database only; changing it does not change
 *   behavior, because the runtime still reads an environment variable.
 *
 * `mail` and `storage` are `backend`: `MailSettingsConsumer` and
 * `StorageSettingsConsumer` read `SettingsService.getGroup(...)` at runtime,
 * so a stored value wins over the environment in the API. Both labels carry
 * their limits instead of hiding them: the worker still reads `EMAIL_*` / `S3_*`
 * (so `mail.*` does not reach worker-sent messages), and a storage save runs a
 * connectivity probe before it persists. `limits` is partially wired: the
 * search allowance is enforced by the place-search limiter, while the presign
 * allowance is still read from the environment, so its group badge stays
 * yellow with the split spelled out; see `settings-consumption.ts` for
 * field-level exceptions.
 */
export const SETTINGS_CONSUMPTION: Record<SystemSettingGroup, SettingsConsumption> = {
  general: { status: "frontend", label: "已由用户端使用" },
  seo: { status: "frontend", label: "已由用户端使用" },
  theme: { status: "frontend", label: "已由用户端使用" },
  mail: { status: "backend", label: "已由主服务读取；后台任务仍使用部署配置" },
  storage: {
    status: "backend",
    label: "已由服务读取；保存前会检查连接",
  },
  media: {
    status: "frontend",
    label:
      "已使用最长边、质量、目标字节和最大上传字节；保留原图与实况照片暂未接入",
  },
  ai: { status: "backend", label: "已由 AI 服务读取" },
  places: { status: "backend", label: "已由地点服务读取" },
  limits: {
    status: "unwired",
    label: "部分接入：搜索限流已生效；上传限流仍由部署配置决定",
  },
};

export const SETTINGS_SOURCE_LABELS = {
  default: "代码默认",
  database: "数据库",
  environment: "部署配置",
} as const;
export type SettingsValueSource = keyof typeof SETTINGS_SOURCE_LABELS;

export function settingValueSource(item: AdminSettingItem): SettingsValueSource {
  if (item.envLocked) {
    return "environment";
  }
  return item.updatedAt ? "database" : "default";
}

export function normalizeSettingsGroup(value: unknown): SystemSettingGroup {
  return typeof value === "string" && (SETTINGS_GROUPS as readonly string[]).includes(value)
    ? (value as SystemSettingGroup)
    : "general";
}

const SERVICE_GROUP_HREFS: Partial<Record<SystemSettingGroup, string>> = {
  ai: "/admin/services/ai",
  storage: "/admin/services/storage",
  places: "/admin/services/places",
  mail: "/admin/services/mail",
  media: "/admin/services/media",
};

/** Where a group is edited in the rebuilt IA: its own service page or the four-group system page. */
export function settingsGroupHref(group: SystemSettingGroup): string {
  return SERVICE_GROUP_HREFS[group] ?? "/admin/settings";
}

export function firstGroupInResponse(response: AdminSettingsResponse): SystemSettingGroup {
  return response.groups[0]?.group ?? "general";
}

export function groupItems(
  response: AdminSettingsResponse,
  group: SystemSettingGroup,
): readonly AdminSettingItem[] {
  return response.groups.find((entry) => entry.group === group)?.items ?? [];
}

/** Default reveal window, in milliseconds. Mirrors the copy in the UI. */
export const SETTINGS_REVEAL_DURATION_MS = 10_000;

export interface JsonRowDraft {
  id: string;
  key: string;
  valueText: string;
}

export type JsonDraft = { mode: "object"; rows: JsonRowDraft[] } | { mode: "raw"; text: string };

/**
 * Draft values are stored as the control's editing representation: strings and
 * numbers as text, booleans as booleans, JSON as a structured draft. This keeps
 * a partially typed number from becoming `NaN` and lets the JSON editor report
 * the exact row that is malformed.
 */
export type SettingDraftValue = string | boolean | JsonDraft;

let jsonRowSequence = 0;
function nextJsonRowId(): string {
  jsonRowSequence += 1;
  return `json-row-${jsonRowSequence}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function isJsonDraft(value: SettingDraftValue): value is JsonDraft {
  return typeof value === "object" && value !== null && "mode" in value;
}

function jsonDraftFromValue(value: unknown): JsonDraft {
  if (isPlainObject(value)) {
    return {
      mode: "object",
      rows: Object.entries(value).map(([key, entry]) => ({
        id: nextJsonRowId(),
        key,
        valueText: JSON.stringify(entry) ?? "null",
      })),
    };
  }
  return { mode: "raw", text: JSON.stringify(value, null, 2) ?? "null" };
}

export function draftFromItem(item: AdminSettingItem): SettingDraftValue {
  if (item.type === "boolean") {
    return item.value === true;
  }
  if (item.type === "json") {
    return jsonDraftFromValue(item.value);
  }
  if (item.type === "secret") {
    return "";
  }
  if (item.value === null || item.value === undefined) {
    return "";
  }
  return String(item.value);
}

export function draftFromItems(
  items: readonly AdminSettingItem[],
): Record<string, SettingDraftValue> {
  return Object.fromEntries(items.map((item) => [item.key, draftFromItem(item)]));
}

export interface JsonParseSuccess {
  ok: true;
  value: unknown;
}
export interface JsonParseFailure {
  ok: false;
  message: string;
  rowIndex?: number;
}
export type JsonParseResult = JsonParseSuccess | JsonParseFailure;

export function parseJsonDraft(draft: JsonDraft): JsonParseResult {
  if (draft.mode === "raw") {
    if (draft.text.trim() === "") {
      return { ok: false, message: "请输入 JSON 内容。" };
    }
    try {
      return { ok: true, value: JSON.parse(draft.text) as unknown };
    } catch {
      return { ok: false, message: "不是合法的 JSON，请检查引号、逗号与括号。" };
    }
  }

  const result: Record<string, unknown> = {};
  for (const [index, row] of draft.rows.entries()) {
    const key = row.key.trim();
    if (!key) {
      return { ok: false, rowIndex: index, message: `第 ${index + 1} 行的键不能为空。` };
    }
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      return { ok: false, rowIndex: index, message: `键 "${key}" 重复。` };
    }
    try {
      result[key] = JSON.parse(row.valueText) as unknown;
    } catch {
      return {
        ok: false,
        rowIndex: index,
        message: `第 ${index + 1} 行的值不是合法 JSON（字符串需要引号）。`,
      };
    }
  }
  return { ok: true, value: result };
}

export function jsonDraftError(draft: JsonDraft): string | null {
  const parsed = parseJsonDraft(draft);
  return parsed.ok ? null : parsed.message;
}

/** Returns a human-readable, field-local validation error, or null. */
export function localSettingError(
  item: AdminSettingItem,
  draft: SettingDraftValue | undefined,
): string | null {
  if (item.envLocked) {
    return null;
  }

  if (item.type === "number") {
    const text = typeof draft === "string" ? draft.trim() : "";
    if (!text) {
      return "请输入数字。";
    }
    if (!Number.isFinite(Number(text))) {
      return "必须是有效数字。";
    }
    return null;
  }

  if (item.type === "string") {
    const text = typeof draft === "string" ? draft : "";
    // A nullable setting is one contract-visible reason an empty string is
    // legal; the other is a code default of "" (the API validates every
    // non-null default against its own schema, so such a key accepts empty).
    if (text.length === 0 && item.default !== null && item.default !== "") {
      return "不能为空。";
    }
    return null;
  }

  if (item.type === "json") {
    if (!isJsonDraft(draft as SettingDraftValue)) {
      return "JSON 编辑器状态无效。";
    }
    return jsonDraftError(draft as JsonDraft);
  }

  return null;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((entry, index) => deepEqual(entry, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key, index) => key !== rightKeys[index])
  ) {
    return false;
  }
  return leftKeys.every((key) => deepEqual(leftRecord[key], rightRecord[key]));
}

export function draftToSettingValue(
  item: AdminSettingItem,
  draft: SettingDraftValue | undefined,
): SettingValue {
  if (item.type === "boolean") {
    return draft === true;
  }
  if (item.type === "number") {
    return Number(typeof draft === "string" ? draft.trim() : "");
  }
  if (item.type === "json") {
    const parsed = parseJsonDraft(draft as JsonDraft);
    if (!parsed.ok) {
      throw new Error(parsed.message);
    }
    return parsed.value as SettingValue;
  }
  const text = typeof draft === "string" ? draft : item.value === null ? "" : String(item.value);
  if (text === "" && item.default === null) {
    return null;
  }
  return text;
}

export function draftMatchesValue(
  item: AdminSettingItem,
  draft: SettingDraftValue | undefined,
): boolean {
  if (item.type === "json") {
    const parsed = parseJsonDraft(draft as JsonDraft);
    return parsed.ok && deepEqual(parsed.value, item.value);
  }
  if (item.type === "number") {
    const text = typeof draft === "string" ? draft.trim() : "";
    return text !== "" && Number.isFinite(Number(text)) && Number(text) === item.value;
  }
  if (draftToSettingValue(item, draft) === null) {
    return item.value === null || item.value === undefined;
  }
  return deepEqual(draftToSettingValue(item, draft), item.value);
}

export interface CollectedUpdates {
  updates: AdminSettingUpdate[];
  errors: Record<string, string>;
}

/**
 * Builds the PATCH payload from the current group only. Secret fields are
 * omitted unless the operator typed a new value; existing ciphertext is never
 * round-tripped through the browser.
 */
export function collectGroupUpdates(
  items: readonly AdminSettingItem[],
  values: Record<string, SettingDraftValue>,
  secretDrafts: Record<string, string>,
): CollectedUpdates {
  const updates: AdminSettingUpdate[] = [];
  const errors: Record<string, string> = {};

  for (const item of items) {
    if (item.envLocked) {
      continue;
    }

    if (item.type === "secret") {
      const draft = secretDrafts[item.key] ?? "";
      if (draft.length > 0) {
        updates.push({ key: item.key, value: draft });
      }
      continue;
    }

    const draft = values[item.key] ?? draftFromItem(item);
    const error = localSettingError(item, draft);
    if (error) {
      errors[item.key] = error;
      continue;
    }
    if (!draftMatchesValue(item, draft)) {
      updates.push({ key: item.key, value: draftToSettingValue(item, draft) });
    }
  }

  return { updates, errors };
}

export function dirtySettingKeys(
  items: readonly AdminSettingItem[],
  values: Record<string, SettingDraftValue>,
  secretDrafts: Record<string, string>,
): string[] {
  return items
    .filter((item) => {
      if (item.envLocked) {
        return false;
      }
      if (item.type === "secret") {
        return (secretDrafts[item.key] ?? "").length > 0;
      }
      return !draftMatchesValue(item, values[item.key] ?? draftFromItem(item));
    })
    .map((item) => item.key);
}

export function latestUpdatedAt(items: readonly AdminSettingItem[]): string | null {
  let latest: string | null = null;
  for (const item of items) {
    if (!item.updatedAt) {
      continue;
    }
    if (!latest || item.updatedAt > latest) {
      latest = item.updatedAt;
    }
  }
  return latest;
}

export function fieldErrorMessages(
  errors: readonly { field?: string; message: string }[],
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const error of errors) {
    if (!error.field) {
      continue;
    }
    mapped[error.field] = mapped[error.field]
      ? `${mapped[error.field]}；${error.message}`
      : error.message;
  }
  return mapped;
}

export function groupLabel(group: SystemSettingGroup): string {
  return SETTINGS_GROUP_LABELS[group];
}

/**
 * The wire group stays `theme` for compatibility, but the operator-facing tab
 * now owns the complete appearance defaults surface.
 */
export function settingsTabLabel(group: SystemSettingGroup): string {
  return group === "theme" ? "外观与字体" : groupLabel(group);
}
