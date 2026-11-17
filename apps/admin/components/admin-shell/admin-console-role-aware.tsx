"use client";

import type { AdminConsoleRole } from "../../lib/fixtures";
import { useAdminSession } from "./mock-session-provider";

export function AdminConsoleRoleAware({
  children,
}: {
  children: (role: AdminConsoleRole) => React.ReactNode;
}) {
  const { session } = useAdminSession();
  return <>{children(session.role)}</>;
}
