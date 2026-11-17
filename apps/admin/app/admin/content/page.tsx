"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { AdminDataBoundary } from "../../../components/admin-ui/admin-data-boundary";
import { ContentView } from "../../../components/content/content-view";
import { useAdminContentResource, useAdminMutationPort } from "../../../lib/admin-data-source";

export default function AdminContentPage() {
  const resource = useAdminContentResource();
  const mutations = useAdminMutationPort();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <AdminDataBoundary resource={resource}>
          {(items) => (
            <ContentView
              role={role}
              items={items}
              mode={resource.mode}
              mutations={resource.mode === "api" ? mutations : undefined}
            />
          )}
        </AdminDataBoundary>
      )}
    </AdminConsoleRoleAware>
  );
}
