"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { AdminDataBoundary } from "../../../components/admin-ui/admin-data-boundary";
import { AuditView } from "../../../components/audit/audit-view";
import { useAdminAuditResource } from "../../../lib/admin-data-source";

export default function AdminAuditPage() {
  const resource = useAdminAuditResource();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <AdminDataBoundary resource={resource}>
          {(entries) => <AuditView role={role} entries={entries} mode={resource.mode} />}
        </AdminDataBoundary>
      )}
    </AdminConsoleRoleAware>
  );
}
