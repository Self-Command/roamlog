import type { Metadata } from "next";
import { AtlasWorkspace } from "@/components/map/atlas-workspace";

export const metadata: Metadata = { title: "旅行地图" };

export default async function MapPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  return <AtlasWorkspace workspaceSlug={workspaceSlug} />;
}
