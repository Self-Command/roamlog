import type { Metadata } from "next";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginFormView } from "@/components/auth/login-form";
import { getPublicSettings, readPublicString } from "@/lib/settings";

export const metadata: Metadata = {
  title: "登录",
};

export default async function LoginPage() {
  // Runtime copy, read once per request: the layout fetch is memoized, so this
  // costs no extra API call. Blank/absent values fall back inside the form.
  const settings = await getPublicSettings();

  return (
    <AuthShell>
      <LoginFormView tagline={readPublicString(settings, "theme.loginTagline")} />
    </AuthShell>
  );
}
