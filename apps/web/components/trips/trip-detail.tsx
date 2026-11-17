"use client";

import type { Trip } from "@roamlog/contracts";
import {
  AvatarGroup,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@roamlog/ui";
import { ArrowLeft, CalendarDays, NotebookPen, Route } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  useItineraryQuery,
  useMeQuery,
  useTripQuery,
  useTripsQuery,
  useWorkspaceBySlug,
} from "@/lib/query";
import {
  coverClassForTrip,
  formatBudget,
  formatDateRange,
  getTripStatusLabel,
  getTripStatusTone,
  tripDurationDays,
} from "@/lib/trip-presentation";

import { DetailLoading, ItineraryList } from "./trip-detail-parts";
import { TripDetailOverview } from "./trip-detail-overview";

interface TripDetailProps {
  workspaceSlug: string;
  tripId: string;
}

export function TripDetail({ workspaceSlug, tripId }: TripDetailProps) {
  const meQuery = useMeQuery();
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const tripsQuery = useTripsQuery(workspace?.id);
  const tripQuery = useTripQuery(tripId);
  const itineraryQuery = useItineraryQuery(tripId);
  const [writeNotice, setWriteNotice] = useState<string | null>(null);
  const trips = tripsQuery.data?.items ?? [];
  const currentUserName = meQuery.data?.name ?? "创建者";

  if (workspacesQuery.isLoading || tripsQuery.isLoading || tripQuery.isLoading) {
    return <DetailLoading />;
  }

  if (!tripQuery.data) {
    return (
      <ErrorState
        title="找不到这趟旅行"
        description="旅行不存在、已归档，或 mock 边界没有返回对应数据。"
        retryAction={
          <Button type="button" variant="primary" onClick={() => void tripQuery.refetch()}>
            重新加载
          </Button>
        }
      />
    );
  }

  const trip: Trip = tripQuery.data;
  const tripIndex = Math.max(
    0,
    trips.findIndex((candidate) => candidate.id === trip.id),
  );
  const participants = [
    { id: "owner", name: currentUserName, online: true },
    ...trip.guestNames.map((name, index) => ({
      id: `detail-guest-${index}`,
      name,
      online: index === 0,
    })),
  ];

  return (
    <div>
      <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
        <div
          className={`trip-cover ${coverClassForTrip(tripIndex)} min-h-52 border-b border-hairline`}
        >
          <div className="flex min-h-52 flex-col justify-between p-5 sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <Button asChild variant="outline" size="sm" className="bg-black/30 backdrop-blur-sm">
                <Link href={`/w/${workspaceSlug}/trips`}>
                  <ArrowLeft aria-hidden="true" />
                  旅行库
                </Link>
              </Button>
              <div className="flex flex-wrap justify-end gap-2">
                <Badge tone={getTripStatusTone(trip.status)}>
                  {getTripStatusLabel(trip.status)}
                </Badge>
                <Badge tone="neutral">{trip.visibility}</Badge>
              </div>
            </div>
            <div className="mt-12 max-w-3xl">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/65">
                {trip.countryCodes.join(" · ")} / {tripDurationDays(trip.startDate, trip.endDate)}{" "}
                DAYS
              </p>
              <h1 className="mt-3 font-serif text-trip-title text-ink">{trip.title}</h1>
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays aria-hidden="true" className="size-3.5" />
                  {formatDateRange(trip.startDate, trip.endDate)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Route aria-hidden="true" className="size-3.5" />
                  {trip.origin} → {trip.destinations.join(" → ")}
                </span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <AvatarGroup members={participants} max={4} size={30} />
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
              {participants.filter((participant) => participant.online).length} ONLINE · VERSION{" "}
              {trip.version}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="ghost">
              <Link href={`/w/${workspaceSlug}/trips`}>浏览全部旅行</Link>
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => setWriteNotice("日志编辑器将在 Wave 1 的内容写入链路中接入。")}
            >
              <NotebookPen aria-hidden="true" />
              写日志
            </Button>
          </div>
        </div>
      </section>

      {writeNotice ? (
        <p
          role="status"
          className="mt-3 rounded-control border border-hairline-strong bg-surface-1 px-3 py-2.5 text-xs text-body"
        >
          {writeNotice}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {trip.tags.map((tag) => (
          <Badge key={tag} tone="neutral">
            {tag}
          </Badge>
        ))}
        <Badge tone={trip.favorite ? "yellow" : "slate"}>
          {trip.favorite ? "FAVORITE" : "NOT FAVORED"}
        </Badge>
        <Badge tone="slate">LOCAL FIXTURE</Badge>
      </div>

      <Tabs defaultValue="overview" className="mt-6">
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="journal">日志</TabsTrigger>
            <TabsTrigger value="itinerary">行程</TabsTrigger>
            <TabsTrigger value="budget">预算</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4">
          <TripDetailOverview
            trip={trip}
            itinerary={itineraryQuery.data ?? []}
            itineraryLoading={itineraryQuery.isLoading}
          />
        </TabsContent>

        <TabsContent value="journal" className="mt-4">
          <EmptyState
            icon={NotebookPen}
            title="日志列表等待 API 接入"
            description="当前任务只提供 Trip shell。日志编辑器、照片和评论将在 Wave 1 内容链路中实现。"
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => setWriteNotice("日志写入尚未启用。")}
              >
                查看占位行为
              </Button>
            }
          />
        </TabsContent>

        <TabsContent value="itinerary" className="mt-4">
          <section className="rounded-card border border-hairline-strong bg-surface-1 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="type-eyebrow">ITINERARY</p>
                <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink">
                  按日期整理
                </h2>
              </div>
              <Badge tone="blue">READ-ONLY FIXTURES</Badge>
            </div>
            <div className="mt-4">
              {itineraryQuery.isLoading ? (
                <Skeleton className="h-40 rounded-card" />
              ) : (
                <ItineraryList items={itineraryQuery.data ?? []} />
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="budget" className="mt-4">
          <section className="grid gap-4 rounded-card border border-hairline-strong bg-surface-1 p-5 md:grid-cols-[1fr_2fr]">
            <div>
              <p className="type-eyebrow">TRIP BUDGET</p>
              <p className="mt-3 font-serif text-4xl tracking-[-0.035em] text-ink">
                {formatBudget(trip.budgetAmountMinor, trip.budgetCurrency)}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted">按旅行设置币种显示。</p>
            </div>
            <EmptyState
              title="还没有可计算的花费"
              description="真实预算页需要花费表、分类汇总与分账数据。当前没有模拟“已花金额”，避免伪造进度。"
              className="px-5 py-8"
            />
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
