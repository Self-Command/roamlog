import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SettingsNav } from "@/components/settings/settings-nav";

export const metadata: Metadata = { title: "设置" };

/**
 * Settings shell: one persistent section navigator plus the selected page.
 *
 * The nav is the only place the section list is declared, so `/settings/profile`,
 * `/settings/security`, `/settings/notifications`, `/settings/appearance`,
 * `/settings/workspace` and `/settings/danger` stay reachable from every one of
 * those pages.
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="min-w-0 lg:sticky lg:top-6">
          <SettingsNav workspaceSlug={workspaceSlug} />
        </div>
        <div className="min-w-0" data-testid="settings-content">
          {children}
        </div>
      </div>
    </div>
  );
}
