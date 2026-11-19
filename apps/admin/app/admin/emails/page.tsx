"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { AdminDataBoundary } from "../../../components/admin-ui/admin-data-boundary";
import { EmailsView } from "../../../components/emails/emails-view";
import { useAdminEmailsResource, useAdminMutationPort } from "../../../lib/admin-data-source";

export default function AdminEmailsPage() {
  const resource = useAdminEmailsResource();
  const mutations = useAdminMutationPort();
  return (
    <AdminConsoleRoleAware>
      {(role) => (
        <AdminDataBoundary resource={resource}>
          {(emails) => (
            <EmailsView
              role={role}
              emails={emails}
              mutations={mutations}
            />
          )}
        </AdminDataBoundary>
      )}
    </AdminConsoleRoleAware>
  );
}
