import type { Metadata } from "next";
import { Bell } from "lucide-react";

import { FeaturePlaceholder } from "@/components/placeholder/feature-placeholder";

export const metadata: Metadata = { title: "通知" };

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return (
    <FeaturePlaceholder
      workspaceSlug={workspaceSlug}
      eyebrow="WORKSPACE / NOTIFICATIONS"
      title="通知中心"
      description="评论、提及、邀请和提醒会进入个人通知中心，并遵循用户的 in-app / email 偏好。"
      icon={Bell}
      emptyTitle="通知 fixtures 尚未接入"
      emptyDescription="通知必须归属于具体用户；当前 shell 不伪造未读数量或已读状态。"
      planned={["未读与类型筛选", "标记已读和全部已读", "通知偏好设置与邮件退信可见性"]}
    />
  );
}
