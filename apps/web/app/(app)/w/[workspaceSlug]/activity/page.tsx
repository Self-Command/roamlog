import type { Metadata } from "next";
import { ActivityWorkspace } from "@/components/activity/activity-workspace";

export const metadata: Metadata = { title: "活动" };

export default async function ActivityPage() {
  return <ActivityWorkspace />;
}
