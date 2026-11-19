import type { Metadata } from "next";

import { NotificationsLive } from "@/components/notifications/notifications-live";

export const metadata: Metadata = { title: "通知" };

export default async function NotificationsPage() {
  return <NotificationsLive />;
}