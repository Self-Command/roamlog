import type {
  ExpenseCategory,
  ExpenseWithSplits,
  MediaStatus,
  PackingCategory,
  PlaceProvider,
  ShareLink,
} from "@roamlog/contracts";

const shortDateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" });
const shortDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** `2026-11-02` → `11月2日`. Calendar dates are parsed at noon to avoid TZ drift. */
export function shortDateLabel(value: string): string {
  return shortDateFormatter.format(new Date(`${value}T12:00:00`));
}

/** ISO timestamp → `11月18日 16:30`, for activity rows. */
export function shortTimestamp(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return shortDateTimeFormatter.format(parsed);
}

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  transport: "交通",
  stay: "住宿",
  food: "餐饮",
  activity: "活动",
  shopping: "购物",
  other: "其他",
};

export const EXPENSE_CATEGORIES = Object.keys(EXPENSE_CATEGORY_LABELS) as ExpenseCategory[];

export const PACKING_CATEGORY_LABELS: Record<PackingCategory, string> = {
  documents: "证件",
  clothing: "衣物",
  gear: "装备",
  health: "健康",
  other: "其他",
};

export const PACKING_CATEGORIES = Object.keys(PACKING_CATEGORY_LABELS) as PackingCategory[];

export function splitModeLabel(mode: ExpenseWithSplits["splitMode"]): string {
  return mode === "equal" ? "均摊" : "自定义分摊";
}

/**
 * Human label for a stop's place source. Wording mirrors
 * `lib/places-attribution.ts`: Geoapify/Photon are automated search sources,
 * `local` is the workspace's own place library and `null` is manual entry.
 * Unknown runtime values fall back to neutral copy instead of leaking the enum.
 */
export function providerLabel(provider: PlaceProvider | null): string {
  switch (provider) {
    case "geoapify":
      return "Geoapify 搜索";
    case "photon":
      return "Photon 搜索";
    case "tencent":
      return "腾讯地图搜索";
    case "map_pin":
      return "地图选点";
    case "local":
      return "本地地点库";
    case null:
      return "手动录入";
    default:
      return "未知来源";
  }
}

export const MEDIA_STATUS_LABELS: Record<MediaStatus, string> = {
  pending: "等待处理",
  processing: "服务器处理中",
  ready: "已就绪",
  failed: "处理失败",
};

export interface ShareLinkState {
  label: string;
  tone: "green" | "slate" | "red" | "yellow";
}

export function shareLinkState(link: ShareLink, now = Date.now()): ShareLinkState {
  if (link.revokedAt) return { label: "已撤销", tone: "red" };
  if (link.expiresAt && Date.parse(link.expiresAt) <= now) return { label: "已过期", tone: "slate" };
  return { label: "有效", tone: "green" };
}

const VERB_LABELS: Record<string, string> = {
  "trip.created": "创建了旅行",
  "trip.updated": "更新了旅行",
  "trip.deleted": "删除了旅行",
  "trip.duplicated": "复制了旅行",
  "trip.cover.set": "更新了封面",
  "trip.cover.cleared": "移除了封面",
  "stop.created": "添加了行程节点",
  "stop.updated": "修改了行程节点",
  "stop.deleted": "删除了行程节点",
  "expense.created": "记了一笔支出",
  "expense.updated": "修改了支出",
  "expense.deleted": "删除了支出",
  "packing.created": "添加了行李",
  "packing.updated": "更新了行李",
  "packing.deleted": "删除了行李",
  "packing.reordered": "调整了行李顺序",
  "share-link.created": "创建了分享链接",
  "share-link.revoked": "撤销了分享链接",
  "participant.added": "添加了参与者",
  "participant.removed": "移除了参与者",
  "entry.created": "写了日志",
  "entry.updated": "编辑了日志",
  "entry.deleted": "删除了日志",
  "media.deleted": "删除了照片",
  "media.presigned": "上传了照片",
};

/** Machine verbs stay out of the UI: unknown ones collapse to a readable line. */
export function activityVerbLabel(verb: string): string {
  return VERB_LABELS[verb] ?? "更新了记录";
}

const ENTITY_LABELS: Record<string, string> = {
  trip: "旅行",
  stop: "行程节点",
  itinerary_item: "行程项",
  expense: "花费",
  packing_item: "行李",
  journal_entry: "日志",
  comment: "评论",
  media: "照片",
  participant: "参与者",
  share_link: "分享链接",
  member: "成员",
  workspace: "工作区",
};

/** Machine entity types never render raw in the UI. */
export function activityEntityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? "记录";
}