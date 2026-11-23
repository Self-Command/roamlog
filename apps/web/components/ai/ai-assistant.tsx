"use client";

import { Button, ErrorState, PageHeader, Skeleton } from "@roamlog/ui";

import { useWorkspaceBySlug } from "@/lib/query";

import { AiChat } from "./ai-chat";

/**
 * Resolves the workspace for `/w/{slug}/ai` and renders the assistant body.
 *
 * The page itself stays a server component; only this boundary is client-side,
 * exactly like the other live workspace surfaces.
 */
export function AiAssistant({
  workspaceSlug,
  initialConversationId,
}: {
  workspaceSlug: string;
  initialConversationId?: string | undefined;
}) {
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="AI / 先计划，后写入"
        title="AI 旅行助手"
        titleSize="trip"
        description="用一句话描述目的地、时间和预算。助手先只读搜索并列出准备执行的操作；只有你勾选并确认后，才会写入工作区。"
      />

      {workspacesQuery.isLoading ? (
        <Skeleton className="h-[560px] rounded-card" />
      ) : !workspace ? (
        <ErrorState
          title="无法载入 Workspace"
          description="当前账号不是这个 Workspace 的成员，或链接中的 slug 已失效。"
          retryAction={
            <Button type="button" variant="outline" onClick={() => void workspacesQuery.refetch()}>
              重新加载
            </Button>
          }
        />
      ) : (
        <AiChat
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          role={workspace.role}
          {...(initialConversationId ? { initialConversationId } : {})}
        />
      )}
    </div>
  );
}
