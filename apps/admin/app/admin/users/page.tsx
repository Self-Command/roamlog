"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { AdminDataBoundary } from "../../../components/admin-ui/admin-data-boundary";
import { UsersView } from "../../../components/users/users-view";
import { useAdminMutationPort, useAdminUsersResource } from "../../../lib/admin-data-source";

export default function AdminUsersPage() {
  const resource = useAdminUsersResource();
  const mutations = useAdminMutationPort();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <AdminDataBoundary resource={resource}>
          {(users) => (
            <UsersView
              role={role}
              users={users}
              mode={resource.mode}
              mutations={resource.mode === "api" ? mutations : undefined}
            />
          )}
        </AdminDataBoundary>
      )}
    </AdminConsoleRoleAware>
  );
}
