import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SETTINGS_GROUPS, type AdminSettingsResponse } from "@roamlog/contracts";

import { ADMIN_NAV_GROUPS, getBreadcrumbs } from "../admin-shell/admin-nav";
import type { AdminSettingsApi } from "../../lib/admin-settings-api";
import {
  SERVICE_SETTINGS_PAGES,
  SETTING_OPTION_LABELS,
  SETTING_TYPE_LABELS,
  SYSTEM_SETTINGS_GROUPS,
  settingOptionLabel,
  settingsGroupHref,
} from "../../lib/admin-settings";
import { SettingsConsole } from "./settings-console";

function emptyResponse(): AdminSettingsResponse {
  return {
    groups: SETTINGS_GROUPS.map((group) => ({ group, label: group, items: [] })),
    generatedAt: "2026-11-19T05:00:00.000Z",
  };
}

function fakeApi(): AdminSettingsApi {
  return {
    list: vi.fn(async () => emptyResponse()),
    update: vi.fn(async () => ({
      updated: [],
      version: 1,
      generatedAt: "2026-11-19T05:00:00.000Z",
    })),
    reveal: vi.fn(async (key: string) => ({
      key,
      value: "secret",
      revealedAt: "2026-11-19T05:00:00.000Z",
    })),
  };
}

describe("settings information architecture", () => {
  it("keeps /admin/settings to the four system groups", () => {
    expect([...SYSTEM_SETTINGS_GROUPS]).toEqual(["general", "seo", "theme", "limits"]);
    expect(SYSTEM_SETTINGS_GROUPS).not.toContain("mail");
    expect(SYSTEM_SETTINGS_GROUPS).not.toContain("storage");
    expect(SYSTEM_SETTINGS_GROUPS).not.toContain("places");
    expect(SYSTEM_SETTINGS_GROUPS).not.toContain("media");
    expect(SYSTEM_SETTINGS_GROUPS).not.toContain("ai");
  });

  it("maps every service page to exactly one service group", () => {
    expect(Object.entries(SERVICE_SETTINGS_PAGES).map(([key, page]) => [key, page.group])).toEqual([
      ["ai", "ai"],
      ["storage", "storage"],
      ["places", "places"],
      ["mail", "mail"],
      ["media", "media"],
    ]);
    expect(settingsGroupHref("ai")).toBe("/admin/services/ai");
    expect(settingsGroupHref("media")).toBe("/admin/services/media");
    expect(settingsGroupHref("general")).toBe("/admin/settings");
    expect(settingsGroupHref("limits")).toBe("/admin/settings");
  });

  it("adds a first-level 服务配置 sidebar group with the five service entries", () => {
    const serviceGroup = ADMIN_NAV_GROUPS.find((group) => group.label === "服务配置");
    expect(serviceGroup?.items.map((item) => [item.label, item.href])).toEqual([
      ["AI 服务", "/admin/services/ai"],
      ["存储服务", "/admin/services/storage"],
      ["地图服务", "/admin/services/places"],
      ["发信服务", "/admin/services/mail"],
      ["媒体处理", "/admin/services/media"],
    ]);
    const dataGroup = ADMIN_NAV_GROUPS.find((group) => group.label === "数据与运营");
    expect(dataGroup?.items.find((item) => item.label === "系统设置")?.href).toBe("/admin/settings");
  });

  it("derives breadcrumbs from the sidebar hierarchy", () => {
    expect(getBreadcrumbs("/admin/services/ai")).toEqual([
      { label: "平台", href: "/admin" },
      { label: "服务配置" },
      { label: "AI 服务" },
    ]);
    expect(getBreadcrumbs("/admin/settings")).toEqual([
      { label: "平台", href: "/admin" },
      { label: "数据与运营" },
      { label: "系统设置" },
    ]);
  });

  it("renders four stacked sections and no second-level settings navigation", async () => {
    render(<SettingsConsole role="super_admin" api={fakeApi()} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "系统设置" })).toBeInTheDocument();
    });
    for (const label of ["通用", "SEO", "主题", "限制"]) {
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
    for (const label of ["邮件", "存储", "媒体", "AI", "地点"]) {
      expect(screen.queryByRole("heading", { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("navigation", { name: "设置分组" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: /设置$/ })).toHaveLength(4);
  });

  it("localizes field type badges and option values without touching stored values", () => {
    expect(SETTING_TYPE_LABELS).toEqual({
      string: "文本",
      number: "数字",
      boolean: "开关",
      json: "JSON",
      secret: "密钥",
    });
    expect(SETTING_OPTION_LABELS.dark).toBe("深色");
    expect(SETTING_OPTION_LABELS.system).toBe("跟随系统");
    expect(SETTING_OPTION_LABELS.light).toBe("浅色");
    expect(settingOptionLabel("dark")).toBe("深色");
    expect(settingOptionLabel("unknown-value")).toBe("unknown-value");
  });
});
