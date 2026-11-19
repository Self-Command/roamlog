"use client";

import type { SystemSettingGroup } from "@roamlog/contracts";

import { adminSettingsApi } from "../../lib/admin-settings-api";
import { useAdminSession } from "../admin-shell/admin-session-provider";
import { SettingsConsole } from "./settings-console";

/**
 * The console is mounted inside `AdminShell`, whose session provider is the
 * only source of the platform role. No role is inferred locally.
 */
export function SettingsPageClient({ initialGroup }: { initialGroup: SystemSettingGroup }) {
  const { session } = useAdminSession();
  return <SettingsConsole role={session.role} initialGroup={initialGroup} api={adminSettingsApi} />;
}