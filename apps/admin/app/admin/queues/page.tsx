"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { QueuesView } from "../../../components/queues/queues-view";
import { getAdminDataSource } from "../../../lib/admin-data-source";

export default function AdminQueuesPage() {
  const source = getAdminDataSource();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <QueuesView
          role={role}
          queues={source.listQueues()}
          failedJobs={source.listFailedJobs()}
        />
      )}
    </AdminConsoleRoleAware>
  );
}
