import type { SystemSettingGroup } from "@roamlog/contracts";

import {
  SETTINGS_CONSUMPTION,
  type SettingsConsumption,
} from "../../lib/admin-settings";

/**
 * Field-level truth for settings whose group-level status is too coarse.
 *
 * A group badge can only be honest if every key in the group travels the same
 * distance. These groups mix values a client really reads with switches that
 * are not wired into any runtime path yet, so each exception gets its own
 * label instead of a green group badge.
 */
export type SettingFieldConsumptionStatus = "frontend" | "backend" | "unwired";

export interface SettingFieldConsumption {
  status: SettingFieldConsumptionStatus;
  label: string;
}

export const SETTING_FIELD_CONSUMPTION: Readonly<Record<string, SettingFieldConsumption>> =
  Object.freeze({
    "media.maxEdge": { status: "frontend", label: "已由用户端使用" },
    "media.quality": { status: "frontend", label: "已由用户端使用" },
    "media.targetBytes": { status: "frontend", label: "已由用户端使用" },
    "media.maxUploadBytes": { status: "frontend", label: "已由用户端使用" },
    "media.keepOriginal": { status: "unwired", label: "未接入（不生效）" },
    "media.livePhotoEnabled": { status: "unwired", label: "未接入（不生效）" },
    "general.registrationEnabled": { status: "unwired", label: "未接入（不生效）" },
    "seo.sitemapEnabled": { status: "unwired", label: "未接入（不生效）" },
    // All seven mail keys are read by `MailSettingsConsumer` in the API. The
    // worker still builds its transport from `EMAIL_*`/`SMTP_*`, so a stored
    // value never reaches worker-sent mail (export notifications). Each key
    // carries that limit instead of letting a green group badge imply it.
    "mail.provider": {
      status: "backend",
      label: "已由主服务读取；后台任务仍未接入此设置",
    },
    "mail.from": {
      status: "backend",
      label: "已由主服务读取；后台任务仍未接入此设置",
    },
    "mail.resendApiKey": {
      status: "backend",
      label: "已由主服务读取；后台任务仍未接入此设置",
    },
    "mail.smtpHost": {
      status: "backend",
      label: "已由主服务读取；后台任务仍未接入此设置",
    },
    "mail.smtpPort": {
      status: "backend",
      label: "已由主服务读取；后台任务仍未接入此设置",
    },
    "mail.smtpUser": {
      status: "backend",
      label: "已由主服务读取；后台任务仍未接入此设置",
    },
    "mail.smtpPassword": {
      status: "backend",
      label: "已由主服务读取；后台任务仍未接入此设置",
    },
    "places.provider": { status: "backend", label: "已由地点服务读取" },
    "places.apiKey": { status: "backend", label: "已由地点服务读取" },
    "places.lang": { status: "backend", label: "已由地点服务读取" },
    "places.limit": { status: "backend", label: "已由地点服务读取" },
    "places.cacheTtlSeconds": { status: "backend", label: "已由地点服务读取" },
    "places.dailyQuota": { status: "backend", label: "已由地点服务读取" },
    "limits.searchPerMinute": {
      status: "backend",
      label: "已由地点服务读取，并按每次请求生效",
    },
    "limits.uploadPerMinute": {
      status: "unwired",
      label: "未接入（上传签名限流在部署配置中固定，在此修改不生效）",
    },
    "ai.defaultProvider": { status: "backend", label: "已由 AI 服务读取" },
    "ai.timeoutMs": { status: "backend", label: "已由 AI 服务读取" },
    "ai.maxOutputTokens": { status: "backend", label: "已由 AI 服务读取" },
    "ai.dailyQuota": { status: "backend", label: "已由 AI 服务读取" },
    "ai.defaultReasoningEffort": {
      status: "frontend",
      label: "已由用户端和 AI 服务读取；用户未选择时使用此默认值",
    },
    "ai.suggestedPrompts": { status: "frontend", label: "已用于 AI 空会话页" },
  });

/** `null` means the group map is accurate enough for this key. */
export function settingFieldConsumption(key: string): SettingFieldConsumption | null {
  return SETTING_FIELD_CONSUMPTION[key] ?? null;
}

/**
 * Group-level summary with the field-level exceptions spelled out, so a
 * consumed group cannot hide a switch that does nothing.
 */
export function settingsGroupConsumption(group: SystemSettingGroup): SettingsConsumption {
  if (group === "general") {
    return {
      status: "frontend",
      label:
        "标题、描述和主题已生效；注册开关暂未接入",
    };
  }
  if (group === "seo") {
    return {
      status: "frontend",
      label:
        "标题、描述、社交预览和爬虫指令已生效；站点地图暂未接入",
    };
  }
  return SETTINGS_CONSUMPTION[group];
}
