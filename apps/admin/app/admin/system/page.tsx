"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { AdminDataBoundary } from "../../../components/admin-ui/admin-data-boundary";
import { SystemView } from "../../../components/system/system-view";
import { useAdminSystemResource } from "../../../lib/admin-data-source";

export default function AdminSystemPage() {
  const resource = useAdminSystemResource();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <AdminDataBoundary resource={resource}>
          {(snapshot) => <SystemView role={role} snapshot={snapshot} mode={resource.mode} />}
        </AdminDataBoundary>
      )}
    </AdminConsoleRoleAware>
  );
}
