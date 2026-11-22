import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SETTINGS_GROUPS,
  type AdminSettingItem,
  type AdminSettingUpdate,
  type AdminSettingsResponse,
  type SettingValue,
} from "@roamlog/contracts";

import { AdminSettingsError, type AdminSettingsApi } from "../../lib/admin-settings-api";
import { AppearanceDefaults } from "./appearance-defaults";

vi.mock("../../lib/font-pairing-loader", () => ({
  loadFontPairing: vi.fn(async () => undefined),
}));

function makeThemeItem(
  key: string,
  type: "string" | "boolean",
  label: string,
  defaultValue: SettingValue,
  value: SettingValue,
  options?: string[],
): AdminSettingItem {
  return {
    key,
    group: "theme",
    type,
    label,
    default: defaultValue,
    isSecret: false,
    isPublic: true,
    envLocked: false,
    value,
    ...(options ? { options } : {}),
    updatedAt: null,
    updatedById: null,
  } as AdminSettingItem;
}

function themeItems(overrides: Partial<Record<string, SettingValue>> = {}): AdminSettingItem[] {
  return [
    makeThemeItem(
      "theme.defaultMode",
      "string",
      "默认外观",
      "system",
      overrides["theme.defaultMode"] ?? "system",
      ["system", "light", "dark"],
    ),
    makeThemeItem(
      "theme.defaultSkin",
      "string",
      "默认皮肤",
      "editorial-noir",
      overrides["theme.defaultSkin"] ?? "editorial-noir",
      ["editorial-noir", "catppuccin", "tokyo-night", "rose-pine", "kanagawa", "everforest"],
    ),
    makeThemeItem(
      "theme.defaultFont",
      "string",
      "默认字体",
      "editorial-classic",
      overrides["theme.defaultFont"] ?? "editorial-classic",
      [
        "editorial-classic",
        "literary-warm",
        "modern-editorial",
        "expressive-serif",
        "cjk-editorial",
        "swiss-modern",
      ],
    ),
    makeThemeItem(
      "theme.allowUserOverride",
      "boolean",
      "允许用户覆盖",
      true,
      overrides["theme.allowUserOverride"] ?? true,
    ),
  ];
}

function responseOf(overrides: Partial<Record<string, SettingValue>> = {}): AdminSettingsResponse {
  return {
    groups: SETTINGS_GROUPS.map((group) => ({
      group,
      label: group,
      items: group === "theme" ? themeItems(overrides) : [],
    })),
    generatedAt: "2026-11-22T12:00:00.000Z",
  };
}

