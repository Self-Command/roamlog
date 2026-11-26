import type { ResolvedAppearance } from "@roamlog/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppearancePickerForm, type AppearancePickerFormProps } from "./appearance-picker";

const appearance: ResolvedAppearance = {
  mode: "system",
  skin: "fluent",
  fontPairing: "fluent-native",
  source: "user",
  canOverride: true,
  updatedAt: "2026-11-22T12:00:00.000Z",
  defaults: {
    mode: "system",
    skin: "fluent",
    fontPairing: "fluent-native",
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
  it("renders the active enterprise themes and four locally bundled font pairings", () => {
    renderForm();

    expect(screen.getAllByRole("radio")).toHaveLength(15);
    expect(screen.queryByRole("radio", { name: /Primer 企业中性/ })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Mist/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Geist/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Iris/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Sandstone/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Porcelain/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Fluent 2/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /IBM Carbon/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Carbon Plex/ })).toBeInTheDocument();
    expect(screen.getByTestId("appearance-workspace-preview-system")).toBeInTheDocument();
    expect(screen.getAllByText("工作台").length).toBeGreaterThan(0);
  });

  it("emits the selected mode without losing the current skin or font", () => {
    const onChange = vi.fn();
    renderForm({ onChange });

    fireEvent.click(screen.getByRole("radio", { name: "深色" }));

    expect(onChange).toHaveBeenCalledWith({
      mode: "dark",
      skin: "fluent",
      fontPairing: "fluent-native",
    });
  });

  it("supports keyboard radio navigation", () => {
    const onChange = vi.fn();
    renderForm({
      value: {
        mode: "dark",
        skin: "fluent",
        fontPairing: "fluent-native",
      },
      onChange,
    });

    fireEvent.keyDown(screen.getByRole("radio", { name: "深色" }), {
      key: "ArrowLeft",
    });

    expect(onChange).toHaveBeenCalledWith({
      mode: "light",
      skin: "fluent",
      fontPairing: "fluent-native",
    });
  });

  it("emits skin and font choices with their stable ids", () => {
    const onChange = vi.fn();
    renderForm({ onChange });

    fireEvent.click(screen.getByRole("radio", { name: /IBM Carbon/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Carbon Plex/ }));

    expect(onChange).toHaveBeenNthCalledWith(1, {
      mode: "system",
      skin: "carbon",
      fontPairing: "fluent-native",
    });
    expect(onChange).toHaveBeenNthCalledWith(2, {
      mode: "system",
      skin: "fluent",
      fontPairing: "carbon-plex",
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
    expect(screen.getByRole("radio", { name: /Fluent 2/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Carbon Plex/ })).toBeDisabled();
    expect(screen.getByText(/管理员已关闭个人外观覆盖/)).toBeInTheDocument();
  });
});
