import type { Metadata } from "next";

import { InviteAccept } from "@/components/auth/invite-accept";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "接受邀请",
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <AuthShell>
      <InviteAccept
        key={token}
        token={token}
        workspaceName="Roamlog Workspace"
        inviterName="你的同行者"
        role="editor"
      />
    </AuthShell>
  );
}
