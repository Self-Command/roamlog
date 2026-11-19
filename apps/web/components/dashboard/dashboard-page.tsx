"use client";

import type { Trip } from "@roamlog/contracts";
import {
  AvatarGroup,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageGlow,
  PageHeader,
  Progress,
  Skeleton,
} from "@roamlog/ui";
import { CalendarDays, ChevronRight, MapPin, Route, Sparkles } from "lucide-react";
import Link from "next/link";

import { useItineraryQuery, useMeQuery, useTripsQuery, useWorkspaceBySlug } from "@/lib/query";
import {
  daysUntil,
  formatBudget,
  formatDateRange,
  formatLongDate,
  getNextTrip,
  getTripStatusLabel,
  getTripStatusTone,
  toCalendarDate,
  tripDurationDays,
} from "@/lib/trip-presentation";

import { DashboardRecent } from "./dashboard-recent";

interface DashboardPageProps {
  workspaceSlug: string;
}

function journeyProgress(trip: Trip): number {
  const totalDays = tripDurationDays(trip.startDate, trip.endDate);
  const today = new Date();
  const start = toCalendarDate(trip.startDate);
  const elapsed = Math.floor(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
      86_400_000,
  );
  return Math.min(100, Math.max(0, ((elapsed + 1) / totalDays) * 100));
}

function DashboardLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-12 w-56" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-64 rounded-card lg:col-span-2" />
        <Skeleton className="h-64 rounded-card" />
        <Skeleton className="h-64 rounded-card lg:col-span-3" />
      </div>
    </div>
  );
}

