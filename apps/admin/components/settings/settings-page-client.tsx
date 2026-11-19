"use client";

import { adminSettingsApi } from "../../lib/admin-settings-api";
import { useAdminSession } from "../admin-shell/admin-session-provider";
import { SettingsConsole } from "./settings-console";

/**
 * The console is mounted inside `AdminShell`, whose session provider is the
 * only source of the platform role. No role is inferred locally.
 */
export function SettingsPageClient() {
  const { session } = useAdminSession();
  return <SettingsConsole role={session.role} api={adminSettingsApi} />;
}
