import type { Metadata } from "next";

import { ServiceSettingsPage } from "../../../../components/settings/service-settings-page";

export const metadata: Metadata = {
  title: "发信服务",
};

export default function MailServicePage() {
  return <ServiceSettingsPage service="mail" />;
}
