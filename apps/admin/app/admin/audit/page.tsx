"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { AuditView } from "../../../components/audit/audit-view";

export default function AdminAuditPage() {
  return <AdminConsoleRoleAware>{(role) => <AuditView role={role} />}</AdminConsoleRoleAware>;
}
