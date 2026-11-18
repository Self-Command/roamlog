import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithDemo } from "@/test/demo-render";

import { ItineraryTab } from "./itinerary-tab";

const SEOUL_TRIP_ID = "019a7e3a-2b40-7c1d-8a5f-000000000010";

describe("ItineraryTab", () => {
  it("toggles an itinerary item and adds a new one", async () => {
    const user = userEvent.setup();
    renderWithDemo(<ItineraryTab tripId={SEOUL_TRIP_ID} role="owner" />);

    const first = screen.getByRole("checkbox", { name: "完成北村韩屋村与三清洞" });
    expect(first).toBeChecked();
    await user.click(first);
    expect(first).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "添加行程" }));
    await user.type(screen.getByLabelText("行程标题"), "汉江夜跑");
    await user.type(screen.getByLabelText("地点"), "盘浦汉江公园");
    await user.click(screen.getByRole("button", { name: "加入行程" }));

    expect(screen.getByText("汉江夜跑")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "完成汉江夜跑" })).not.toBeChecked();
  });

  it("does not expose write actions to viewers", () => {
    renderWithDemo(<ItineraryTab tripId={SEOUL_TRIP_ID} role="viewer" />);
    expect(screen.queryByRole("button", { name: "添加行程" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "完成北村韩屋村与三清洞" })).toBeDisabled();
  });
});