export function DashboardPage({ workspaceSlug }: DashboardPageProps) {
  const meQuery = useMeQuery();
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const tripsQuery = useTripsQuery(workspace?.id);
  const trips = tripsQuery.data?.items ?? [];
  const nextTrip = getNextTrip(trips);
  const nextCoverUrl = nextTrip?.cover?.url ?? nextTrip?.cover?.thumbUrl ?? null;
  const itineraryQuery = useItineraryQuery(nextTrip?.id);
  const currentUserName = meQuery.data?.name ?? "—";

  if (workspacesQuery.isLoading || tripsQuery.isLoading) {
    return <DashboardLoading />;
  }

  if (!workspace || !tripsQuery.data) {
    return (
      <ErrorState
        title="总览暂时不可用"
        description="Workspace 或旅行数据没有返回。请检查网络与 API 状态后重试。"
        retryAction={
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              void workspacesQuery.refetch();
              void tripsQuery.refetch();
            }}
          >
            重新加载
          </Button>
        }
      />
    );
  }

  const countries = new Set(trips.flatMap((trip) => trip.countryCodes));
  const cities = new Set(trips.flatMap((trip) => trip.destinations));
  const travelDays = trips.reduce(
    (total, trip) => total + tripDurationDays(trip.startDate, trip.endDate),
    0,
  );
  const liveItinerary = [...(itineraryQuery.data ?? [])]
    .filter((item) => !item.done)
    .sort((left, right) =>
      `${left.date}${left.startTime ?? ""}`.localeCompare(`${right.date}${right.startTime ?? ""}`),
    )
    .slice(0, 3);

  return (
    <div className="relative">
      <PageGlow accent="orange" className="opacity-50" />

      <PageHeader
        eyebrow={`${workspace.name.toUpperCase()} / OVERVIEW`}
        title="旅行总览"
        description={`${trips.length} 趟旅行，${countries.size} 个国家，${cities.size} 个城市。下一段行程、预算和最近整理的旅行都在这里。`}
        actions={
          <Button asChild variant="primary" size="md">
            <Link href={`/w/${workspaceSlug}/trips/new`}>
              <Sparkles aria-hidden="true" />
              新建旅行
            </Link>
          </Button>
        }
      />

      <section
        aria-label="旅行统计"
        className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-hairline-strong bg-hairline-strong lg:grid-cols-4"
      >
        {[
          ["旅行", trips.length.toString(), "TOTAL JOURNEYS"],
          ["国家", countries.size.toString(), "COUNTRIES VISITED"],
          ["城市", cities.size.toString(), "STOPS COLLECTED"],
          ["在册天数", travelDays.toString(), "DAYS ON THE ROAD"],
        ].map(([label, value, meta]) => (
          <div key={label} className="bg-surface-1 p-4">
            <p className="type-eyebrow">{meta}</p>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="font-serif text-3xl leading-none tracking-[-0.03em] text-ink">
                {value}
              </span>
              <span className="text-xs text-muted">{label}</span>
            </div>
          </div>
        ))}
      </section>

      {nextTrip ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]">
          <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
            <div
              className={`relative aspect-[16/7] overflow-hidden border-b border-hairline ${
                nextCoverUrl ? "bg-surface-deep" : "bg-surface-2"
              }`}
            >
              {nextCoverUrl ? (
                <img src={nextCoverUrl} alt="" className="size-full object-cover" loading="lazy" />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
              <div className="relative flex h-full flex-col justify-between p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={getTripStatusTone(nextTrip.status)}>
                    {getTripStatusLabel(nextTrip.status)}
                  </Badge>
                  <Badge tone="neutral">
                    {nextTrip.status === "active"
                      ? `第 ${Math.max(1, Math.min(tripDurationDays(nextTrip.startDate, nextTrip.endDate), tripDurationDays(nextTrip.startDate, nextTrip.endDate) - Math.max(0, daysUntil(nextTrip.endDate))))} 天`
                      : daysUntil(nextTrip.startDate) > 0
                        ? `${daysUntil(nextTrip.startDate)} 天后出发`
                        : "即将出发"}
                  </Badge>
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-white/60">
                    NEXT JOURNEY
                  </p>
                  <h2 className="mt-2 max-w-xl font-serif text-trip-title text-ink">
                    {nextTrip.title}
                  </h2>
                </div>
              </div>
            </div>
            <div className="p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-xs text-muted">
                    <CalendarDays aria-hidden="true" className="size-3.5" />
                    {formatDateRange(nextTrip.startDate, nextTrip.endDate)}
                    <span aria-hidden="true" className="text-stone">
                      ·
                    </span>
                    {tripDurationDays(nextTrip.startDate, nextTrip.endDate)} 天
                  </p>
                  <p className="mt-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-body">
                    <Route aria-hidden="true" className="size-3.5 text-muted" />
                    {nextTrip.origin}
                    {nextTrip.destinations.length > 0
                      ? ` → ${nextTrip.destinations.join(" → ")}`
                      : ""}
                  </p>
                </div>
                <Button asChild variant="outline" size="md">
                  <Link href={`/w/${workspaceSlug}/trips/${nextTrip.id}`}>
                    查看旅行
                    <ChevronRight aria-hidden="true" />
                  </Link>
                </Button>
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">{nextTrip.summary}</p>
              <div className="mt-5 grid gap-4 border-t border-hairline pt-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <div className="mb-2 flex items-center justify-between text-[10px] text-muted">
                    <span>旅程进度</span>
                    <span>{Math.round(journeyProgress(nextTrip))}%</span>
                  </div>
                  <Progress value={journeyProgress(nextTrip)} aria-label="旅程进度" />
                </div>
                <div className="flex items-center justify-between gap-6 sm:justify-end">
                  <div>
                    <p className="type-eyebrow">BUDGET</p>
                    <p className="mt-1 text-sm text-ink">
                      {nextTrip.budgetAmountMinor !== null && nextTrip.budgetCurrency !== null
                        ? formatBudget(nextTrip.budgetAmountMinor, nextTrip.budgetCurrency)
                        : "—"}
                    </p>
                  </div>
                  <AvatarGroup
                    members={[
                      { id: "owner", name: currentUserName },
                      ...nextTrip.guestNames.map((name, index) => ({
                        id: `next-guest-${index}`,
                        name,
                      })),
                    ]}
                    max={4}
                    size={28}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-card border border-hairline-strong bg-surface-1 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="type-eyebrow">UP NEXT</p>
                <h2 className="mt-2 font-serif text-2xl tracking-[-0.025em] text-ink">接下来</h2>
              </div>
              {nextTrip.countryCodes.length > 0 ? (
                <Badge tone="orange">{nextTrip.countryCodes.join(" · ")}</Badge>
              ) : null}
            </div>

            <div className="mt-5 space-y-3">
              {itineraryQuery.isLoading ? (
                <>
                  <Skeleton className="h-16 rounded-card" />
                  <Skeleton className="h-16 rounded-card" />
                  <Skeleton className="h-16 rounded-card" />
                </>
              ) : liveItinerary.length > 0 ? (
                liveItinerary.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 rounded-card border border-hairline bg-surface-2 p-3"
                  >
                    <div className="w-10 shrink-0 font-mono text-[10px] text-muted">
                      {item.startTime ?? "--:--"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{item.title}</p>
                      <p className="mt-1 flex items-center gap-1 truncate text-[10px] text-muted">
                        <MapPin aria-hidden="true" className="size-3 shrink-0" />
                        {formatLongDate(item.date)} · {item.location}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="行程尚未排定"
                  description="这趟旅行还没有可展示的下一项行程。"
                  className="px-4 py-8"
                />
              )}
            </div>
          </section>
        </div>
      ) : (
        <EmptyState
          className="mt-4"
          title="还没有旅行"
          description="创建第一趟旅行后，总览会显示下一段行程、预算和最近更新。"
          action={
            <Button asChild variant="outline">
              <Link href={`/w/${workspaceSlug}/trips/new`}>新建旅行</Link>
            </Button>
          }
        />
      )}

      {trips.length > 0 ? (
        <DashboardRecent
          trips={trips}
          workspaceSlug={workspaceSlug}
          currency={workspace.defaultCurrency}
        />
      ) : null}
    </div>
  );
}
