import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DatePicker } from "../date-picker";

const VALUE = "2026-03-15";
const MIN = "2026-03-10";
const MAX = "2026-03-20";
const GRID_LABEL = "选择出发日期";

function renderPicker(props: Partial<Parameters<typeof DatePicker>[0]> = {}) {
  const onChange = vi.fn<(value: string) => void>();
  render(
    <DatePicker
      value={VALUE}
      onChange={onChange}
      min={MIN}
      max={MAX}
      gridLabel={GRID_LABEL}
      {...props}
    />,
  );
  return { onChange };
}

async function openGrid() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /2026年3月15日/ }));
  const grid = await screen.findByRole("grid", { name: GRID_LABEL });
  await waitFor(() => expect(grid).toHaveFocus());
  return { user, grid };
}

describe("DatePicker", () => {
  it("renders a real month grid instead of a bare text input", async () => {
    renderPicker();
    const { grid } = await openGrid();

    expect(within(grid).getAllByRole("gridcell").length).toBe(31);
    expect(screen.getByText("2026年3月")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上个月" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下个月" })).toBeInTheDocument();
    expect(within(grid).getByRole("gridcell", { name: "15" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("moves with arrow keys, commits with Enter and closes the dialog", async () => {
    renderPicker({ min: undefined, max: undefined });
    const { user, grid } = await openGrid();

    expect(grid).toHaveAttribute("aria-activedescendant", `date-picker-${GRID_LABEL}-${VALUE}`);

    await user.keyboard("{ArrowRight}");
    expect(grid).toHaveAttribute(
      "aria-activedescendant",
      `date-picker-${GRID_LABEL}-2026-03-16`,
    );

    await user.keyboard("{ArrowDown}");
    expect(grid).toHaveAttribute(
      "aria-activedescendant",
      `date-picker-${GRID_LABEL}-2026-03-23`,
    );

    await user.keyboard("{ArrowUp}{ArrowLeft}{Enter}");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("only commits an in-range day", async () => {
    const { onChange } = renderPicker();
    const { user } = await openGrid();

    await user.keyboard("{ArrowRight}{Enter}");

    expect(onChange).toHaveBeenCalledWith("2026-03-16");
  });

  it("clamps keyboard focus to the min/max bounds", async () => {
    renderPicker();
    const { user, grid } = await openGrid();

    // 2026-03-15 minus one week is 2026-03-08, below `min`, so focus stops at 10.
    await user.keyboard("{ArrowUp}");
    expect(grid).toHaveAttribute(
      "aria-activedescendant",
      `date-picker-${GRID_LABEL}-${MIN}`,
    );
  });

  it("closes on Escape without selecting a day", async () => {
    const { onChange } = renderPicker();
    const { user } = await openGrid();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("switches months with the toolbar buttons", async () => {
    renderPicker();
    const { user } = await openGrid();

    await user.click(screen.getByRole("button", { name: "下个月" }));
    expect(screen.getByText("2026年4月")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "上个月" }));
    await user.click(screen.getByRole("button", { name: "上个月" }));
    expect(screen.getByText("2026年2月")).toBeInTheDocument();
  });

  it("switches months with PageUp/PageDown from the keyboard", async () => {
    renderPicker();
    const { user } = await openGrid();

    await user.keyboard("{PageDown}");
    expect(screen.getByText("2026年4月")).toBeInTheDocument();

    await user.keyboard("{PageUp}");
    await user.keyboard("{PageUp}");
    expect(screen.getByText("2026年2月")).toBeInTheDocument();
  });

  it("disables days outside min/max and never commits a disabled day", async () => {
    const { onChange } = renderPicker();
    const { user, grid } = await openGrid();

    const outside = within(grid).getByRole("gridcell", { name: "9" });
    expect(outside).toHaveAttribute("aria-disabled", "true");

    const inRange = within(grid).getByRole("gridcell", { name: "10" });
    expect(inRange).not.toHaveAttribute("aria-disabled");
    expect(within(grid).getByRole("gridcell", { name: "21" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await user.click(outside);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("grid")).toBeInTheDocument();

    await user.click(inRange);
    expect(onChange).toHaveBeenCalledWith(MIN);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });
});