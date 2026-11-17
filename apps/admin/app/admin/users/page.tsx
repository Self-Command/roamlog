"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { UsersView } from "../../../components/users/users-view";

export default function AdminUsersPage() {
  return <AdminConsoleRoleAware>{(role) => <UsersView role={role} />}</AdminConsoleRoleAware>;
}
