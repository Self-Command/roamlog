"use client";

import { adminSettingsApi } from "../../lib/admin-settings-api";
import { providerSettingsApi } from "../../lib/provider-settings-api";
import { SERVICE_SETTINGS_PAGES, type ServicePageKey } from "../../lib/admin-settings";
import { AdminPageHeader } from "../admin-ui/admin-page-header";
import { useAdminSession } from "../admin-shell/admin-session-provider";
import { ProviderGroupPage } from "./provider-group-page";
import { SettingsGroupForm } from "./settings-group-form";

/**
 * One service page (`/admin/services/[service]`): a Chinese page header plus
 * the same single-group form the system settings page uses. No group picker and
 * no second-level settings navigation.
 */
export function ServiceSettingsPage({ service }: { service: ServicePageKey }) {
  const page = SERVICE_SETTINGS_PAGES[service];
  const { session } = useAdminSession();

  if (page.group !== "media") {
    return <ProviderGroupPage group={page.group} role={session.role} api={providerSettingsApi} />;
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="平台 / 服务配置"
        title={page.title}
        description={page.description}
        readOnly={session.role !== "super_admin"}
      />
      <SettingsGroupForm group={page.group} role={session.role} api={adminSettingsApi} />
    </div>
  );
}
