import { normalizeSettingsGroup } from "../../../lib/admin-settings";
import { SettingsPageClient } from "../../../components/settings/settings-page-client";

interface AdminSettingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/admin/settings?group=mail` is resolved on the server so a deep link renders
 * the requested group on the first paint, not after a client-side effect.
 */
export default async function AdminSettingsPage({ searchParams }: AdminSettingsPageProps) {
  const params = await searchParams;
  const requested = Array.isArray(params.group) ? params.group[0] : params.group;
  return <SettingsPageClient initialGroup={normalizeSettingsGroup(requested)} />;
}