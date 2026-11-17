import { AdminConsoleLayout } from "../../components/admin-shell/admin-console-layout";

export default function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AdminConsoleLayout>{children}</AdminConsoleLayout>;
}
