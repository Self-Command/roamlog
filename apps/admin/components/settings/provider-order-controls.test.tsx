import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProviderConnection, ProviderGroupResponse } from "@roamlog/contracts";

import { AdminMutationError } from "../../lib/admin-api-error";
import type { ProviderSettingsApi } from "../../lib/provider-settings-api";
import { ProviderOrderControls } from "./provider-order-controls";

const TENANT_ID = "0199b0c1-2200-7000-8000-000000000001";
const DEEPSEEK_ID = "0199b0c1-2200-7000-8000-000000000002";

function provider(id: string, label: string, preset: string, priority: number): ProviderConnection {
  return {
    id,
    group: "places",
    adapter: preset,
    preset,
    label,
    enabled: true,
    priority,
    config: {},
    version: 1,
    secrets: [{ field: "apiKey", hasValue: true, last4: "1234", version: 1 }],
    health: {
      status: "healthy",
      lastCheckedAt: null,
      lastErrorCode: null,
      cooldownUntil: null,
    },
    createdAt: "2026-11-22T12:00:00.000Z",
    updatedAt: "2026-11-22T12:00:00.000Z",
  };
}

const providers = [
  provider(TENANT_ID, "腾讯地图", "tencent", 10),
  provider(DEEPSEEK_ID, "Geoapify", "geoapify", 20),
];

function group(next: ProviderConnection[], version = 4): ProviderGroupResponse {
  return {
    group: "places",
    label: "地图服务",
    routingMode: "merge",
    maxAttempts: 3,
    cooldownSeconds: 30,
    version,
    providers: next,
  };
}

function providerConflict(): AdminMutationError {
  return new AdminMutationError({
    code: "PROVIDER_ORDER_CONFLICT",
    status: 409,
    title: "Provider order conflict",
    detail: "顺序已被其他运营修改。",
    degraded: [],
  });
}

function fakeApi(reorder: ProviderSettingsApi["reorder"]): ProviderSettingsApi {
  return {
    reorder,
    group: vi.fn(async () => group(providers)),
  } as unknown as ProviderSettingsApi;
}

describe("ProviderOrderControls", () => {
  it("saves keyboard-normalized order with the group version", async () => {
    const user = userEvent.setup();
    const updated = [providers[1]!, providers[0]!];
    const reorder = vi.fn(async () => group(updated, 5));
    const onSaved = vi.fn();
    render(
      <ProviderOrderControls
        group="places"
        providers={providers}
        groupVersion={4}
        role="super_admin"
        api={fakeApi(reorder)}
        onSaved={onSaved}
      />,
    );

    await user.click(screen.getByRole("button", { name: "调整顺序" }));
    await user.click(screen.getByRole("button", { name: "腾讯地图下移" }));
    await user.click(screen.getByRole("button", { name: "保存顺序" }));

    expect(reorder).toHaveBeenCalledWith("places", [DEEPSEEK_ID, TENANT_ID], 4);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ version: 5 }));
  });

  it("keeps the local order and opens conflict recovery on a 409", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    render(
      <ProviderOrderControls
        group="places"
        providers={providers}
        groupVersion={4}
        role="super_admin"
        api={fakeApi(vi.fn().mockRejectedValue(providerConflict()))}
        onError={onError}
      />,
    );

    await user.click(screen.getByRole("button", { name: "调整顺序" }));
    await user.click(screen.getByRole("button", { name: "腾讯地图下移" }));
    await user.click(screen.getByRole("button", { name: "保存顺序" }));

    expect(await screen.findByTestId("provider-conflict-dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByRole("button", { name: "腾讯地图上移" })).toBeInTheDocument();
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining("失败"));
  });

  it("loads the latest order after a conflict", async () => {
    const user = userEvent.setup();
    const latest = [providers[0]!, providers[1]!];
    const api = fakeApi(vi.fn().mockRejectedValue(providerConflict()));
    vi.mocked(api.group).mockResolvedValue(group(latest, 6));
    render(
      <ProviderOrderControls
        group="places"
        providers={providers}
        groupVersion={4}
        role="super_admin"
        api={api}
      />,
    );

    await user.click(screen.getByRole("button", { name: "调整顺序" }));
    await user.click(screen.getByRole("button", { name: "腾讯地图下移" }));
    await user.click(screen.getByRole("button", { name: "保存顺序" }));
    await user.click(await screen.findByRole("button", { name: "载入最新顺序" }));

    expect(api.group).toHaveBeenCalledWith("places");
    expect(screen.queryByTestId("provider-conflict-dialog")).not.toBeInTheDocument();
  });

  it("confirms before discarding an unsaved order", async () => {
    const user = userEvent.setup();
    render(
      <ProviderOrderControls
        group="places"
        providers={providers}
        groupVersion={4}
        role="super_admin"
        api={fakeApi(vi.fn())}
      />,
    );

    await user.click(screen.getByRole("button", { name: "调整顺序" }));
    await user.click(screen.getByRole("button", { name: "腾讯地图下移" }));
    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(
      await screen.findByRole("heading", { name: "放弃未保存的顺序调整？" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByRole("button", { name: "保存顺序" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(await screen.findByRole("button", { name: "放弃调整" }));
    expect(screen.getByRole("button", { name: "调整顺序" })).toBeInTheDocument();
  });

  it("does not render ordering controls for a read-only role", () => {
    render(
      <ProviderOrderControls
        group="places"
        providers={providers}
        groupVersion={4}
        role="analyst"
        api={fakeApi(vi.fn())}
      />,
    );

    expect(screen.queryByRole("button", { name: "调整顺序" })).not.toBeInTheDocument();
  });
});
