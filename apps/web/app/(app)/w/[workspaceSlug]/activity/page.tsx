import type { Metadata } from "next";
import { Activity } from "lucide-react";

import { FeaturePlaceholder } from "@/components/placeholder/feature-placeholder";

export const metadata: Metadata = { title: "活动" };

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return (
    <FeaturePlaceholder
      workspaceSlug={workspaceSlug}
      eyebrow="WORKSPACE / ACTIVITY"
      title="活动流"
      description="异步协作依赖可审阅的活动流、评论和实时缓存失效，而不是隐式覆盖。"
      icon={Activity}
      emptyTitle="活动 API 尚未接入"
      emptyDescription="Activity 写入会在业务事务完成后发生；页面将在活动接口可用后展示按天分组的记录。"
      planned={[
        "旅行与 Workspace 活动筛选",
        "actor、动词、对象和时间的可读组合",
        "分页加载与实时缓存失效提示",
      ]}
    />
  );
}
