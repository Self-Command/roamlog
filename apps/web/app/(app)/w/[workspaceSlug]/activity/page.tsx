import type { Metadata } from "next";

import { ActivityLive } from "@/components/activity/activity-live";

export const metadata: Metadata = { title: "活动" };

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return <ActivityLive workspaceSlug={workspaceSlug} />;
}