import type { Metadata } from "next";

import { ServiceSettingsPage } from "../../../../components/settings/service-settings-page";

export const metadata: Metadata = {
  title: "存储服务",
};

export default function StorageServicePage() {
  return <ServiceSettingsPage service="storage" />;
}
