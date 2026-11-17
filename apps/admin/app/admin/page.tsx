"use client";

import { DashboardView } from "../../components/dashboard/dashboard-view";
import { AdminConsoleRoleAware } from "../../components/admin-shell/admin-console-role-aware";
import { AdminDataBoundary } from "../../components/admin-ui/admin-data-boundary";
import { useAdminDashboardResource } from "../../lib/admin-data-source";

export default function AdminOverviewPage() {
  const resource = useAdminDashboardResource();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <AdminDataBoundary resource={resource}>
          {(data) => <DashboardView role={role} data={data} mode={resource.mode} />}
        </AdminDataBoundary>
      )}
    </AdminConsoleRoleAware>
  );
}
