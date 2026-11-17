"use client";

import type { ItineraryItem, Trip, UpdateTripRequest } from "@roamlog/contracts";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  PageGlow,
  Select,
  Skeleton,
  Textarea,
} from "@roamlog/ui";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  Circle,
  MapPin,
  NotebookPen,
  Pencil,
  Route,
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { ConflictDialog } from "@/components/app-shell/conflict-dialog";
import { isForbidden, isVersionConflict } from "@/lib/api";
import { shortDate } from "@/lib/demo-format";
import {
  useItineraryQuery,
  useTripEntriesQuery,
  useTripQuery,
  useUpdateItineraryItemMutation,
  useUpdateTripMutation,
  useWorkspaceBySlug,
} from "@/lib/query";
import {
  coverClassForTrip,
  formatDateRange,
  getTripStatusLabel,
  getTripStatusTone,
  tripDurationDays,
} from "@/lib/trip-presentation";

type Tab = "overview" | "journal" | "itinerary";

type ConflictState =
  | { kind: "trip"; input: UpdateTripRequest }
  | { kind: "itinerary"; itemId: string; input: { version: number; done: boolean } };

export function TripDetailLive({
  workspaceSlug,
  tripId,
}: {
  workspaceSlug: string;
  tripId: string;
}) {
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const tripQuery = useTripQuery(tripId);
  const itineraryQuery = useItineraryQuery(tripId);
  const entriesQuery = useTripEntriesQuery(tripId, { limit: 100, sort: "date:desc" });
  const updateTrip = useUpdateTripMutation();
  const updateItinerary = useUpdateItineraryItemMutation();

  const [tab, setTab] = useState<Tab>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<Trip["status"]>("planning");
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  const trip = tripQuery.data;
  const itinerary = itineraryQuery.data ?? [];
  const entries = entriesQuery.data?.items ?? [];
  const canEdit = workspace ? workspace.role !== "viewer" : false;

  if (workspacesQuery.isLoading || tripQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-64 rounded-card" />
        <Skeleton className="h-14 w-full rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    );
  }

  if (!workspace || !trip || tripQuery.error) {
    return (
      <ErrorState
        title="找不到这趟旅行"
        description="旅行不存在、已归档，或当前账号没有访问权限。"
        retryAction={
          <Button asChild variant="primary">
            <Link href={`/w/${workspaceSlug}/trips`}>返回旅行库</Link>
          </Button>
        }
      />
    );
  }

  const tripIndex =
    [...trip.id].reduce((total, character) => total + character.charCodeAt(0), 0) % 4;
  const groupedItinerary = new Map<string, ItineraryItem[]>();
  itinerary.forEach((item) => {
    groupedItinerary.set(item.date, [...(groupedItinerary.get(item.date) ?? []), item]);
  });

  async function saveTrip(input: UpdateTripRequest) {
    setActionError(null);
    try {
      await updateTrip.mutateAsync({ tripId, input });
      setEditOpen(false);
    } catch (cause) {
      if (isVersionConflict(cause)) {
        setConflict({ kind: "trip", input });
      } else {
        setActionError(isForbidden(cause) ? "你的角色不能编辑这趟旅行。" : "旅行保存失败。");
      }
    }
  }

  async function submitTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trip) return;
    await saveTrip({
      version: trip.version,
      title: title.trim(),
      summary: summary.trim(),
      status,
    });
  }

  async function toggleItinerary(item: ItineraryItem) {
    setActionError(null);
    const input = { version: item.version, done: !item.done };
    try {
      await updateItinerary.mutateAsync({ itemId: item.id, input });
    } catch (cause) {
      if (isVersionConflict(cause)) {
        setConflict({ kind: "itinerary", itemId: item.id, input });
      } else {
        setActionError(isForbidden(cause) ? "你的角色不能修改行程。" : "行程更新失败。");
      }
    }
  }

  function reloadConflict() {
    if (conflict?.kind === "trip") void tripQuery.refetch();
    if (conflict?.kind === "itinerary") void itineraryQuery.refetch();
    setConflict(null);
  }

  async function overwriteConflict() {
    if (!conflict) return;
    if (conflict.kind === "trip") {
      const latest = await tripQuery.refetch();
      const version = latest.data?.version ?? tripQuery.data?.version ?? 1;
      setConflict(null);
      await saveTrip({ ...conflict.input, version });
      return;
    }
    const latest = await itineraryQuery.refetch();
    const item = latest.data?.find((candidate) => candidate.id === conflict.itemId);
    setConflict(null);
    if (item) {
      await updateItinerary.mutateAsync({
        itemId: item.id,
        input: { ...conflict.input, version: item.version },
      });
    }
  }

  return (
    <div className="relative space-y-5">
      <PageGlow accent="orange" className="opacity-35" />

      <section className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
        <div className={`trip-cover ${coverClassForTrip(tripIndex)} border-b border-hairline`}>
          <div className="flex min-h-64 flex-col justify-between p-5 sm:min-h-80 sm:p-7">
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
            <div className="mt-16 max-w-4xl">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/65">
                {trip.countryCodes.join(" · ")} / {tripDurationDays(trip.startDate, trip.endDate)} DAYS
                / VERSION {trip.version}
              </p>
              <h1 className="mt-3 font-serif text-trip-title text-ink">{trip.title}</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-white/70">{trip.summary}</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/70">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays aria-hidden="true" className="size-3.5" />
                  {formatDateRange(trip.startDate, trip.endDate)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Route aria-hidden="true" className="size-3.5" />
                  {trip.origin} → {trip.destinations.join(" → ")}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
            {workspace.role.toUpperCase()} ROLE · {entries.length} ENTRIES · {itinerary.length} ITEMS
          </p>
          {canEdit ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTitle(trip.title);
                setSummary(trip.summary);
                setStatus(trip.status);
                setEditOpen(true);
              }}
            >
              <Pencil aria-hidden="true" />
              编辑旅行
            </Button>
          ) : null}
        </div>
      </section>

      {actionError ? (
        <p
          role="alert"
          className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-xs text-accent-red"
        >
          {actionError}
        </p>
      ) : null}

      <div className="flex w-fit items-center rounded-control border border-hairline-strong bg-surface-1 p-1">
        {[
          { key: "overview", label: "概览" },
          { key: "journal", label: "日志" },
          { key: "itinerary", label: "行程" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={tab === item.key}
            onClick={() => setTab(item.key as Tab)}
            className={`inline-flex h-9 items-center rounded-[6px] px-3 text-[11px] ${
              tab === item.key ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[
            { label: "出发", value: trip.origin, hint: "起点" },
            { label: "目的地", value: trip.destinations.join(" · "), hint: "路线" },
            {
              label: "天数",
              value: `${tripDurationDays(trip.startDate, trip.endDate)} 天`,
              hint: formatDateRange(trip.startDate, trip.endDate),
            },
            {
              label: "预算",
              value:
                trip.budgetAmountMinor === null || !trip.budgetCurrency
                  ? "未设置"
                  : `${trip.budgetCurrency} ${(trip.budgetAmountMinor / 100).toFixed(0)}`,
              hint: "原币种",
            },
            { label: "可见性", value: trip.visibility, hint: "旅行可见范围" },
            { label: "最近更新", value: shortDate(trip.updatedAt.slice(0, 10)), hint: "服务端时间" },
          ].map((stat) => (
            <div key={stat.label} className="surface-card p-4">
              <p className="type-eyebrow">{stat.label}</p>
              <p className="mt-2 font-serif text-2xl tracking-[-0.02em] text-ink">{stat.value}</p>
              <p className="mt-1 text-[10px] text-muted">{stat.hint}</p>
            </div>
          ))}
        </div>
      ) : null}

      {tab === "journal" ? (
        entries.length === 0 ? (
          <EmptyState
            title="这趟旅行还没有日志"
            description="前往日志页写下第一段记录，或等待同行者更新。"
            action={
              <Button asChild variant="outline">
                <Link href={`/w/${workspaceSlug}/journal`}>
                  <NotebookPen aria-hidden="true" />
                  打开日志
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="surface-card divide-y divide-hairline overflow-hidden">
            {entries.map((entry) => (
              <article key={entry.id} className="grid gap-3 p-4 sm:grid-cols-[140px_minmax(0,1fr)]">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
                    {shortDate(entry.date)}
                  </p>
                  <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted">
                    <MapPin aria-hidden="true" className="size-3" />
                    {entry.location}
                  </p>
                </div>
                <div>
                  <h2 className="font-serif text-xl leading-tight text-ink">{entry.title}</h2>
                  <p className="mt-1.5 text-xs leading-5 text-muted">{entry.excerpt}</p>
                </div>
              </article>
            ))}
          </div>
        )
      ) : null}

      {tab === "itinerary" ? (
        itinerary.length === 0 ? (
          <EmptyState title="还没有行程项" description="行程会按日期出现在这里。" />
        ) : (
          <div className="space-y-5">
            {[...groupedItinerary.entries()].map(([date, items]) => (
              <section key={date} className="surface-card overflow-hidden">
                <div className="border-b border-hairline px-4 py-3">
                  <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">
                    {shortDate(date)}
                  </h2>
                </div>
                <div className="divide-y divide-hairline">
                  {items
                    .sort((left, right) => left.order - right.order)
                    .map((item) => (
                      <div key={item.id} className="flex items-start gap-3 px-4 py-3.5">
                        <button
                          type="button"
                          aria-label={item.done ? "标记为未完成" : "标记为完成"}
                          aria-pressed={item.done}
                          disabled={!canEdit || updateItinerary.isPending}
                          onClick={() => void toggleItinerary(item)}
                          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-pill border border-hairline text-muted disabled:opacity-40"
                        >
                          {item.done ? (
                            <Check aria-hidden="true" className="size-3.5 text-accent-green" />
                          ) : (
                            <Circle aria-hidden="true" className="size-3.5" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p
                            className={`text-[13px] leading-5 ${
                              item.done ? "text-stone line-through" : "text-ink"
                            }`}
                          >
                            {item.title}
                          </p>
                          <p className="mt-1 text-[11px] text-muted">{item.location}</p>
                        </div>
                        <span className="font-mono text-[9px] text-stone">
                          {item.startTime ?? "—"}
                        </span>
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </div>
        )
      ) : null}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <form onSubmit={(event) => void submitTrip(event)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>编辑旅行</DialogTitle>
              <DialogDescription>
                保存时会带上 version。若有人先保存，会出现 409 冲突提示。
              </DialogDescription>
            </DialogHeader>
            <FormField label="标题">
              <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
            </FormField>
            <FormField label="摘要">
              <Textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                rows={4}
                maxLength={1000}
              />
            </FormField>
            <FormField label="状态">
              <Select value={status} onChange={(event) => setStatus(event.target.value as Trip["status"])}>
                <option value="wishlist">愿望</option>
                <option value="planning">计划中</option>
                <option value="upcoming">即将出发</option>
                <option value="active">在途中</option>
                <option value="completed">已归来</option>
                <option value="archived">已归档</option>
              </Select>
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={updateTrip.isPending}>
                保存旅行
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConflictDialog
        open={Boolean(conflict)}
        onOpenChange={(open) => {
          if (!open) setConflict(null);
        }}
        entityLabel={conflict?.kind === "trip" ? "这趟旅行" : "行程项"}
        onReload={reloadConflict}
        onOverwrite={() => void overwriteConflict()}
        pending={updateTrip.isPending || updateItinerary.isPending}
      />
    </div>
  );
}
