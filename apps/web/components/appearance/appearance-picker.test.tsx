import type { ResolvedAppearance } from "@roamlog/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppearancePickerForm, type AppearancePickerFormProps } from "./appearance-picker";

const appearance: ResolvedAppearance = {
  mode: "system",
  skin: "editorial-noir",
  fontPairing: "editorial-classic",
  source: "user",
  canOverride: true,
  updatedAt: "2026-11-22T12:00:00.000Z",
  defaults: {
    mode: "system",
    skin: "editorial-noir",
    fontPairing: "editorial-classic",
  },
};

function renderForm(overrides: Partial<AppearancePickerFormProps> = {}) {
  const props: AppearancePickerFormProps = {
    data: appearance,
    value: {
      mode: appearance.mode,
      skin: appearance.skin,
      fontPairing: appearance.fontPairing,
    },
    dirty: false,
    onChange: vi.fn(),
    onDiscard: vi.fn(),
    onSave: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<AppearancePickerForm {...props} />);
  return props;
}

describe("AppearancePickerForm", () => {
  it("renders all six skins and all six locally bundled font pairings", () => {
    renderForm();

    expect(screen.getAllByRole("radio")).toHaveLength(15);
    expect(screen.getByRole("radio", { name: /猫咖/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /常青林/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /文学暖调/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /瑞士现代/ })).toBeInTheDocument();
  });

  it("emits the selected mode without losing the current skin or font", () => {
    const onChange = vi.fn();
    renderForm({ onChange });

    fireEvent.click(screen.getByRole("radio", { name: "深色" }));

    expect(onChange).toHaveBeenCalledWith({
      mode: "dark",
      skin: "editorial-noir",
      fontPairing: "editorial-classic",
    });
  });

  it("supports keyboard radio navigation", () => {
    const onChange = vi.fn();
    renderForm({
      value: {
        mode: "dark",
        skin: "editorial-noir",
        fontPairing: "editorial-classic",
      },
      onChange,
    });

    fireEvent.keyDown(screen.getByRole("radio", { name: "深色" }), {
      key: "ArrowLeft",
    });

    expect(onChange).toHaveBeenCalledWith({
      mode: "light",
      skin: "editorial-noir",
      fontPairing: "editorial-classic",
    });
  });

  it("emits skin and font choices with their stable ids", () => {
    const onChange = vi.fn();
    renderForm({ onChange });

    fireEvent.click(screen.getByRole("radio", { name: /常青林/ }));
    fireEvent.click(screen.getByRole("radio", { name: /瑞士现代/ }));

    expect(onChange).toHaveBeenNthCalledWith(1, {
      mode: "system",
      skin: "everforest",
      fontPairing: "editorial-classic",
    });
    expect(onChange).toHaveBeenNthCalledWith(2, {
      mode: "system",
      skin: "editorial-noir",
      fontPairing: "swiss-modern",
    });
  });

  it("only enables save when the draft is dirty and overrides are allowed", () => {
    const onSave = vi.fn();
    renderForm({ dirty: true, onSave });

    fireEvent.click(screen.getByRole("button", { name: /保存外观/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("keeps every control disabled when the platform disables overrides", () => {
    renderForm({
      data: {
        ...appearance,
        source: "platform",
        canOverride: false,
      },
    });

    expect(screen.getByRole("radio", { name: "深色" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /猫咖/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /文学暖调/ })).toBeDisabled();
    expect(screen.getByText(/管理员已关闭个人外观覆盖/)).toBeInTheDocument();
  });
});
