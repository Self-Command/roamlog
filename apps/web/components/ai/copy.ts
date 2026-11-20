import type { AiFailureKind } from "@/lib/api/ai";
import {
  isReadOnlyAiTool,
  type AiPlanWarning,
  type AiToolCall,
  type AiToolName,
} from "@roamlog/contracts";

import type { PlanAction, PlanBucket } from "./plan-preview";

/**
 * All user-facing copy for the AI page lives here.
 *
 * The planner speaks in tool names, JSON arguments and problem codes; none of
 * that is shown to a traveller. This module is the only place that translates
 * those developer terms into product language, which also makes it trivial for
 * the tests to prove no raw code reaches the DOM.
 */

const TOOL_LABELS: Readonly<Record<AiToolName, string>> = {
  "places.search": "搜索地点",
  "trips.create": "创建旅行",
  "trips.get": "查阅旅行",
  "trips.list": "查找旅行",
  "trips.update": "修改旅行信息",
  "stops.add": "添加行程节点",
  "stops.list": "查看行程节点",
  "stops.update": "修改行程节点",
  "stops.delete": "移除行程节点",
  "stops.reorder": "调整节点顺序",
  "itinerary.addDay": "添加一天日程",
  "itinerary.update": "修改日程安排",
  "itinerary.delete": "移除日程安排",
  "packing.add": "添加装备",
  "packing.update": "修改装备",
  "packing.delete": "移除装备",
  "packing.reorder": "调整装备顺序",
  "budget.setSummary": "设置旅行预算",
  "expenses.add": "记录一笔开销",
  "expenses.update": "修改开销",
  "expenses.delete": "删除开销",
  "entries.create": "撰写旅行日志",
  "entries.update": "修改旅行日志",
  "participants.add": "添加同行人",
  "participants.remove": "移除同行人",
  "participants.role": "调整同行人角色",
};

const PACKING_CATEGORIES: Readonly<Record<string, string>> = {
  documents: "证件",
  clothing: "衣物",
  gear: "装备",
  health: "健康",
  other: "其他",
};

/** Expense categories are the API's enum values; only the display label is local. */
const EXPENSE_CATEGORIES: Readonly<Record<string, string>> = {
  transport: "交通",
  stay: "住宿",
  food: "餐饮",
  activity: "活动",
  shopping: "购物",
  other: "其他",
};

export function toolLabel(tool: AiToolName): string {
  return TOOL_LABELS[tool];
}

/**
 * Group headings for the plan preview.
 *
 * These are the only Chinese names for the nine buckets; `plan-preview.ts`
 * looks them up instead of carrying a second list (§C9 of the review spec).
 */
const PLAN_BUCKET_TITLES: Readonly<Record<PlanBucket, string>> = {
  trip: "行程",
  stops: "停靠点",
  itinerary: "每日行程",
  packing: "打包清单",
  budget: "预算",
  expenses: "开销",
  entries: "日志",
  participants: "同行人",
  orphan: "无法归属",
};

export function planBucketTitle(bucket: PlanBucket): string {
  return PLAN_BUCKET_TITLES[bucket];
}

/**
 * Chinese action words replace OpenTofu's `+ ~ -` symbols (a deliberate
 * information-architecture adaptation, not a code port).
 */
const PLAN_ACTION_LABELS: Readonly<Record<PlanAction, string>> = {
  add: "新增",
  change: "修改",
  remove: "移除",
};

export function planActionLabel(action: PlanAction): string {
  return PLAN_ACTION_LABELS[action];
}

const TOOL_NAMES: ReadonlySet<string> = new Set(Object.keys(TOOL_LABELS));

function knownTool(value: string): AiToolName | undefined {
  return TOOL_NAMES.has(value) ? (value as AiToolName) : undefined;
}

/**
 * Tool names arrive from the model, so they are not guaranteed to be one of
 * the ten planner tools. Known names get their Chinese label; unknown names
 * keep the raw identifier instead of rendering an English label or `null`
 * (vercel/chatbot returns `null` for unknown tools at message.tsx L341 — the
 * migration spec explicitly replaces that with the generic card).
 */
export function toolDisplayName(value: string): string {
  const known = knownTool(value);
  return known ? TOOL_LABELS[known] : value;
}

export type ToolStatusKind =
  | "running"
  | "complete"
  | "error"
  | "cancelled"
  | "waiting";

