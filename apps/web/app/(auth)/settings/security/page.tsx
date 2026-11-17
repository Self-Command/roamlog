import type { Metadata } from "next";

import { TwoFactorSecurityView } from "@/components/auth/two-factor-security";
import { DATA_MODE } from "@/lib/data-mode";

export const metadata: Metadata = {
  title: "账号安全",
};

export default function SecuritySettingsPage() {
  return <TwoFactorSecurityView mode={DATA_MODE} />;
}