function fakeApi() {
  let current = responseOf();
  const list = vi.fn(async () => current);
  const update = vi.fn(async (updates: readonly AdminSettingUpdate[]) => {
    current = {
      ...current,
      groups: current.groups.map((group) =>
        group.group === "theme"
          ? {
              ...group,
              items: group.items.map((item) => {
                const change = updates.find((entry) => entry.key === item.key);
                return change
                  ? { ...item, value: change.value, updatedAt: current.generatedAt }
                  : item;
              }),
            }
          : group,
      ),
    };
    return {
      updated: updates.map((entry) => ({
        key: entry.key,
        secret: false,
        updatedAt: current.generatedAt,
      })),
      version: 1,
      generatedAt: current.generatedAt,
    };
  });
  const reveal = vi.fn(async (key: string) => ({
    key,
    value: "secret",
    revealedAt: current.generatedAt,
  }));
  const api = { list, update, reveal } satisfies AdminSettingsApi;
  return {
    api,
    list,
    update,
    setResponse: (next: AdminSettingsResponse) => {
      current = next;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.dataset.mode = "dark";
  document.documentElement.dataset.theme = "dark";
  document.documentElement.dataset.skin = "editorial-noir";
  document.documentElement.dataset.font = "editorial-classic";
});

describe("AppearanceDefaults", () => {
  it("loads the four controls and six skin/font choices", async () => {
    const fake = fakeApi();
    render(<AppearanceDefaults role="super_admin" api={fake.api} />);

    expect(await screen.findByRole("heading", { name: "外观与字体" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "外观与字体 设置" })).toHaveAttribute(
      "data-settings-group",
      "theme",
    );
    const modeGroup = screen.getByRole("radiogroup", { name: "默认外观" });
    expect(within(modeGroup).getAllByRole("radio")).toHaveLength(3);
    expect(within(modeGroup).getByRole("radio", { name: "跟随系统" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      within(screen.getByRole("radiogroup", { name: "默认皮肤" })).getAllByRole("radio"),
    ).toHaveLength(6);
    expect(
      within(screen.getByRole("radiogroup", { name: "默认字体" })).getAllByRole("radio"),
    ).toHaveLength(6);
    expect(screen.getByRole("switch", { name: "允许用户覆盖外观" })).toBeChecked();
  });

  it("saves only changed appearance keys and reloads the server snapshot", async () => {
    const user = userEvent.setup();
    const fake = fakeApi();
    render(<AppearanceDefaults role="super_admin" api={fake.api} />);

    await screen.findByRole("radiogroup", { name: "默认皮肤" });
    await user.click(screen.getByRole("radio", { name: "深色" }));
    await user.click(screen.getByRole("radio", { name: /猫咖/ }));
    await user.click(screen.getByRole("switch", { name: "允许用户覆盖外观" }));
    await user.click(screen.getByRole("button", { name: "保存外观" }));

    expect(fake.update).toHaveBeenCalledOnce();
    expect(fake.update.mock.calls[0]?.[0]).toEqual([
      { key: "theme.defaultMode", value: "dark" },
      { key: "theme.defaultSkin", value: "catppuccin" },
      { key: "theme.allowUserOverride", value: false },
    ]);
    expect(fake.list).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("status")).toHaveTextContent("外观默认值已保存");
    expect(screen.getByRole("radio", { name: /猫咖/ })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the draft and shows field errors after a 422", async () => {
    const user = userEvent.setup();
    const fake = fakeApi();
    fake.update.mockRejectedValueOnce(
      new AdminSettingsError(
        {
          code: "SETTINGS_INVALID",
          status: 422,
          title: "设置无效",
          detail: "The appearance value is invalid.",
          degraded: [],
        },
        [
          {
            field: "theme.defaultSkin",
            code: "INVALID_SKIN",
            message: "该皮肤不可用。",
          },
        ],
      ),
    );
    render(<AppearanceDefaults role="super_admin" api={fake.api} />);

    await screen.findByRole("radiogroup", { name: "默认皮肤" });
    await user.click(screen.getByRole("radio", { name: /常青林/ }));
    await user.click(screen.getByRole("button", { name: "保存外观" }));

    expect(await screen.findByText("该皮肤不可用。")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /常青林/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("The appearance value is invalid.");
  });

  it("renders as read-only for an analyst", async () => {
    const fake = fakeApi();
    render(<AppearanceDefaults role="analyst" api={fake.api} />);

    expect(
      await screen.findByText("只有超级管理员可以修改平台默认外观；当前角色只能查看。"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存外观" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "浅色" })).toBeDisabled();
  });

  it("never changes the Admin document's fixed dark shell", async () => {
    const user = userEvent.setup();
    const fake = fakeApi();
    document.documentElement.dataset.mode = "dark";
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.skin = "editorial-noir";
    document.documentElement.dataset.font = "editorial-classic";

    render(<AppearanceDefaults role="super_admin" api={fake.api} />);
    await screen.findByRole("radiogroup", { name: "默认皮肤" });
    await user.click(screen.getByRole("radio", { name: "浅色" }));
    await user.click(screen.getByRole("radio", { name: /常青林/ }));

    expect(document.documentElement).toHaveAttribute("data-mode", "dark");
    expect(document.documentElement).toHaveAttribute("data-skin", "editorial-noir");
    expect(document.documentElement).toHaveAttribute("data-font", "editorial-classic");
  });
});
