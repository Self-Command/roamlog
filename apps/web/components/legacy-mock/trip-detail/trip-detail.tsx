"use client";

import type { Trip } from "@roamlog/contracts";
import {
  AvatarGroup,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  FormField,
  Input,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@roamlog/ui";
import { ArrowLeft, CalendarDays, NotebookPen, Pencil, Route } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useDemoStore } from "@/lib/demo-store";
import {
  coverClassForTrip,
  formatDateRange,
  getTripStatusLabel,
  getTripStatusTone,
  tripDurationDays,
} from "@/lib/trip-presentation";

import { TripActivityTab } from "./activity-tab";
import { BudgetTab } from "./budget-tab";
import { ItineraryTab } from "./itinerary-tab";
import { TripJournalTab } from "./journal-tab";
import { TripOverviewTab } from "./overview-tab";
import { PackingTab } from "./packing-tab";
import { PhotosTab } from "./photos-tab";
import { TripMapTab } from "./trip-map-tab";

interface TripDetailProps {
  workspaceSlug: string;
  tripId: string;
}

export function TripDetail({ workspaceSlug, tripId }: TripDetailProps) {
  const { state, currentRole, currentUser, updateTrip } = useDemoStore();
  const [tab, setTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editStatus, setEditStatus] = useState<Trip["status"]>("planning");
  const [editFavorite, setEditFavorite] = useState(false);
  const trip = state.trips.find((candidate) => candidate.id === tripId);

  if (!trip) {
    return (
      <ErrorState
        title="找不到这趟旅行"
        description="旅行不存在、已归档，或本地 fixture 没有返回对应数据。"
        retryAction={
          <Button asChild variant="primary">
            <Link href={`/w/${workspaceSlug}/trips`}>返回旅行库</Link>
          </Button>
        }
      />
    );
  }

  const participants = [
    {
      id: currentUser.id,
      name: currentUser.name,
      online: true,
    },
    ...state.members
      .filter((member) => member.userId !== currentUser.id)
      .map((member, index) => ({
        id: member.userId,
        name: member.user.name,
        online: index < 2,
      })),
  ];
  const tripIndex = Math.max(
    0,
    state.trips.findIndex((candidate) => candidate.id === trip.id),
  );

  return (
    <div className="space-y-5">
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
                {trip.countryCodes.join(" · ")} /{" "}
                {tripDurationDays(trip.startDate, trip.endDate)} DAYS / VERSION {trip.version}
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

        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex flex-wrap items-center gap-4">
            <AvatarGroup members={participants} max={4} size={30} />
            <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
              {participants.filter((participant) => participant.online).length} ONLINE ·{" "}
              {currentRole.toUpperCase()} ROLE
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditTitle(trip.title);
                setEditSummary(trip.summary);
                setEditStatus(trip.status);
                setEditFavorite(trip.favorite);
                setEditOpen(true);
              }}
            >
              <Pencil aria-hidden="true" />
              编辑旅行
            </Button>
            <Button type="button" variant="primary" onClick={() => setTab("journal")}>
              <NotebookPen aria-hidden="true" />
              写日志
            </Button>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {trip.tags.map((tag) => (
          <Badge key={tag} tone="neutral">
            {tag}
          </Badge>
        ))}
        {trip.favorite ? <Badge tone="yellow">FAVORITE</Badge> : null}
        <Badge tone="slate">SEED DATA + LOCAL STATE</Badge>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="w-max">
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="journal">日志</TabsTrigger>
            <TabsTrigger value="itinerary">行程</TabsTrigger>
            <TabsTrigger value="photos">相册</TabsTrigger>
            <TabsTrigger value="map">地图</TabsTrigger>
            <TabsTrigger value="budget">预算</TabsTrigger>
            <TabsTrigger value="packing">打包</TabsTrigger>
            <TabsTrigger value="activity">活动</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview">
          <TripOverviewTab trip={trip} />
        </TabsContent>
        <TabsContent value="journal">
          <TripJournalTab tripId={trip.id} role={currentRole} />
        </TabsContent>
        <TabsContent value="itinerary">
          <ItineraryTab tripId={trip.id} role={currentRole} />
        </TabsContent>
        <TabsContent value="photos">
          <PhotosTab tripId={trip.id} role={currentRole} />
        </TabsContent>
        <TabsContent value="map">
          <TripMapTab tripId={trip.id} />
        </TabsContent>
        <TabsContent value="budget">
          <BudgetTab
            tripId={trip.id}
            currency={trip.budgetCurrency ?? "CNY"}
            role={currentRole}
          />
        </TabsContent>
        <TabsContent value="packing">
          <PackingTab tripId={trip.id} role={currentRole} />
        </TabsContent>
        <TabsContent value="activity">
          <TripActivityTab tripId={trip.id} />
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <p className="type-eyebrow">EDIT TRIP</p>
            <DialogTitle>编辑旅行</DialogTitle>
            <DialogDescription>
              标题、摘要、状态与收藏会立即写入本地状态。日期、停靠点和可见性留待完整表单。
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!editTitle.trim()) return;
              updateTrip(
                trip.id,
                {
                  title: editTitle.trim(),
                  summary: editSummary.trim(),
                  status: editStatus,
                  favorite: editFavorite,
                },
                currentRole,
              );
              setEditOpen(false);
            }}
          >
            <FormField label="旅行标题">
              <Input
                required
                value={editTitle}
                onChange={(event) => setEditTitle(event.target.value)}
              />
            </FormField>
            <FormField label="摘要">
              <Textarea
                value={editSummary}
                onChange={(event) => setEditSummary(event.target.value)}
              />
            </FormField>
            <FormField label="状态">
              <Select
                value={editStatus}
                onChange={(event) => setEditStatus(event.target.value as Trip["status"])}
              >
                <option value="wishlist">愿望</option>
                <option value="planning">计划中</option>
                <option value="upcoming">即将出发</option>
                <option value="active">在途中</option>
                <option value="completed">已归来</option>
              </Select>
            </FormField>
            <label className="flex items-center gap-2 text-xs text-body">
              <input
                type="checkbox"
                checked={editFavorite}
                onChange={(event) => setEditFavorite(event.target.checked)}
                className="size-4 accent-white"
              />
              收藏这趟旅行
            </label>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="outline">
                保存修改
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
