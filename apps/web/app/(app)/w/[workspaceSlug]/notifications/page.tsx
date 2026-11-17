import type { Metadata } from "next";
import { NotificationsWorkspace } from "@/components/notifications/notifications-workspace";
import { NotificationsLive } from "@/components/notifications/notifications-live";
import { DATA_MODE } from "@/lib/data-mode";

export const metadata: Metadata = { title: "通知" };

export default async function NotificationsPage() {
  return DATA_MODE === "api" ? <NotificationsLive /> : <NotificationsWorkspace />;
}
