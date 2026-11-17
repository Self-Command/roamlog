import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithDemo } from "@/test/demo-render";

import { AtlasWorkspace } from "./atlas-workspace";

describe("AtlasWorkspace", () => {
  it("falls back from the schematic map to the accessible trip list", async () => {
    const user = userEvent.setup();
    renderWithDemo(<AtlasWorkspace workspaceSlug="roamlog-crew" />);

    expect(screen.getByTestId("world-map")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "列表" }));

    expect(screen.queryByTestId("world-map")).not.toBeInTheDocument();
    expect(
      screen.getByText("低带宽列表视图：地图不可用或不需要瓦片时，所有旅行仍可访问。"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("巴塔哥尼亚穿越").length).toBeGreaterThan(0);
  });

  it("filters the trip sidebar by search text", async () => {
    const user = userEvent.setup();
    renderWithDemo(<AtlasWorkspace workspaceSlug="roamlog-crew" />);
    await user.type(screen.getByRole("searchbox", { name: "搜索旅行足迹" }), "冰岛");
    expect(screen.getAllByText("冰岛环岛手记").length).toBeGreaterThan(0);
    expect(screen.queryByText("首尔，晚秋与夜航")).not.toBeInTheDocument();
  });
});
