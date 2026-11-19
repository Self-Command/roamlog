import { describe, expect, it } from "vitest";

import { describePlannedCall, toolLabel } from "../copy";

describe("AI plan copy for trips.list", () => {
  it("labels the discovery tool as 查找旅行", () => {
    expect(toolLabel("trips.list")).toBe("查找旅行");
  });

  it("describes a discovery call without printing raw arguments", () => {
    const copy = describePlannedCall({
      tool: "trips.list",
      args: { query: "京都", limit: 5 },
    });

    expect(copy.label).toBe("查找旅行");
    expect(copy.headline).toBe("查找已有旅行");
    expect(copy.details).toEqual(["标题包含「京都」", "最多 5 条"]);
    // Reading the workspace never renders the write badge.
    expect(copy.write).toBe(false);
  });
});
