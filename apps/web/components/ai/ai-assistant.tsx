"use client";

import { Button, ErrorState, PageHeader, Skeleton } from "@roamlog/ui";

import { useWorkspaceBySlug } from "@/lib/query";

import { AiConsole } from "./ai-console";

/**
 * Resolves the workspace for `/w/{slug}/ai` and renders the assistant body.
 *
 * The page itself stays a server component; only this boundary is client-side,
 * exactly like the other live workspace surfaces.
 */
export function AiAssistant({ workspaceSlug }: { workspaceSlug: string }) {
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
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <Skeleton className="h-[440px] rounded-card" />
          <Skeleton className="h-[320px] rounded-card" />
        </div>
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
        <AiConsole
          workspaceId={workspace.id}
          workspaceSlug={workspaceSlug}
          role={workspace.role}
        />
      )}
    </div>
  );
}