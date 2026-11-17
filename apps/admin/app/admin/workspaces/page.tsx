"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { WorkspacesView } from "../../../components/workspaces/workspaces-view";

export default function AdminWorkspacesPage() {
  return <AdminConsoleRoleAware>{(role) => <WorkspacesView role={role} />}</AdminConsoleRoleAware>;
}
