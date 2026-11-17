import type { Metadata } from "next";

import { SettingsWorkspace } from "@/components/settings/settings-workspace";

export const metadata: Metadata = { title: "设置" };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  await params;
  return <SettingsWorkspace />;
}
