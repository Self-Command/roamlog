"use client";

import { Avatar, Badge } from "@roamlog/ui";
import { Activity, ArrowUpRight, MessageCircle, ReceiptText, Route, Upload } from "lucide-react";
import { useMemo } from "react";

import { useDemoStore } from "@/lib/demo-store";
import { shortDate } from "@/lib/demo-format";

const verbLabels: Record<string, string> = {
  commented: "留下评论",
  completed_itinerary: "完成行程",
  expensed: "记录花费",
  created_entry: "写下日志",
  uploaded_media: "上传照片",
  updated_packing: "更新打包",
  invited_member: "邀请成员",
  updated_trip: "更新旅行",
  favorited_entry: "收藏日志",
  created_itinerary: "新增行程",
  created_trip: "创建旅行",
};

const verbIcons = {
  commented: MessageCircle,
  expensed: ReceiptText,
  uploaded_media: Upload,
  default: Route,
};

export function TripActivityTab({ tripId }: { tripId: string }) {
  const { state } = useDemoStore();
  const activities = useMemo(
    () =>
      state.activities
        .filter((activity) => activity.tripId === tripId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [state.activities, tripId],
  );

  return (
    <section className="surface-card overflow-hidden">
      <div className="border-b border-hairline p-5">
        <p className="type-eyebrow">TRIP ACTIVITY / {activities.length}</p>
        <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink">这趟旅行发生了什么</h2>
        <p className="mt-2 text-xs leading-5 text-muted">
          业务事件按时间排序；真实 workspace / trip 房间和缓存失效尚未接入。
        </p>
      </div>
      <div className="divide-y divide-hairline">
        {activities.map((activity) => {
          const actor = state.members.find((member) => member.userId === activity.actorId)?.user;
          const Icon =
            verbIcons[activity.verb as keyof typeof verbIcons] ?? verbIcons.default;
          const title =
            typeof activity.metadata.title === "string"
              ? activity.metadata.title
              : typeof activity.metadata.note === "string"
                ? activity.metadata.note
                : activity.entityType;
          return (
            <div key={activity.id} className="flex items-start gap-3 p-4">
              <Avatar name={actor?.name ?? "系统"} size={32} />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] leading-5 text-body">
                  <span className="font-medium text-ink">{actor?.name ?? "Roamlog"}</span>{" "}
                  {verbLabels[activity.verb] ?? activity.verb} ·{" "}
                  <span className="text-muted">{title}</span>
                </p>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                  {shortDate(activity.createdAt.slice(0, 10))} · VERSION {String(activity.id).slice(-2)}
                </p>
              </div>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface-2 text-muted">
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
            </div>
          );
        })}
      </div>
      {!activities.length ? (
        <div className="px-6 py-14 text-center">
          <Activity aria-hidden="true" className="mx-auto size-5 text-stone" />
          <h3 className="mt-3 font-serif text-2xl text-ink">还没有活动</h3>
          <p className="mt-2 text-sm text-muted">创建日志、行程或花费后会出现在这里。</p>
        </div>
      ) : (
        <div className="flex items-center justify-between border-t border-hairline px-4 py-3">
          <Badge tone="neutral">LOCAL EVENT STREAM</Badge>
          <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase text-stone">
            Socket.IO 未连接
            <ArrowUpRight aria-hidden="true" className="size-3" />
          </span>
        </div>
      )}
    </section>
  );
}
