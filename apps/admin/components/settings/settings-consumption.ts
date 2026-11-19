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
    "media.maxEdge": { status: "frontend", label: "前端已消费" },
    "media.quality": { status: "frontend", label: "前端已消费" },
    "media.targetBytes": { status: "frontend", label: "前端已消费" },
    "media.maxUploadBytes": { status: "frontend", label: "前端已消费" },
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
      label: "后端已消费（MailSettingsConsumer）；worker 导出通知不生效（worker 未接）",
    },
    "mail.from": {
      status: "backend",
      label: "后端已消费（MailSettingsConsumer）；worker 导出通知不生效（worker 未接）",
    },
    "mail.resendApiKey": {
      status: "backend",
      label: "后端已消费（MailSettingsConsumer）；worker 导出通知不生效（worker 未接）",
    },
    "mail.smtpHost": {
      status: "backend",
      label: "后端已消费（MailSettingsConsumer）；worker 导出通知不生效（worker 未接）",
    },
    "mail.smtpPort": {
      status: "backend",
      label: "后端已消费（MailSettingsConsumer）；worker 导出通知不生效（worker 未接）",
    },
    "mail.smtpUser": {
      status: "backend",
      label: "后端已消费（MailSettingsConsumer）；worker 导出通知不生效（worker 未接）",
    },
    "mail.smtpPassword": {
      status: "backend",
      label: "后端已消费（MailSettingsConsumer）；worker 导出通知不生效（worker 未接）",
    },
    "places.provider": { status: "backend", label: "后端已消费" },
    "places.apiKey": { status: "backend", label: "后端已消费" },
    "places.lang": { status: "backend", label: "后端已消费" },
    "places.limit": { status: "backend", label: "后端已消费" },
    "places.cacheTtlSeconds": { status: "backend", label: "后端已消费" },
    "places.dailyQuota": { status: "backend", label: "后端已消费" },
    "limits.searchPerMinute": {
      status: "backend",
      label: "后端已消费（Places 搜索限流，按请求解析）",
    },
    "limits.uploadPerMinute": {
      status: "unwired",
      label: "未接入（presign 限流仍读环境变量）",
    },
    "ai.defaultProvider": { status: "backend", label: "后端已消费" },
    "ai.timeoutMs": { status: "backend", label: "后端已消费" },
    "ai.maxOutputTokens": { status: "backend", label: "后端已消费" },
    "ai.dailyQuota": { status: "backend", label: "后端已消费" },
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
        "前端已消费（标题/描述/主题）；general.registrationEnabled 未接入（不生效）",
    };
  }
  if (group === "seo") {
    return {
      status: "frontend",
      label:
        "前端已消费（标题/描述/OG/robots）；seo.sitemapEnabled 未接入（不生效）",
    };
  }
  return SETTINGS_CONSUMPTION[group];
}