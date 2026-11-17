"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { FlagsView } from "../../../components/flags/flags-view";
import { getAdminDataSource } from "../../../lib/admin-data-source";

export default function AdminFlagsPage() {
  const source = getAdminDataSource();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <FlagsView
          role={role}
          flags={source.listFlags()}
          workspaces={source.listWorkspaces()}
        />
      )}
    </AdminConsoleRoleAware>
  );
}
