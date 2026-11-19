import type { Metadata } from "next";

import { TwoFactorSecurityView } from "@/components/auth/two-factor-security";

export const metadata: Metadata = {
  title: "账号安全",
};

export default function SecuritySettingsPage() {
  return <TwoFactorSecurityView />;
}