import type { Metadata } from "next";
import dynamic from "next/dynamic";

import { ActivityLive } from "@/components/activity/activity-live";
import { DATA_MODE } from "@/lib/data-mode";

export const metadata: Metadata = { title: "活动" };

/** Fixture boundary: the mock activity workspace is demo-only and lazily loaded. */
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";

const LegacyActivityWorkspace = isApiBuild
  ? undefined
  : dynamic(() =>
      import("@/components/activity/activity-workspace").then(
        (module) => module.ActivityWorkspace,
      ),
    );

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  if (DATA_MODE === "api") {
    return <ActivityLive workspaceSlug={workspaceSlug} />;
  }

  return LegacyActivityWorkspace ? <LegacyActivityWorkspace /> : null;
}