"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { EmailsView } from "../../../components/emails/emails-view";
import { getAdminDataSource } from "../../../lib/admin-data-source";

export default function AdminEmailsPage() {
  const source = getAdminDataSource();
  return (
    <AdminConsoleRoleAware>
      {(role) => <EmailsView role={role} emails={source.listEmails()} />}
    </AdminConsoleRoleAware>
  );
}
