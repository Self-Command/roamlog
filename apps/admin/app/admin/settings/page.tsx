import type { Metadata } from "next";

import { SettingsPageClient } from "../../../components/settings/settings-page-client";

export const metadata: Metadata = {
  title: "系统设置",
};

/**
 * `/admin/settings` — the four system-level groups only. Service configuration
 * lives at `/admin/services/*` and is reached from the sidebar, never from a
 * nested settings navigation.
 */
export default function AdminSettingsPage() {
  return <SettingsPageClient />;
}
