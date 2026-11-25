"use client";

import type { UpdateTripRequest } from "@roamlog/contracts";
import { Button, ErrorState, Skeleton, buttonVariants } from "@roamlog/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { searchPlacesForTripForm, useTripFormTripQuery, useUpdateTripFormMutation } from "@/lib/api/trip-form";
import { useWorkspaceBySlug } from "@/lib/query";

import { TripForm, type TripFormPlaceSearch } from "./trip-form/trip-form";

export function EditTripPage({
  workspaceSlug,
  tripId,
}: {
  workspaceSlug: string;
  tripId: string;
}) {
  const router = useRouter();
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const tripQuery = useTripFormTripQuery(tripId);
  const updateTrip = useUpdateTripFormMutation(tripId);
  const [formKey, setFormKey] = React.useState(0);

  const trip = tripQuery.data;
  const detailHref = `/w/${workspaceSlug}/trips/${tripId}`;

  const searchPlaces: TripFormPlaceSearch = React.useCallback(async (query, { signal }) => {
    const outcome = await searchPlacesForTripForm(query, signal);
    // The provider must reach the form so the credit names the real source.
    return { items: outcome.items, degraded: outcome.degraded, provider: outcome.provider };
  }, []);

  async function handleReload() {
    const result = await tripQuery.refetch();
    if (result.data) setFormKey((key) => key + 1);
  }

  async function handleSubmit(patch: UpdateTripRequest) {
    await updateTrip.mutateAsync(patch);
    router.push(detailHref);
    router.refresh();
  }

  if (workspacesQuery.isLoading || tripQuery.isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-5 w-full max-w-xl" />
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
          <Skeleton className="h-[520px] rounded-card" />
          <Skeleton className="h-80 rounded-card" />
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <ErrorState
        title="无法加载工作区"
        description="没有找到这个工作区，或你没有访问权限。"
        retryAction={
          <Button type="button" variant="primary" onClick={() => void workspacesQuery.refetch()}>
            重新加载
          </Button>
        }
      />
    );
  }

  if (!trip || tripQuery.isError) {
    return (
      <ErrorState
        title="找不到这趟旅行"
        description="旅行可能已被删除，或者你没有访问权限。"
        retryAction={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button type="button" variant="outline" onClick={() => void tripQuery.refetch()}>
              重试
            </Button>
            <Link href={detailHref} className={buttonVariants({ variant: "ghost" })}>
              返回旅行详情
            </Link>
          </div>
        }
      />
    );
  }

  if (workspace.role === "viewer") {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-card border border-hairline bg-surface-1/60 p-6">
          <p className="type-eyebrow">编辑旅行</p>
          <h1 className="type-page-title mt-3">你没有编辑权限</h1>
          <p className="mt-3 text-sm leading-6 text-body">
            你是只读成员。可以查看「{trip.title}」的详情，但不能修改内容。
            如需编辑，请联系工作区所有者或管理员调整权限。
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href={detailHref} className={buttonVariants({ variant: "primary" })}>
              返回旅行详情
            </Link>
            <Link
              href={`/w/${workspaceSlug}/trips`}
              className={buttonVariants({ variant: "ghost" })}
            >
              全部旅行
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <TripForm
      key={`${trip.id}:${formKey}`}
      mode="edit"
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      searchPlaces={searchPlaces}
      cancelHref={detailHref}
      initialTrip={trip}
      onSubmit={handleSubmit}
      onReload={() => void handleReload()}
    />
  );
}
