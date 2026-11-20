import type { Metadata } from "next";

import { ProfileSettings } from "@/components/settings/profile-settings";

export const metadata: Metadata = { title: "个人资料" };

export default async function SettingsProfilePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return <ProfileSettings workspaceSlug={workspaceSlug} />;
}