/**
 * Chinese replacement for vercel/chatbot `statusLabels` (tool.tsx L48–L56).
 * The upstream 7 AI-SDK states collapse to these four visible states plus the
 * approval "waiting" state used by plan-like tool calls.
 */
const TOOL_STATUS_LABELS: Readonly<Record<ToolStatusKind, string>> = {
  running: "运行中",
  complete: "完成",
  error: "失败",
  cancelled: "已取消",
  waiting: "等待确认",
};

export function toolStatusLabel(status: ToolStatusKind): string {
  return TOOL_STATUS_LABELS[status];
}

export function isWriteCall(call: AiToolCall): boolean {
  return !isReadOnlyAiTool(call.tool);
}

function textArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringList(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function objectList(args: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = args[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
}

const fractionDigitsCache = new Map<string, number>();

function fractionDigits(currency: string): number {
  const cached = fractionDigitsCache.get(currency);
  if (cached !== undefined) return cached;

  let digits: number;
  try {
    digits =
      new Intl.NumberFormat("zh-CN", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  fractionDigitsCache.set(currency, digits);
  return digits;
}

/** Renders integer minor units in the currency's own precision (JPY has none). */
export function formatMoney(amountMinor: number, currency: string): string {
  const digits = fractionDigits(currency);
  const major = amountMinor / 10 ** digits;
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(digits)}`;
  }
}

function dateRange(startDate: string | undefined, endDate: string | undefined): string | undefined {
  if (startDate && endDate) return `${startDate} → ${endDate}`;
  if (startDate) return `从 ${startDate} 开始`;
  if (endDate) return `截至 ${endDate}`;
  return undefined;
}

function clip(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

export interface PlannedCallCopy {
  /** Short human action, e.g. 「创建旅行」. */
  label: string;
  /** The main content, e.g. the trip title — never raw arguments. */
  headline: string;
  /** Supporting metadata lines (dates, budget, counts). */
  details: string[];
  /** `WRITES DATA.` becomes this badge, never the English tool description. */
  write: boolean;
}

/**
 * Turns one planned tool call into a human summary.
 *
 * Arguments are read individually through type guards: an unexpected shape is
 * ignored rather than printed, so no raw object can leak into the panel.
 */
export function describePlannedCall(call: AiToolCall): PlannedCallCopy {
  const args = call.args;
  const label = toolLabel(call.tool);
  const details: string[] = [];

  switch (call.tool) {
    case "trips.create": {
      const title = textArg(args, "title") ?? "未命名旅行";
      const dates = dateRange(textArg(args, "startDate"), textArg(args, "endDate"));
      if (dates) details.push(dates);
      const destinations = stringList(args, "destinations");
      if (destinations.length > 0) details.push(destinations.join("、"));
      const budget = numberArg(args, "budgetAmountMinor");
      const budgetCurrency = textArg(args, "budgetCurrency");
      if (budget !== undefined && budgetCurrency) {
        details.push(`预算 ${formatMoney(budget, budgetCurrency)}`);
      } else if (budget !== undefined) {
        details.push("已给出预算总量（币种未指定）");
      }
      return { label, headline: title, details, write: isWriteCall(call) };
    }
    case "stops.add": {
      const dates = dateRange(textArg(args, "startDate"), textArg(args, "endDate"));
      if (dates) details.push(dates);
      const notes = textArg(args, "notes");
      if (notes) details.push(clip(notes, 80));
      details.push("地点来自本次搜索");
      return { label, headline: "新增一个停留地点", details, write: isWriteCall(call) };
    }
    case "itinerary.addDay": {
      const date = textArg(args, "date");
      const title = textArg(args, "title") ?? "当天安排";
      const items = objectList(args, "items");
      if (date) details.push(date);
      details.push(`${items.length} 项安排`);
      const names = items
        .map((item) => textArg(item, "title"))
        .filter((name): name is string => Boolean(name));
      if (names.length > 0) details.push(clip(names.slice(0, 3).join(" / "), 100));
      return { label, headline: title, details, write: isWriteCall(call) };
    }
    case "packing.add": {
      const name = textArg(args, "name") ?? "未命名物品";
      const category = textArg(args, "category");
      if (category) details.push(PACKING_CATEGORIES[category] ?? "其他");
      const quantity = numberArg(args, "quantity");
      if (quantity !== undefined) details.push(`${quantity} 件`);
      return { label, headline: name, details, write: isWriteCall(call) };
    }
    case "budget.setSummary": {
      const amount = numberArg(args, "amountMinor");
      const currency = textArg(args, "currency");
      return {
        label,
        headline:
          amount === undefined || !currency
            ? "更新预算总额"
            : formatMoney(amount, currency),
        details,
        write: isWriteCall(call),
      };
    }
    case "places.search": {
      const query = textArg(args, "q") ?? "目的地";
      return { label, headline: query, details, write: isWriteCall(call) };
    }
    case "trips.get": {
      return { label, headline: "读取一份已有旅行", details, write: isWriteCall(call) };
    }
    case "trips.list": {
      const query = textArg(args, "query");
      const limit = numberArg(args, "limit");
      if (query) details.push(`标题包含「${query}」`);
      if (limit !== undefined) details.push(`最多 ${limit} 条`);
      return { label, headline: "查找已有旅行", details, write: isWriteCall(call) };
    }
    case "trips.update": {
      // "Make it 6 days" arrives as new dates on an existing trip, so the dates
      // are the fact worth showing; a rename shows its new title instead. The
      // trip id is never printed.
      const title = textArg(args, "title");
      const dates = dateRange(textArg(args, "startDate"), textArg(args, "endDate"));
      const summaryText = textArg(args, "summary");
      if (dates) details.push(dates);
      if (summaryText) details.push(clip(summaryText, 80));
      return {
        label,
        headline: title ?? (dates ? "调整旅行日期" : "调整旅行信息"),
        details,
        write: isWriteCall(call),
      };
    }
    case "stops.list": {
      return { label, headline: "读取一份已有行程", details, write: isWriteCall(call) };
    }
    case "stops.update": {
      const city = textArg(args, "city");
      const dates = dateRange(textArg(args, "startDate"), textArg(args, "endDate"));
      if (dates) details.push(dates);
      const notes = textArg(args, "notes");
      if (notes) details.push(clip(notes, 80));
      return {
        label,
        headline: city ?? (dates ? "调整停留日期" : "调整停留地点信息"),
        details,
        write: isWriteCall(call),
      };
    }
    case "stops.delete": {
      return { label, headline: "移除一个停留地点", details, write: isWriteCall(call) };
    }
    case "stops.reorder": {
      const items = stringList(args, "items");
      if (items.length > 0) details.push(`${items.length} 个停留地点`);
      return { label, headline: "重排停留顺序", details, write: isWriteCall(call) };
    }
    case "itinerary.update": {
      const title = textArg(args, "title");
      const date = textArg(args, "date");
      const startTime = textArg(args, "startTime");
      if (date) details.push(date);
      if (startTime) details.push(startTime);
      return {
        label,
        headline: title ?? "调整一项日程",
        details,
        write: isWriteCall(call),
      };
    }
    case "itinerary.delete": {
      return { label, headline: "移除一项日程", details, write: isWriteCall(call) };
    }
    case "packing.update": {
      const name = textArg(args, "name");
      const category = textArg(args, "category");
      if (category) details.push(PACKING_CATEGORIES[category] ?? "其他");
      const quantity = numberArg(args, "quantity");
      if (quantity !== undefined) details.push(`${quantity} 件`);
      if (args.packed === true) details.push("标记为已打包");
      return {
        label,
        headline: name ?? "调整一件装备",
        details,
        write: isWriteCall(call),
      };
    }
    case "packing.delete": {
      return { label, headline: "移除一件装备", details, write: isWriteCall(call) };
    }
    case "packing.reorder": {
      const items = stringList(args, "items");
      if (items.length > 0) details.push(`${items.length} 件装备`);
      return { label, headline: "调整装备顺序", details, write: isWriteCall(call) };
    }
    case "expenses.add": {
      const amount = numberArg(args, "amountMinor");
      const currency = textArg(args, "currency");
      const date = textArg(args, "date");
      const category = textArg(args, "category");
      if (date) details.push(date);
      if (category) details.push(EXPENSE_CATEGORIES[category] ?? category);
      const note = textArg(args, "note");
      if (note) details.push(clip(note, 80));
      return {
        label,
        headline:
          amount === undefined || !currency
            ? "记录一笔开销"
            : formatMoney(amount, currency),
        details,
        write: isWriteCall(call),
      };
    }
    case "expenses.update": {
      const amount = numberArg(args, "amountMinor");
      const currency = textArg(args, "currency");
      const note = textArg(args, "note");
      if (note) details.push(clip(note, 80));
      return {
        label,
        headline:
          amount !== undefined && currency ? formatMoney(amount, currency) : "调整一笔开销",
        details,
        write: isWriteCall(call),
      };
    }
    case "expenses.delete": {
      return { label, headline: "删除一笔开销", details, write: isWriteCall(call) };
    }
    case "entries.create": {
      const title = textArg(args, "title");
      const date = textArg(args, "date");
      const location = textArg(args, "location");
      if (date) details.push(date);
      if (location) details.push(clip(location, 60));
      const tags = stringList(args, "tags");
      if (tags.length > 0) details.push(tags.slice(0, 3).join("、"));
      return {
        label,
        headline: title ?? "写一篇旅行日志",
        details,
        write: isWriteCall(call),
      };
    }
    case "entries.update": {
      const title = textArg(args, "title");
      const date = textArg(args, "date");
      if (date) details.push(date);
      return {
        label,
        headline: title ?? "修改一篇旅行日志",
        details,
        write: isWriteCall(call),
      };
    }
    case "participants.add": {
      return { label, headline: "邀请一位同行人", details, write: isWriteCall(call) };
    }
    case "participants.remove": {
      return { label, headline: "移除一位同行人", details, write: isWriteCall(call) };
    }
    case "participants.role": {
      const role = textArg(args, "role");
      if (role) details.push(role === "editor" ? "提升为可编辑" : "设为仅查看");
      return { label, headline: "调整同行人角色", details, write: isWriteCall(call) };
    }
    default: {
      return { label, headline: "一个旅行操作", details, write: isWriteCall(call) };
    }
  }
}

export interface PlanWarningCopy {
  /** Human action name, e.g. 「创建旅行」. Absent when the subject is not a tool. */
  action?: string;
  /** What the server said, already written for travellers. */
  message: string;
  /** Extra coaching for a known code, e.g. what to do about a past date. */
  explanation?: string;
}

function warningExplanation(code: string): string | undefined {
  switch (code) {
    case "PAST_DATE":
      return "这些日期早于今天，已忽略。请给出未来的日期。";
    default:
      return undefined;
  }
}

/**
 * Turns one non-fatal plan warning into user copy.
 *
 * The warning `code` is never rendered. A known code adds a concrete next step;
 * an unknown code still shows the server's message, which is already written
 * for a traveller. The `subject` is mapped to an action only when it is one of
 * the tools this UI knows, so a future or argument-shaped subject cannot leak
 * a raw identifier into the panel.
 */
export function describePlanWarning(warning: AiPlanWarning): PlanWarningCopy {
  const tool = knownTool(warning.subject);
  return {
    action: tool ? toolLabel(tool) : undefined,
    message: warning.message,
    explanation: warningExplanation(warning.code),
  };
}

/**
 * The foldable summary of what the server already read while planning.
 *
 * Example: 「已搜索：Kyoto / Kiyomizu-dera Temple / Kinkaku-ji …（共 6 次查询）」.
 * The names are the user's own search queries, not tool payloads.
 */
export function summarizeReadOnlyTrace(trace: ReadonlyArray<AiToolCall>): string | null {
  if (trace.length === 0) return null;

  const searches = trace
    .filter((call) => call.tool === "places.search")
    .map((call) => textArg(call.args, "q"))
    .filter((query): query is string => Boolean(query));

  if (searches.length === 0) {
    return `已读取：工作区记录（共 ${trace.length} 次读取）`;
  }

  const shown = searches.slice(0, 3).join(" / ");
  const suffix = searches.length > 3 ? " …" : "";
  return `已搜索：${shown}${suffix}（共 ${searches.length} 次查询）`;
}

export interface FailureCopy {
  title: string;
  description: string;
  /** The AI provider is configured from the admin console, not by the user. */
  showAdminLink?: boolean;
}

/**
 * Plan-phase failures. Every sentence says what was (not) written, because a
 * user can never be left guessing whether a failed plan already wrote data.
 */
export function planFailureCopy(kind: AiFailureKind): FailureCopy {
  switch (kind) {
    case "not_configured":
      return {
        title: "AI 尚未配置",
        description:
          "请在后台系统设置中启用 AI 供应商后再试。现在没有写入任何内容；你也可以先手动创建旅行。",
        showAdminLink: true,
      };
    case "quota":
      return {
        title: "今天的 AI 规划次数已用完",
        description:
          "配额在 UTC 零点重置。这次没有生成计划，也没有写入任何内容；你可以先手动创建旅行。",
      };
    case "loop_limit":
      return {
        title: "这次需求需要的步骤过多",
        description:
          "助手到达了单次规划的上限，没有生成计划，也没有写入任何内容。把需求拆得更具体一些（例如先只建旅行）再试一次。",
      };
    case "upstream":
      return {
        title: "模型服务暂时不可用",
        description:
          "计划没有生成，工作区没有被写入任何内容。请稍后重试。",
      };
    case "schema_invalid":
      return {
        title: "这次回复无法使用",
        description:
          "助手返回的内容没有通过校验，计划没有生成，也没有写入任何内容。调整描述后再试一次。",
      };
    case "forbidden":
      return {
        title: "当前角色不能使用 AI 写入",
        description:
          "只有 Owner、Admin 或 Editor 可以让助手创建内容。你仍然可以浏览工作区里的旅行。",
      };
    case "unauthorized":
      return {
        title: "登录状态已失效",
        description: "请重新登录后再让助手规划；这次没有写入任何内容。",
      };
    case "invalid_request":
      return {
        title: "这条需求没有被接受",
        description: "请把目的地、时间和预算写得更具体一些再试。这次没有写入任何内容。",
      };
    case "invalid_response":
      return {
        title: "计划没有生成",
        description: "助手这次返回的内容无法读取，工作区没有被写入任何内容。请重试。",
      };
    case "network":
      return {
        title: "网络中断",
        description: "请求没有送达服务器，所以这次没有生成计划，也没有写入任何内容。",
      };
    case "run_not_found":
    case "run_consumed":
    case "call_not_planned":
      return {
        title: "这份计划已经不能执行",
        description: "请重新发起一次规划。现有旅行与日志没有被改动。",
      };
    default:
      return {
        title: "计划没有生成",
        description: "工作区没有被写入任何内容。请稍后重试。",
      };
  }
}

/** Failure copy for one executed call. The problem code is never echoed. */
export function toolFailureCopy(code: string): string {
  switch (code) {
    case "UNRESOLVED_PLACE":
      return "这个地点不在本次搜索的结果里，所以没有写入。";
    case "INVALID_ARGUMENTS":
    case "VALIDATION_ERROR":
    case "INVALID_INPUT":
      return "这条操作的参数不完整，所以没有写入。";
    case "WORKSPACE_ROLE_FORBIDDEN":
    case "FORBIDDEN":
      return "当前角色没有执行这一步的权限。";
    case "VERSION_CONFLICT":
      return "这条内容刚被其他人修改，请刷新后再试。";
    case "TRIP_NOT_FOUND":
    case "STOP_NOT_FOUND":
      return "目标旅行或行程节点已不存在。";
    default:
      return "这一步没有保存成功，请稍后重试。";
  }
}

/** Execution-phase failures, e.g. an expired or already-consumed plan. */
export function executionFailureCopy(kind: AiFailureKind): FailureCopy {
  switch (kind) {
    case "run_consumed":
      return {
        title: "这份计划已经执行过",
        description: "同一份计划只能提交一次。请重新发起一次规划，再确认新的计划。",
      };
    case "run_not_found":
      return {
        title: "这份计划已过期",
        description: "计划在 15 分钟内有效。请重新发起一次规划。",
      };
    case "call_not_planned":
      return {
        title: "提交的操作和计划不一致",
        description: "服务器拒绝了这次执行，没有写入新内容。请重新生成计划后再确认。",
      };
    case "forbidden":
      return {
        title: "当前角色不能执行这些操作",
        description: "执行被拒绝，没有写入任何内容。",
      };
    case "network":
      return {
        title: "执行结果未知",
        description:
          "网络在执行过程中中断。重试会复用同一个请求标识，服务器不会重复创建内容；如果已有内容，请先刷新页面确认。",
      };
    case "upstream":
    case "unknown":
      return {
        title: "执行没有完成",
        description:
          "服务器没有给出完整结果。重试会复用同一个请求标识，不会重复创建内容；如果已有内容，请先刷新页面确认。",
      };
    default:
      return {
        title: "执行没有完成",
        description: "没有写入任何新内容。请稍后重试。",
      };
  }
}

export function adminSettingsUrl(): string {
  const configured = process.env.NEXT_PUBLIC_ADMIN_URL?.trim();
  const base = configured && configured.length > 0 ? configured : "http://localhost:3001";
  return `${base.replace(/\/+$/u, "")}/admin/settings`;
}