import type { Metadata } from "next";

import { SecuritySettings } from "@/components/settings/security-settings";

export const metadata: Metadata = { title: "账号安全" };

export default async function SettingsSecurityPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return <SecuritySettings workspaceSlug={workspaceSlug} />;
}