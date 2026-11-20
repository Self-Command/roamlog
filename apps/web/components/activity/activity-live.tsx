"use client";

import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  Skeleton,
} from "@roamlog/ui";
import {
  ArrowUpRight,
  BookOpen,
  MapPinned,
  MessageCircle,
  ReceiptText,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";

import { shortDate } from "@/lib/demo-format";
import {
  useActivityQuery,
  useMembersQuery,
  useTripsQuery,
  useWorkspaceBySlug,
} from "@/lib/query";

const verbLabels: Record<string, string> = {
  commented: "留下评论",
  "comment.created": "留下评论",
  completed_itinerary: "完成行程",
  expensed: "记录花费",
  "expense.created": "记录花费",
  created_entry: "写下日志",
  "journal_entry.created": "写下日志",
  "journal_entry.updated": "更新日志",
  uploaded_media: "上传照片",
  "media.presigned": "上传照片",
  "media.completed": "上传照片",
  updated_packing: "更新打包清单",
  "packing.updated": "更新打包清单",
  invited_member: "邀请成员",
  "invitation.created": "邀请成员",
  "itinerary_item.completed": "完成行程项",
  "media.uploaded": "上传照片",
  "packing_item.updated": "更新打包清单",
  "share_link.created": "创建分享链接",
  updated_trip: "更新旅行",
  "trip.updated": "更新旅行",
  "trip.created": "创建旅行",
  favorited_entry: "收藏日志",
  created_itinerary: "新增行程",
  created_trip: "创建旅行",
};

/** Machine verbs never reach the UI: a known prefix keeps the line readable. */
const verbPrefixLabels: Record<string, string> = {
  trip: "更新旅行",
  expense: "记录花费",
  journal_entry: "更新日志",
  comment: "留下评论",
  media: "上传照片",
  packing: "更新打包清单",
  member: "邀请成员",
  share_link: "更新分享",
  workspace: "更新工作区",
};

function verbLabel(verb: string): string {
  return verbLabels[verb] ?? verbPrefixLabels[verb.split(".")[0] ?? ""] ?? "更新了内容";
}

const entityLabels: Record<string, string> = {
  trip: "旅行",
  expense: "花费",
  media: "照片",
  journal_entry: "日志",
  comment: "评论",
  packing_item: "打包项",
  itinerary_item: "行程项",
  member: "成员",
  invitation: "邀请",
  share_link: "分享链接",
  workspace: "工作区",
};

function entityLabel(entityType: string): string {
  return entityLabels[entityType] ?? "记录";
}

function iconFor(verb: string) {
  if (verb === "commented") return MessageCircle;
  if (verb === "expensed") return ReceiptText;
  if (verb === "uploaded_media") return Upload;
  if (verb === "created_entry" || verb === "favorited_entry") return BookOpen;
  return MapPinned;
}

export function ActivityLive({ workspaceSlug }: { workspaceSlug: string }) {
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const tripsQuery = useTripsQuery(workspace?.id);
  const membersQuery = useMembersQuery(workspace?.id);
  const [scope, setScope] = useState("workspace");
  const [limit, setLimit] = useState(20);
  const activityQuery = useActivityQuery(workspace?.id, {
    limit,
    sort: "createdAt:desc",
  });

  const trips = tripsQuery.data?.items ?? [];
  const members = membersQuery.data?.items ?? [];
  const activities = useMemo(
    () =>
      (activityQuery.data?.items ?? []).filter(
        (activity) => scope === "workspace" || activity.tripId === scope,
      ),
    [activityQuery.data?.items, scope],
  );
  const groups = useMemo(() => {
    const map = new Map<string, typeof activities>();
    activities.forEach((activity) => {
      const day = activity.createdAt.slice(0, 10);
      map.set(day, [...(map.get(day) ?? []), activity]);
    });
    return [...map.entries()];
  }, [activities]);

  if (workspacesQuery.isLoading || activityQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    );
  }

  if (!workspace || activityQuery.error) {
    return (
      <ErrorState
        title="活动流不可用"
        description="Workspace 活动没有返回。请稍后重试。"
        retryAction={
          <Button type="button" variant="primary" onClick={() => void activityQuery.refetch()}>
            重新加载
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`ACTIVITY / ${activityQuery.data?.items.length ?? 0} EVENTS`}
        title="活动流"
        description="按天查看谁创建、修改、评论或上传了什么。"
        actions={
          <Select
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            aria-label="筛选活动范围"
            className="w-56"
          >
            <option value="workspace">整个 Workspace</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.title}
              </option>
            ))}
          </Select>
        }
      />

      {groups.length === 0 ? (
        <EmptyState
          title="还没有活动"
          description="成员创建旅行、写日志或评论后，事件会出现在这里。"
        />
      ) : (
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
              <div className="surface-card divide-y divide-hairline overflow-hidden">
                {items.map((activity) => {
                  const actor = members.find((member) => member.userId === activity.actorId)?.user;
                  const trip = trips.find((candidate) => candidate.id === activity.tripId);
                  const Icon = iconFor(activity.verb);
                  const title =
                    typeof activity.metadata.title === "string"
                      ? activity.metadata.title
                      : typeof activity.metadata.note === "string"
                        ? activity.metadata.note
                        : typeof activity.metadata.email === "string"
                          ? activity.metadata.email
                          : null;
                  return (
                    <article key={activity.id} className="flex items-start gap-3 px-4 py-4">
                      <Avatar name={actor?.name ?? "系统"} src={actor?.image ?? undefined} size={34} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-5 text-body">
                          <span className="font-medium text-ink">{actor?.name ?? "Roamlog"}</span>{" "}
                          {verbLabel(activity.verb)}
                          {title ? (
                            <>
                              {" · "}
                              <span className="text-muted">{title}</span>
                            </>
                          ) : null}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {trip ? (
                            <Badge tone="neutral">{trip.title}</Badge>
                          ) : (
                            <Badge tone="slate">WORKSPACE</Badge>
                          )}
                          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                            {entityLabel(activity.entityType)}
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

          {activityQuery.data?.hasMore ? (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setLimit((current) => Math.min(current + 20, 100))}
              disabled={activityQuery.isFetching}
            >
              加载更多活动
              <ArrowUpRight aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
