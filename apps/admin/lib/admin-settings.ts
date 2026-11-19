import {
  SETTINGS_GROUPS,
  SETTINGS_GROUP_LABELS,
  type AdminSettingItem,
  type AdminSettingUpdate,
  type AdminSettingsResponse,
  type SettingValue,
  type SystemSettingGroup,
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
  theme: "站点强调色、默认模式与登录页文案。",
  mail: "事务邮件提供商与发信凭据。",
  storage: "S3 兼容对象存储端点、桶与签名凭据。",
  media: "客户端压缩目标与上传边界。",
  ai: "AI 规划调用的提供商、超时与配额。",
  places: "地点搜索提供商、语言、缓存与配额。",
  limits: "账户级请求速率限制。",
};

export type SettingsConsumptionStatus = "frontend" | "backend" | "unwired";

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
 * `mail`, `storage`, `ai` and `limits` are `unwired` until their runtime owners
 * actually consume `SettingsService`; see `settings-consumption.ts` for
 * field-level exceptions.
 */
export const SETTINGS_CONSUMPTION: Record<SystemSettingGroup, SettingsConsumption> = {
  general: { status: "frontend", label: "前端已消费（标题/描述/主题）" },
  seo: { status: "frontend", label: "前端已消费（标题/描述/主题）" },
  theme: { status: "frontend", label: "前端已消费（标题/描述/主题）" },
  mail: { status: "unwired", label: "未接入（不生效，仍读环境变量）" },
  storage: { status: "unwired", label: "未接入（不生效，仍读环境变量）" },
  media: {
    status: "frontend",
    label:
      "前端已消费 4/6 个键（maxEdge、quality、targetBytes、maxUploadBytes）；keepOriginal 与 livePhotoEnabled 未接入（不生效）",
  },
  ai: { status: "unwired", label: "未接入（不生效，仍读环境变量）" },
  places: { status: "backend", label: "后端已消费（PlacesModule 运行期读取）" },
  limits: { status: "unwired", label: "未接入（不生效，仍读环境变量）" },
};

export const SETTINGS_SOURCE_LABELS = {
  default: "代码默认",
  database: "数据库",
  environment: "环境变量",
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

export function settingsGroupHref(group: SystemSettingGroup): string {
  return `/admin/settings?group=${group}`;
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

export type JsonDraft =
  | { mode: "object"; rows: JsonRowDraft[] }
  | { mode: "raw"; text: string };

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
    // A nullable setting is the only contract-visible reason an empty string is
    // legal; everything else carries a min(1) schema on the API.
    if (text.length === 0 && item.default !== null) {
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
  if (leftKeys.length !== rightKeys.length || leftKeys.some((key, index) => key !== rightKeys[index])) {
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