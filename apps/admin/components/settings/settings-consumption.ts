import type { SystemSettingGroup } from "@roamlog/contracts";

import {
  SETTINGS_CONSUMPTION,
  type SettingsConsumption,
} from "../../lib/admin-settings";

/**
 * Field-level truth for settings whose group-level status is too coarse.
 *
 * The `media` group mixes four values the web client actually reads with two
 * behavior switches that are not implemented yet. Showing one green "consumed"
 * line for the whole group would be the exact "fake setting" problem this UI is
 * meant to prevent, so each key gets its own honest label.
 */
export type SettingFieldConsumptionStatus = "frontend" | "unwired";

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
  });

/** `null` means the group map is accurate enough for this key. */
export function settingFieldConsumption(key: string): SettingFieldConsumption | null {
  return SETTING_FIELD_CONSUMPTION[key] ?? null;
}

/**
 * Group-level summary, corrected for `media`. The base map in
 * `lib/admin-settings` is a static truth table; this override is static too,
 * because the admin UI still cannot observe the web client at runtime.
 */
export function settingsGroupConsumption(group: SystemSettingGroup): SettingsConsumption {
  if (group === "media") {
    return {
      status: "frontend",
      label:
        "前端已消费 4/6 个键（maxEdge、quality、targetBytes、maxUploadBytes）；keepOriginal 与 livePhotoEnabled 未接入（不生效）",
    };
  }
  return SETTINGS_CONSUMPTION[group];
}