import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { QuickAppearanceMenu } from "../index";

describe("QuickAppearanceMenu", () => {
  it("applies mode and skin choices from the popover", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    const onSkinChange = vi.fn();

    render(
      <QuickAppearanceMenu
        mode="system"
        skin="porcelain"
        onModeChange={onModeChange}
        onSkinChange={onSkinChange}
        moreHref="/w/demo/settings/appearance"
      />,
    );

    await user.click(screen.getByTestId("quick-appearance-trigger"));
    expect(await screen.findByTestId("quick-appearance-menu")).toBeVisible();
    expect(screen.getByText("更多外观设置")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "深色" }));
    expect(onModeChange).toHaveBeenCalledWith("dark");

    await user.click(screen.getByRole("radio", { name: /Fluent 2 原生企业/ }));
    expect(onSkinChange).toHaveBeenCalledWith("fluent");
  });

  it("supports roving arrow keys for display mode", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();

    render(
      <QuickAppearanceMenu
        mode="system"
        skin="porcelain"
        onModeChange={onModeChange}
        onSkinChange={vi.fn()}
        moreHref="/w/demo/settings/appearance"
      />,
    );

    await user.click(screen.getByTestId("quick-appearance-trigger"));
    const system = screen.getByRole("radio", { name: "跟随系统" });
    system.focus();
    await user.keyboard("{ArrowRight}");

    expect(onModeChange).toHaveBeenCalledWith("light");
    expect(screen.getByRole("radio", { name: "浅色" })).toHaveFocus();
  });

  it("surfaces save errors and disables the trigger when locked", async () => {
    const user = userEvent.setup();
    render(
      <QuickAppearanceMenu
        mode="dark"
        skin="carbon"
        onModeChange={vi.fn()}
        onSkinChange={vi.fn()}
        moreHref="/admin/settings"
        error="外观保存失败，请重试。"
      />,
    );

    await user.click(screen.getByTestId("quick-appearance-trigger"));
    expect(await screen.findByRole("alert")).toHaveTextContent("外观保存失败，请重试。");

    render(
      <QuickAppearanceMenu
        mode="dark"
        skin="carbon"
        onModeChange={vi.fn()}
        onSkinChange={vi.fn()}
        moreHref="/admin/settings"
        disabled
      />,
    );
    expect(screen.getAllByTestId("quick-appearance-trigger").at(-1)).toBeDisabled();
  });
});
