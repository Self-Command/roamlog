"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { AdminDataBoundary } from "../../../components/admin-ui/admin-data-boundary";
import { MediaView } from "../../../components/media/media-view";
import { useAdminMediaResource, useAdminMutationPort } from "../../../lib/admin-data-source";

export default function AdminMediaPage() {
  const resource = useAdminMediaResource();
  const mutations = useAdminMutationPort();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <AdminDataBoundary resource={resource}>
          {(media) => (
            <MediaView
              role={role}
              media={media}
              mutations={mutations}
              onRefresh={resource.refetch}
            />
          )}
        </AdminDataBoundary>
      )}
    </AdminConsoleRoleAware>
  );
}
