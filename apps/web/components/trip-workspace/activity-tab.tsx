"use client";

import { Badge } from "@roamlog/ui";
import { Activity } from "lucide-react";

import { activityVerbLabel, shortTimestamp } from "./format";
import { useMemberDirectory } from "./member-directory";
import { EmptyBlock, QueryPanel } from "./panel";
import { useTripActivityItems } from "./queries";

export function ActivityTab({ tripId }: { tripId: string }) {
  const activity = useTripActivityItems(tripId);
  const directory = useMemberDirectory();

  return (
    <QueryPanel
      title="活动"
      meta={
        activity.state === "ready"
          ? `${activity.data.items.length} 条${activity.data.hasMore ? " · 有更多分页" : ""}`
          : "读取中"
      }
      result={activity}
      errorTitle="活动记录读取失败"
      isEmpty={(data) => data.items.length === 0}
      empty={
        <EmptyBlock
          icon={Activity}
          title="还没有活动记录"
          description="创建、修改、分享等操作会被 API 记录成活动，这里按时间倒序显示。"
        />
      }
    >
      {(data) => (
        <div>
          <ul className="divide-y divide-hairline">
            {data.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-3">
                <span className="text-[13px] leading-5 text-ink">
                  {directory.nameOf(item.actorId)}
                </span>
                <span className="text-[12px] leading-5 text-body">
                  {activityVerbLabel(item.verb)}
                </span>
                <Badge tone="neutral">{item.entityType}</Badge>
                <span className="ml-auto font-mono text-[10px] text-stone">
                  {shortTimestamp(item.createdAt)}
                </span>
              </li>
            ))}
          </ul>
          <p className="border-t border-hairline px-4 py-3 font-mono text-[10px] leading-5 text-stone">
            评论未接入：评论契约只覆盖日志条目与行程项（CommentTargetTypeSchema），
            没有「旅行级评论」目标类型，因此这里不渲染评论框。
          </p>
        </div>
      )}
    </QueryPanel>
  );
}