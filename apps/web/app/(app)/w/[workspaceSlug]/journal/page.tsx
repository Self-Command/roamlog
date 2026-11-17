import type { Metadata } from "next";
import { NotebookPen } from "lucide-react";

import { FeaturePlaceholder } from "@/components/placeholder/feature-placeholder";

export const metadata: Metadata = { title: "日志" };

export default async function JournalPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return (
    <FeaturePlaceholder
      workspaceSlug={workspaceSlug}
      eyebrow="WORKSPACE / JOURNAL"
      title="全部日志"
      description="把不同旅行的记录排成一条可搜索的时间线。当前任务只交付信息架构和空状态。"
      icon={NotebookPen}
      emptyTitle="日志内容尚未接入"
      emptyDescription="需要在 Wave 1 接入 Entry API、编辑器、照片与评论后，才能展示真实日志列表。"
      planned={[
        "按日期、心情、旅行和收藏筛选",
        "富文本编辑器、自动保存草稿与版本恢复",
        "评论、@提及和日志详情 Sheet",
      ]}
    />
  );
}
