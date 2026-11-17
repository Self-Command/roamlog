import type { Metadata } from "next";
import { Map } from "lucide-react";

import { FeaturePlaceholder } from "@/components/placeholder/feature-placeholder";

export const metadata: Metadata = { title: "旅行地图" };

export default async function MapPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  return (
    <FeaturePlaceholder
      workspaceSlug={workspaceSlug}
      eyebrow="WORKSPACE / FOOTPRINTS"
      title="旅行地图"
      description="以后会在地图上展示已访问国家、计划中的路线和旅行足迹；当前保留清晰的降级入口。"
      icon={Map}
      emptyTitle="地图图层尚未接入"
      emptyDescription="MapLibre、停靠点坐标和 OpenFreeMap 样式会在 Wave 2 接入。列表仍可通过旅行库访问。"
      planned={[
        "已访问与计划中的国家填充",
        "停靠点、路线和选中高亮",
        "地图加载失败时自动切换城市列表",
      ]}
    />
  );
}
