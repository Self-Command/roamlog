import type { Metadata } from "next";

import { ServiceSettingsPage } from "../../../../components/settings/service-settings-page";

export const metadata: Metadata = {
  title: "AI 服务",
};

export default function AiServicePage() {
  return <ServiceSettingsPage service="ai" />;
}
