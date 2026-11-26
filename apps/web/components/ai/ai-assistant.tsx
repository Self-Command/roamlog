"use client";

import { Button, ErrorState, Skeleton } from "@roamlog/ui";

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
    <div className="flex min-h-0 flex-col md:h-[calc(100dvh-8.5rem)] md:min-h-[600px]">
      <div className="hidden shrink-0 items-end justify-between gap-6 pb-3 md:flex">
        <div className="min-w-0">
          <p className="type-eyebrow">AI 助手 / 先确认，再执行</p>
          <h1 className="mt-1 font-display text-xl font-semibold tracking-[-0.02em] text-ink">
            AI 旅行助手
          </h1>
        </div>
        <p className="max-w-md text-right text-xs leading-5 text-muted">
          描述目标、约束和期望结果。信息不足时助手会先提问，确认需求摘要后才生成计划。
        </p>
      </div>

      {workspacesQuery.isLoading || sessionQuery.isLoading ? (
        <Skeleton className="h-[560px] flex-1 rounded-card md:h-auto" />
      ) : !workspace || !userId ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
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
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <AiChat
            workspaceId={workspace.id}
            workspaceSlug={workspaceSlug}
            userId={userId}
            role={workspace.role}
            {...(initialConversationId ? { initialConversationId } : {})}
          />
        </div>
      )}
    </div>
  );
}
