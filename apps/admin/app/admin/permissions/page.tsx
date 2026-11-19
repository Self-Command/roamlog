"use client";

import { AdminConsoleRoleAware } from "../../../components/admin-shell/admin-console-role-aware";
import { PermissionsView } from "./permissions-view";

export default function AdminPermissionsPage() {
  return (
    <AdminConsoleRoleAware>{(role) => <PermissionsView role={role} />}</AdminConsoleRoleAware>
  );
}