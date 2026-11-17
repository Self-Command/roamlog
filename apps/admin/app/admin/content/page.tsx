"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { ContentView } from "../../../components/content/content-view";
import { getAdminDataSource } from "../../../lib/admin-data-source";

export default function AdminContentPage() {
  const source = getAdminDataSource();
  return (
    <AdminConsoleRoleAware>
      {(role) => <ContentView role={role} items={source.listContent()} />}
    </AdminConsoleRoleAware>
  );
}
