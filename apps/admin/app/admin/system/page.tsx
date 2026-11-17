"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { SystemView } from "../../../components/system/system-view";
import { getAdminDataSource } from "../../../lib/admin-data-source";

export default function AdminSystemPage() {
  const source = getAdminDataSource();
  return (
    <AdminConsoleRoleAware>
      {(role) => <SystemView role={role} snapshot={source.getSystem()} />}
    </AdminConsoleRoleAware>
  );
}
