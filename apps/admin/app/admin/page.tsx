"use client";

import { DashboardView } from "../../components/dashboard/dashboard-view";
import { AdminConsoleRoleAware } from "../../components/admin-shell/admin-console-role-aware";
import { getAdminDataSource } from "../../lib/admin-data-source";

export default function AdminOverviewPage() {
  const dataSource = getAdminDataSource();
  return (
    <AdminConsoleRoleAware>
      {(role) => <DashboardView role={role} data={dataSource.getDashboard()} />}
    </AdminConsoleRoleAware>
  );
}
