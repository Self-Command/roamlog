"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { AdminDataBoundary } from "../../../components/admin-ui/admin-data-boundary";
import { FlagsView } from "../../../components/flags/flags-view";
import { useAdminFlagsResource, useAdminMutationPort } from "../../../lib/admin-data-source";

export default function AdminFlagsPage() {
  const resource = useAdminFlagsResource();
  const mutations = useAdminMutationPort();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <AdminDataBoundary resource={resource}>
          {({ flags, workspaces }) => (
            <FlagsView
              role={role}
              flags={flags}
              workspaces={workspaces}
              mode={resource.mode}
              mutations={resource.mode === "api" ? mutations : undefined}
            />
          )}
        </AdminDataBoundary>
      )}
    </AdminConsoleRoleAware>
  );
}
