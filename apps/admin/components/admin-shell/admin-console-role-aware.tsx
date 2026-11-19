"use client";

import type { AdminConsoleRole } from "../../lib/admin-types";
import { useAdminSession } from "./admin-session-provider";

export function AdminConsoleRoleAware({
  children,
}: {
  children: (role: AdminConsoleRole) => React.ReactNode;
}) {
  const { session } = useAdminSession();
  return <>{children(session.role)}</>;
}
