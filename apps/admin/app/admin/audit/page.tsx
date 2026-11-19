"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { AdminDataBoundary } from "../../../components/admin-ui/admin-data-boundary";
import { AuditView } from "../../../components/audit/audit-view";
import { useAdminAuditResource, useAdminMutationPort } from "../../../lib/admin-data-source";

export default function AdminAuditPage() {
  const resource = useAdminAuditResource();
  const mutations = useAdminMutationPort();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <AdminDataBoundary resource={resource}>
          {(entries) => (
            <AuditView
              role={role}
              entries={entries}
              exportCsv={mutations.exportAuditCsv}
            />
          )}
        </AdminDataBoundary>
      )}
    </AdminConsoleRoleAware>
  );
}
