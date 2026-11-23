import type { ThreadListItemRuntimeState } from "@assistant-ui/react";
import { describe, expect, it } from "vitest";

import { groupThreads } from "../thread-list";

function item(id: string, lastMessageAt?: Date): ThreadListItemRuntimeState {
  return {
    id,
    remoteId: id,
    externalId: undefined,
    title: id,
    lastMessageAt,
    status: "regular",
    custom: undefined,
    isRunning: false,
    isMain: false,
  };
}

describe("groupThreads", () => {
  const now = new Date(2026, 10, 23, 12, 0, 0);

  it("groups in the upstream date order and keeps item order", () => {
    const groups = groupThreads(
      [
        item("today-1", new Date(2026, 10, 23, 9)),
        item("today-2", new Date(2026, 10, 23, 8)),
        item("yesterday", new Date(2026, 10, 22, 9)),
        item("week", new Date(2026, 10, 20, 9)),
        item("month", new Date(2026, 9, 30, 9)),
        item("older", new Date(2026, 8, 1, 9)),
        item("unknown"),
      ],
      now,
    );

    expect(groups.map((group) => [group.key, group.label])).toEqual([
      ["today", "今天"],
      ["yesterday", "昨天"],
      ["lastWeek", "最近 7 天"],
      ["lastMonth", "最近 30 天"],
      ["older", "更早"],
      ["unknown", "无时间"],
    ]);
    expect(groups[0]?.items.map(({ item: thread }) => thread.id)).toEqual(["today-1", "today-2"]);
    expect(groups[0]?.items.map(({ index }) => index)).toEqual([0, 1]);
  });

  it("omits empty buckets", () => {
    const groups = groupThreads([item("only", new Date(2026, 10, 23, 9))], now);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("today");
  });
});
