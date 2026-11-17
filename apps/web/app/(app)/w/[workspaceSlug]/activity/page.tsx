import type { Metadata } from "next";
import { ActivityWorkspace } from "@/components/activity/activity-workspace";
import { ActivityLive } from "@/components/activity/activity-live";
import { DATA_MODE } from "@/lib/data-mode";

export const metadata: Metadata = { title: "活动" };

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return DATA_MODE === "api" ? (
    <ActivityLive workspaceSlug={workspaceSlug} />
  ) : (
    <ActivityWorkspace />
  );
}
