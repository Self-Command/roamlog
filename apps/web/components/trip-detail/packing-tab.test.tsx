import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithDemo } from "@/test/demo-render";

import { PackingTab } from "./packing-tab";

const SEOUL_TRIP_ID = "019a7e3a-2b40-7c1d-8a5f-000000000010";

describe("PackingTab", () => {
  it("optimistically checks an item and lets the user add another", async () => {
    const user = userEvent.setup();
    renderWithDemo(<PackingTab tripId={SEOUL_TRIP_ID} role="owner" />);

    const passport = screen.getByRole("checkbox", { name: "护照" });
    await user.click(passport);
    expect(passport).toBeChecked();
    expect(screen.getByText(/已打包 4 件/)).toBeInTheDocument();

    const form = screen.getByRole("form", { name: "新增打包物品" });
    await user.type(within(form).getByLabelText("新增物品"), "转换插头");
    await user.click(within(form).getByRole("button", { name: "添加" }));
    expect(screen.getByRole("checkbox", { name: "转换插头" })).not.toBeChecked();
  });
});
