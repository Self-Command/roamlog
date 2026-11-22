import type { Metadata } from "next";

import { AppearancePicker } from "@/components/appearance/appearance-picker";

export const metadata: Metadata = { title: "外观" };

export default function AppearanceSettingsPage() {
  return <AppearancePicker />;
}
