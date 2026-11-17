import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";

import { FeaturePlaceholder } from "@/components/placeholder/feature-placeholder";

export const metadata: Metadata = { title: "旅行洞察" };

export default async function InsightsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return (
    <FeaturePlaceholder
      workspaceSlug={workspaceSlug}
      eyebrow="WORKSPACE / INSIGHTS"
      title="旅行洞察"
      description="年度旅行、花费、天数和同行者排行需要一个聚合 API，而不是在浏览器里伪造统计。"
      icon={BarChart3}
      emptyTitle="聚合指标等待 API"
      emptyDescription="真实支出、日志密度与年度对比需要后端聚合。当前总览只展示直接来自旅行 fixtures 的计数。"
      planned={["年度旅行柱状图与月度花费", "分类预算和旅行时长排行", "国家、城市与同行者统计"]}
    />
  );
}
