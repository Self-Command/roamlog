import type { Metadata } from "next";
import { InsightsWorkspace } from "@/components/charts/insights-workspace";

export const metadata: Metadata = { title: "旅行洞察" };

export default async function InsightsPage() {
  return <InsightsWorkspace />;
}
