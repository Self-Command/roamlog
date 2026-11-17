"use client";

import { usePathname } from "next/navigation";

import { AdminShell } from "./admin-shell";

export function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <AdminShell activePath={pathname}>{children}</AdminShell>;
}
