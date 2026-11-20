import type { Metadata } from "next";

import { WorkspaceSettingsPage } from "@/components/settings/workspace-settings-page";

export const metadata: Metadata = { title: "工作区设置" };

export default async function WorkspaceSettingsRoute({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return <WorkspaceSettingsPage workspaceSlug={workspaceSlug} />;
}