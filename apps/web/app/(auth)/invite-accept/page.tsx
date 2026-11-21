import type { Metadata } from "next";

import { InviteAccept } from "@/components/auth/invite-accept";
import { AuthShell } from "@/components/auth/auth-shell";

export const metadata: Metadata = {
  title: "接受邀请",
};

export default function InviteAcceptPage() {
  return (
    <AuthShell>
      <InviteAccept workspaceName="共享旅行档案" inviterName="你的同行者" role="editor" />
    </AuthShell>
  );
}
