import type { Metadata } from "next";
import { NotificationsWorkspace } from "@/components/notifications/notifications-workspace";

export const metadata: Metadata = { title: "通知" };

export default async function NotificationsPage() {
  return <NotificationsWorkspace />;
}
