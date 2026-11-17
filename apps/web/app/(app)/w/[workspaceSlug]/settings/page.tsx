import type { Metadata } from "next";

import { SettingsLive } from "@/components/settings/settings-live";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";
import { DATA_MODE } from "@/lib/data-mode";

export const metadata: Metadata = { title: "设置" };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return DATA_MODE === "api" ? (
    <SettingsLive workspaceSlug={workspaceSlug} />
  ) : (
    <SettingsWorkspace />
  );
}
