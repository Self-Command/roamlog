import type { Metadata } from "next";

import { NotificationsSettings } from "@/components/settings/notifications-settings";

export const metadata: Metadata = { title: "通知" };

export default function SettingsNotificationsPage() {
  return <NotificationsSettings />;
}