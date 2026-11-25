"use client";

import { Button, ErrorState, PageHeader, Skeleton } from "@roamlog/ui";

import { useSessionQuery, useWorkspaceBySlug } from "@/lib/query";

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
  const sessionQuery = useSessionQuery();
  const userId = sessionQuery.data?.user.id;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="AI 助手 / 先确认，再执行"
        title="AI 旅行助手"
        titleSize="trip"
        description="先描述你的目标和约束。助手会询问缺少的信息，并在生成计划前让你确认需求摘要；确认后才允许写入工作区。"
      />

      {workspacesQuery.isLoading || sessionQuery.isLoading ? (
        <Skeleton className="h-[560px] rounded-card" />
      ) : !workspace || !userId ? (
        <ErrorState
          title="无法载入 AI 助手"
          description={
            !userId
              ? "无法确认当前登录账号，请重新登录后再试。"
              : "当前账号不是这个工作区的成员，或工作区地址已失效。"
          }
          retryAction={
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void sessionQuery.refetch();
                void workspacesQuery.refetch();
              }}
            >
              重新加载
            </Button>
          }
        />
      ) : (
        <AiChat
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          userId={userId}
          role={workspace.role}
          {...(initialConversationId ? { initialConversationId } : {})}
        />
      )}
    </div>
  );
}
