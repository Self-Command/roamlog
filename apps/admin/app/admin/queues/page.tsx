"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { AdminDataBoundary } from "../../../components/admin-ui/admin-data-boundary";
import { QueuesView } from "../../../components/queues/queues-view";
import { useAdminMutationPort, useAdminQueuesResource } from "../../../lib/admin-data-source";

export default function AdminQueuesPage() {
  const resource = useAdminQueuesResource();
  const mutations = useAdminMutationPort();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <AdminDataBoundary resource={resource}>
          {({ queues, failedJobs }) => (
            <QueuesView
              role={role}
              queues={queues}
              failedJobs={failedJobs}
              mutations={mutations}
            />
          )}
        </AdminDataBoundary>
      )}
    </AdminConsoleRoleAware>
  );
}
