import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SETTINGS_GROUPS, type AdminSettingsResponse } from "@roamlog/contracts";

import type { AdminSettingsApi } from "../../lib/admin-settings-api";
import { SettingsConsole } from "./settings-console";

function responseFixture(): AdminSettingsResponse {
  return {
    groups: SETTINGS_GROUPS.map((group) => ({
      group,
      label: group,
      items:
        group === "general"
          ? [
              {
                key: "site.title",
                group: "general",
                type: "string",
                label: "站点标题",
                default: "Roamlog",
                isSecret: false,
                isPublic: true,
                envLocked: false,
                value: "Roamlog",
                updatedAt: null,
                updatedById: null,
              },
            ]
          : [],
    })),
    generatedAt: "2026-11-22T12:00:00.000Z",
  };
}

function fakeApi() {
  const list = vi.fn(async () => responseFixture());
  const update = vi.fn(async () => ({
    updated: [],
    version: 1,
    generatedAt: "2026-11-22T12:00:00.000Z",
  }));
  const reveal = vi.fn(async (key: string) => ({
    key,
    value: "secret",
    revealedAt: "2026-11-22T12:00:00.000Z",
  }));
  return { list, update, reveal } satisfies AdminSettingsApi;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/admin/settings");
});

describe("SettingsConsole tabs", () => {
  it("fetches scalar settings once and preserves a draft while switching tabs", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<SettingsConsole role="super_admin" api={api} />);

    const title = await screen.findByLabelText("站点标题");
    await user.type(title, "!");
    await user.click(screen.getByRole("tab", { name: "SEO" }));
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("seo");
    await user.click(screen.getByRole("tab", { name: /^通用/ }));

    expect(screen.getByLabelText("站点标题")).toHaveValue("Roamlog!");
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(window.location.search).has("tab")).toBe(false);
  });

  it("supports arrow-key tab navigation and deep-link state without navigation", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<SettingsConsole role="super_admin" api={api} />);

    const general = await screen.findByRole("tab", { name: "通用" });
    general.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "SEO" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "SEO" })).toBeVisible();
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("seo");
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("guards beforeunload and internal links while any panel has pending edits", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SettingsConsole role="super_admin" api={api} />);

    await user.type(await screen.findByLabelText("站点标题"), "!");
    expect(screen.getByRole("status")).toHaveTextContent("1 个分组有未保存修改");

    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    const anchor = document.createElement("a");
    anchor.href = "/admin/users";
    anchor.textContent = "users";
    document.body.append(anchor);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    const dispatched = anchor.dispatchEvent(click);
    anchor.remove();

    expect(dispatched).toBe(false);
    expect(click.defaultPrevented).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("keeps inactive panels mounted and hidden after a tab change", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(<SettingsConsole role="super_admin" api={api} />);

    await screen.findByRole("tabpanel", { name: "通用" });
    await user.click(screen.getByRole("tab", { name: "限制" }));

    expect(document.getElementById("settings-panel-general")).not.toBeVisible();
    expect(screen.getByRole("tabpanel", { name: "限制" })).toBeVisible();
    expect(screen.getAllByRole("tabpanel", { hidden: true })).toHaveLength(4);
    expect(api.list).toHaveBeenCalledTimes(1);
  });
});
