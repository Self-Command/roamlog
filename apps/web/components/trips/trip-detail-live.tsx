"use client";

import { Button, ErrorState, Skeleton } from "@roamlog/ui";
import Link from "next/link";

import { TripWorkspace } from "@/components/trip-workspace";
import { isApiError } from "@/lib/api";
import { useTripQuery, useWorkspaceBySlug } from "@/lib/query";

/**
 * Trip detail route assembly.
 *
 * This file intentionally holds no tab logic and no mutation forms: the real
 * workbench lives in `components/trip-workspace/**`. What stays here is the one
 * responsibility that belongs to the route — resolving the workspace + trip and
 * rendering the loading / not-found / permission states around them.
 */
export function TripDetailLive({
  workspaceSlug,
  tripId,
}: {
  workspaceSlug: string;
  tripId: string;
}) {
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const tripQuery = useTripQuery(tripId);

  if (workspacesQuery.isLoading || tripQuery.isPending) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-64 rounded-card" aria-label="正在加载旅行" />
        <Skeleton className="h-14 w-full rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    );
  }

  if (!workspace || !tripQuery.data) {
    const failure = tripQuery.error;
    const networkFailure = isApiError(failure) && failure.status === 0;
    return (
      <ErrorState
        title={networkFailure ? "网络连接失败" : "找不到这趟旅行"}
        description={
          networkFailure
            ? "旅行详情暂时无法加载，请检查网络后重试。"
            : "旅行不存在、已归档，或当前账号没有访问权限。"
        }
        retryAction={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" variant="outline" onClick={() => void tripQuery.refetch()}>
              重试
            </Button>
            <Button asChild variant="primary">
              <Link href={`/w/${workspaceSlug}/trips`}>返回旅行库</Link>
            </Button>
          </div>
        }
      />
    );
  }

  return (
    <TripWorkspace
      trip={tripQuery.data}
      workspace={workspace}
      workspaceSlug={workspaceSlug}
    />
  );
}
