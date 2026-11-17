import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithDemo } from "@/test/demo-render";

import { BudgetTab } from "./budget-tab";

const SEOUL_TRIP_ID = "019a7e3a-2b40-7c1d-8a5f-000000000010";

describe("BudgetTab", () => {
  it("adds an expense with an equal split and updates the totals", async () => {
    const user = userEvent.setup();
    renderWithDemo(<BudgetTab tripId={SEOUL_TRIP_ID} currency="CNY" role="owner" />);

    expect(screen.getByText("广藏市场晚餐")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "记一笔" }));
    await user.type(screen.getByLabelText("金额（元）"), "240");
    await user.type(screen.getByLabelText("备注"), "汉江拉面与便利店");
    await user.click(screen.getByRole("button", { name: "保存花费" }));

    expect(screen.getByText("汉江拉面与便利店")).toBeInTheDocument();
    expect(screen.getByTestId("spent-total")).toHaveTextContent("¥3,672");
  });
});
