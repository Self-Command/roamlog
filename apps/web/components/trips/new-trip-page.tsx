"use client";

import { Button, ErrorState, Skeleton } from "@roamlog/ui";

import { useWorkspaceBySlug } from "@/lib/query";

import { NewTripShell } from "./new-trip-shell";

export function NewTripPage({ workspaceSlug }: { workspaceSlug: string }) {
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);

  if (workspacesQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-12 w-48" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-96 rounded-card" />
          <Skeleton className="h-96 rounded-card" />
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <ErrorState
        title="无法新建旅行"
        description="Workspace 没有载入，因此不能计算新旅行的归属。"
        retryAction={
          <Button type="button" variant="primary" onClick={() => void workspacesQuery.refetch()}>
            重新加载
          </Button>
        }
      />
    );
  }

  return (
    <NewTripShell
      workspaceSlug={workspaceSlug}
      workspaceId={workspace.id}
      workspaceName={workspace.name}
    />
  );
}
