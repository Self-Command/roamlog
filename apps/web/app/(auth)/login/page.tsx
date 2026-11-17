import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginFormView } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "登录",
};

export default function LoginPage() {
  return (
    <AuthShell>
      <LoginFormView />
    </AuthShell>
  );
}
