"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { ContentView } from "../../../components/content/content-view";

export default function AdminContentPage() {
  return (
    <AdminConsoleRoleAware>
      {(role) => <ContentView role={role} />}
    </AdminConsoleRoleAware>
  );
}