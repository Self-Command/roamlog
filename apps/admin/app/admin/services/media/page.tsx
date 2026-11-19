import type { Metadata } from "next";

import { ServiceSettingsPage } from "../../../../components/settings/service-settings-page";

export const metadata: Metadata = {
  title: "媒体处理",
};

export default function MediaServicePage() {
  return <ServiceSettingsPage service="media" />;
}
