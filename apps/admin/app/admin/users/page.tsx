"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { AdminDataBoundary } from "../../../components/admin-ui/admin-data-boundary";
import { UsersView } from "../../../components/users/users-view";
import { useAdminMutationPort, useAdminUsersResource } from "../../../lib/admin-data-source";
import { useAdminUserProfilePort } from "../../../lib/admin-users";

export default function AdminUsersPage() {
  const resource = useAdminUsersResource();
  const mutations = useAdminMutationPort();
  const profiles = useAdminUserProfilePort();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <AdminDataBoundary resource={resource}>
          {() => (
            <UsersView
              role={role}
              mutations={mutations}
              profiles={profiles}
            />
          )}
        </AdminDataBoundary>
      )}
    </AdminConsoleRoleAware>
  );
}
