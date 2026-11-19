"use client";

import type { Trip, TripStatus } from "@roamlog/contracts";
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  PageGlow,
  PageHeader,
  Select,
  Skeleton,
} from "@roamlog/ui";
import { Plus, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";

import { useMeQuery, useTripsQuery, useWorkspaceBySlug } from "@/lib/query";

import { TripCard } from "./trip-card";

type StatusFilter = "all" | TripStatus;
type SortMode = "updated" | "start" | "title";

const statusTabs: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "wishlist", label: "愿望" },
  { value: "planning", label: "计划中" },
  { value: "upcoming", label: "即将出发" },
  { value: "active", label: "在途中" },
  { value: "completed", label: "已归来" },
];

function countForStatus(trips: Trip[], status: StatusFilter): number {
  return status === "all" ? trips.length : trips.filter((trip) => trip.status === status).length;
}

function sortTrips(trips: Trip[], sortMode: SortMode): Trip[] {
  return [...trips].sort((left, right) => {
    if (sortMode === "title") return left.title.localeCompare(right.title, "zh-CN");
    if (sortMode === "start") return left.startDate.localeCompare(right.startDate);
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

interface TripsLibraryProps {
  workspaceSlug: string;
}

export function TripsLibrary({ workspaceSlug }: TripsLibraryProps) {
  const meQuery = useMeQuery();
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const tripsQuery = useTripsQuery(workspace?.id, { limit: 100 });
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase("zh-CN"));
  const trips = tripsQuery.data?.items ?? [];
  const ownerName = meQuery.data?.name ?? "—";

  if (workspacesQuery.isLoading || tripsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-12 w-full rounded-control" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-80 rounded-card" />
          ))}
        </div>
      </div>
    );
  }

  if (!workspace || !tripsQuery.data) {
    return (
      <ErrorState
        title="旅行库暂时不可用"
        description="Workspace 或旅行列表没有返回。请检查网络与 API 状态后重试。"
        retryAction={
          <Button type="button" variant="primary" onClick={() => void tripsQuery.refetch()}>
            重新加载
          </Button>
        }
      />
    );
  }

  const filteredTrips = sortTrips(
    trips.filter((trip) => {
      if (status !== "all" && trip.status !== status) return false;
      if (!deferredSearch) return true;

      const haystack =
        `${trip.title} ${trip.summary} ${trip.destinations.join(" ")} ${trip.tags.join(" ")}`.toLocaleLowerCase(
          "zh-CN",
        );
      return haystack.includes(deferredSearch);
    }),
    sortMode,
  );
  const filtersActive = status !== "all" || search.trim().length > 0;

  function clearFilters() {
    setStatus("all");
    setSearch("");
  }

  return (
    <div className="relative">
      <PageGlow accent="blue" className="opacity-35" />
      <PageHeader
        eyebrow={`${workspace.name.toUpperCase()} / TRIP LIBRARY`}
        title="旅行库"
        description={`按状态、地点和标签整理 ${trips.length} 趟真实旅行。卡片只展示旅行自身已保存的封面、预算与天数。`}
        actions={
          <Button asChild variant="primary">
            <Link href={`/w/${workspaceSlug}/trips/new`}>
              <Plus aria-hidden="true" />
              新建旅行
            </Link>
          </Button>
        }
      />

      <section className="mt-8 rounded-card border border-hairline-strong bg-surface-1 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="trip-search" className="sr-only">
              搜索旅行
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            />
            <Input
              id="trip-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索标题、城市、标签…"
              className="pl-9"
            />
            {search ? (
              <button
                type="button"
                aria-label="清除搜索"
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-pill text-muted outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <SlidersHorizontal aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
            <label htmlFor="trip-sort" className="sr-only">
              旅行排序
            </label>
            <Select
              id="trip-sort"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="min-w-36"
            >
              <option value="updated">最近更新</option>
              <option value="start">出发日期</option>
              <option value="title">标题</option>
            </Select>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto border-t border-hairline pt-3">
          <div role="group" aria-label="按旅行状态筛选" className="flex w-max gap-1">
            {statusTabs.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={status === tab.value}
                onClick={() => setStatus(tab.value)}
                className="inline-flex h-9 items-center gap-1.5 rounded-control border border-transparent px-3 text-xs text-muted outline-none transition-colors hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink aria-[pressed=true]:border-hairline-strong aria-[pressed=true]:bg-surface-2 aria-[pressed=true]:text-ink"
              >
                  {tab.label}
                  <span className="font-mono text-[9px] text-stone">
                    {countForStatus(trips, tab.value)}
                  </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
          SHOWING {filteredTrips.length} OF {trips.length}
          {tripsQuery.data?.hasMore ? " · 前 100 趟" : ""}
        </p>
        {filtersActive ? (
          <Button type="button" variant="link" size="sm" onClick={clearFilters}>
            清除筛选
          </Button>
        ) : null}
      </div>

      {filteredTrips.length > 0 ? (
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredTrips.map((trip, index) => (
            <TripCard
              key={trip.id}
              trip={trip}
              workspaceSlug={workspaceSlug}
              index={index}
              ownerName={ownerName}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          className="mt-3"
          icon={Search}
          title={filtersActive ? "没有匹配的旅行" : "旅行库还是空的"}
          description={
            filtersActive
              ? "换一个关键词或清除状态筛选，查看全部旅行。"
              : "创建第一趟旅行后，它会在这里按状态、日期和参与者整理。"
          }
          action={
            filtersActive ? (
              <Button type="button" variant="outline" onClick={clearFilters}>
                清除筛选
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href={`/w/${workspaceSlug}/trips/new`}>新建旅行</Link>
              </Button>
            )
          }
        />
      )}
    </div>
  );
}
