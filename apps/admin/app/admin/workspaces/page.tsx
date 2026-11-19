"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { AdminDataBoundary } from "../../../components/admin-ui/admin-data-boundary";
import { WorkspacesView } from "../../../components/workspaces/workspaces-view";
import { useAdminMutationPort, useAdminWorkspacesResource } from "../../../lib/admin-data-source";

export default function AdminWorkspacesPage() {
  const resource = useAdminWorkspacesResource();
  const mutations = useAdminMutationPort();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <AdminDataBoundary resource={resource}>
          {() => (
            <WorkspacesView
              role={role}
              mutations={mutations}
            />
          )}
        </AdminDataBoundary>
      )}
    </AdminConsoleRoleAware>
  );
}
