import type { Metadata } from "next";

import { DangerSettingsPage } from "@/components/settings/danger-settings-page";

export const metadata: Metadata = { title: "危险区" };

export default async function DangerSettingsRoute({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return <DangerSettingsPage workspaceSlug={workspaceSlug} />;
}