import type { Metadata } from "next";
import dynamic from "next/dynamic";

import { SettingsLive } from "@/components/settings/settings-live";
import { DATA_MODE } from "@/lib/data-mode";

export const metadata: Metadata = { title: "设置" };

/** Fixture boundary: the mock settings workspace is demo-only and lazily loaded. */
const isApiBuild = process.env.NEXT_PUBLIC_DATA_MODE === "api";

const LegacySettingsWorkspace = isApiBuild
  ? undefined
  : dynamic(() =>
      import("@/components/settings/settings-workspace").then(
        (module) => module.SettingsWorkspace,
      ),
    );

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  if (DATA_MODE === "api") {
    return <SettingsLive workspaceSlug={workspaceSlug} />;
  }

  return LegacySettingsWorkspace ? <LegacySettingsWorkspace /> : null;
}