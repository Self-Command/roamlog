import type { Metadata } from "next";
import dynamic from "next/dynamic";

import { NotificationsLive } from "@/components/notifications/notifications-live";
import { DATA_MODE } from "@/lib/data-mode";

export const metadata: Metadata = { title: "通知" };

/** Fixture boundary: the mock notifications workspace is demo-only and lazily loaded. */
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";

const LegacyNotificationsWorkspace = isApiBuild
  ? undefined
  : dynamic(() =>
      import("@/components/notifications/notifications-workspace").then(
        (module) => module.NotificationsWorkspace,
      ),
    );

export default async function NotificationsPage() {
  if (DATA_MODE === "api") {
    return <NotificationsLive />;
  }

  return LegacyNotificationsWorkspace ? <LegacyNotificationsWorkspace /> : null;
}