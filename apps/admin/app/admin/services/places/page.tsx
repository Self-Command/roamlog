import type { Metadata } from "next";

import { ServiceSettingsPage } from "../../../../components/settings/service-settings-page";

export const metadata: Metadata = {
  title: "地图服务",
};

export default function PlacesServicePage() {
  return <ServiceSettingsPage service="places" />;
}
