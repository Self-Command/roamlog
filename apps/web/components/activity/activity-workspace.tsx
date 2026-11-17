"use client";

import {
  Avatar,
  Badge,
  Button,
  PageHeader,
  Select,
} from "@roamlog/ui";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  MapPinned,
  MessageCircle,
  ReceiptText,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useDemoStore } from "@/lib/demo-store";
import { shortDate } from "@/lib/demo-format";

const verbLabels: Record<string, string> = {
  commented: "留下评论",
  completed_itinerary: "完成行程",
  expensed: "记录花费",
  created_entry: "写下日志",
  uploaded_media: "上传照片",
  updated_packing: "更新打包清单",
  invited_member: "邀请成员",
  updated_trip: "更新旅行",
  favorited_entry: "收藏日志",
  created_itinerary: "新增行程",
  created_trip: "创建旅行",
};

function iconFor(verb: string) {
  if (verb === "commented") return MessageCircle;
  if (verb === "expensed") return ReceiptText;
  if (verb === "uploaded_media") return Upload;
  if (verb === "created_entry" || verb === "favorited_entry") return BookOpen;
  return MapPinned;
}

export function ActivityWorkspace() {
  const { state } = useDemoStore();
  const [scope, setScope] = useState("workspace");
  const [visibleCount, setVisibleCount] = useState(8);
  const activities = useMemo(
    () =>
      state.activities
        .filter(
          (activity) =>
            scope === "workspace" || String(activity.tripId) === scope,
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [scope, state.activities],
  );
  const groups = useMemo(() => {
    const map = new Map<string, typeof activities>();
    activities.slice(0, visibleCount).forEach((activity) => {
      const day = activity.createdAt.slice(0, 10);
      map.set(day, [...(map.get(day) ?? []), activity]);
    });
    return [...map.entries()];
  }, [activities, visibleCount]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`ACTIVITY / ${state.activities.length} EVENTS`}
        title="活动流"
        description="按天查看谁创建、修改、评论或上传了什么。当前事件来自本地 fixture，实时房间尚未连接。"
        actions={
          <Select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            aria-label="筛选活动范围"
            className="w-56"
          >
            <option value="workspace">整个 Workspace</option>
            {state.trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.title}
              </option>
            ))}
          </Select>
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-6">
          {groups.map(([day, items]) => (
            <section key={day} aria-label={`${day} 的活动`}>
              <div className="mb-2 flex items-center gap-3 px-1">
                <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">
                  {shortDate(day)}
                </h2>
                <span className="font-mono text-[9px] text-stone">{items.length}</span>
                <div className="h-px flex-1 bg-hairline" />
              </div>
              <div className="surface-card overflow-hidden divide-y divide-hairline">
                {items.map((activity) => {
                  const actor = state.members.find(
                    (member) => member.userId === activity.actorId,
                  )?.user;
                  const trip = state.trips.find((candidate) => candidate.id === activity.tripId);
                  const Icon = iconFor(activity.verb);
                  const title =
                    typeof activity.metadata.title === "string"
                      ? activity.metadata.title
                      : typeof activity.metadata.note === "string"
                        ? activity.metadata.note
                        : typeof activity.metadata.email === "string"
                          ? activity.metadata.email
                          : activity.entityType;
                  return (
                    <article
                      key={activity.id}
                      className="flex items-start gap-3 px-4 py-4"
                    >
                      <Avatar name={actor?.name ?? "系统"} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-5 text-body">
                          <span className="font-medium text-ink">{actor?.name ?? "Roamlog"}</span>{" "}
                          {verbLabels[activity.verb] ?? activity.verb} ·{" "}
                          <span className="text-muted">{title}</span>
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {trip ? (
                            <Badge tone="neutral">{trip.title}</Badge>
                          ) : (
                            <Badge tone="slate">WORKSPACE</Badge>
                          )}
                          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                            {activity.entityType.replaceAll("_", " ")}
                          </span>
                        </div>
                      </div>
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface-2 text-muted">
                        <Icon aria-hidden="true" className="size-3.5" />
                      </span>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}

          {visibleCount < activities.length ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setVisibleCount((count) => count + 8)}
            >
              加载更多活动
              <ArrowUpRight aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20">
          <section className="surface-card p-5">
            <p className="type-eyebrow">EVENT MIX</p>
            <h2 className="mt-1.5 font-serif text-2xl text-ink">发生了什么</h2>
            <div className="mt-4 space-y-2.5">
              {Object.entries(
                activities.reduce<Record<string, number>>((counts, activity) => {
                  counts[activity.verb] = (counts[activity.verb] ?? 0) + 1;
                  return counts;
                }, {}),
              )
                .sort((left, right) => right[1] - left[1])
                .slice(0, 5)
                .map(([verb, count]) => (
                  <div key={verb} className="flex items-center justify-between gap-3">
                    <span className="text-[11px] text-body">
                      {verbLabels[verb] ?? verb}
                    </span>
                    <span className="font-mono text-[10px] text-ink">{count}</span>
                  </div>
                ))}
            </div>
          </section>

          <section className="surface-card p-4">
            <div className="flex items-center gap-2">
              <Activity aria-hidden="true" className="size-3.5 text-accent-green" />
              <p className="type-eyebrow">REALTIME BOUNDARY</p>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              Socket.IO、presence 与 query invalidation 尚未接入。本地事件只用于验证界面和信息架构。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
