import type { Metadata } from "next";

import { SettingsLive } from "@/components/settings/settings-live";

export const metadata: Metadata = { title: "设置" };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return <SettingsLive workspaceSlug={workspaceSlug} />;
}