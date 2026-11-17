"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { MediaView } from "../../../components/media/media-view";
import { getAdminDataSource } from "../../../lib/admin-data-source";

export default function AdminMediaPage() {
  const source = getAdminDataSource();
  return (
    <AdminConsoleRoleAware>
      {(role) => <MediaView role={role} media={source.listMedia()} />}
    </AdminConsoleRoleAware>
  );
}
