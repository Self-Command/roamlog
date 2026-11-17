import type { Metadata } from "next";
import { Users } from "lucide-react";

import { FeaturePlaceholder } from "@/components/placeholder/feature-placeholder";

export const metadata: Metadata = { title: "成员" };

export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return (
    <FeaturePlaceholder
      workspaceSlug={workspaceSlug}
      eyebrow="WORKSPACE / PEOPLE"
      title="成员与邀请"
      description="Owner / Admin / Editor / Viewer 的权限矩阵已经冻结；成员表和邀请流程由身份 API 提供。"
      icon={Users}
      emptyTitle="成员目录尚未接入"
      emptyDescription="当前只有 /v1/me 与 Workspace 角色 fixture，不伪造完整成员列表。Viewer 只读且可评论。"
      planned={[
        "成员表、角色修改与暂停状态",
        "过期、撤销和接受的邀请记录",
        "所有权转移与最后 Owner 保护",
      ]}
    />
  );
}
