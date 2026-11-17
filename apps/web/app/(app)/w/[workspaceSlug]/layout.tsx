import type { ReactNode } from "react";

import { WorkspaceAppShell } from "@/components/app-shell/workspace-app-shell";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <WorkspaceAppShell>{children}</WorkspaceAppShell>;
}
