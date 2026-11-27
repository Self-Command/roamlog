import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProviderCatalog, ProviderConnection } from "@roamlog/contracts";

import { ProviderList } from "./provider-list";

const PROVIDER_ID = "0199b0c1-2200-7000-8000-000000000001";

function provider(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: PROVIDER_ID,
    group: "ai",
    adapter: "openai-chat",
    preset: "deepseek",
    label: "DeepSeek 主账号",
    enabled: true,
    priority: 10,
    config: { baseUrl: "https://api.deepseek.com/v1" },
    version: 1,
    secrets: [{ field: "apiKey", hasValue: true, last4: "1234", version: 1 }],
    health: {
      status: "healthy",
      lastCheckedAt: "2026-11-22T12:00:00.000Z",
      lastErrorCode: null,
      cooldownUntil: null,
    },
    createdAt: "2026-11-22T12:00:00.000Z",
    updatedAt: "2026-11-22T12:00:00.000Z",
    ...overrides,
  };
}

const catalog: ProviderCatalog = {
  version: 1,
  groups: [
    {
      group: "ai",
      label: "AI 服务",
      routingModes: ["priority"],
      adapters: [
        {
          adapter: "openai-chat",
          label: "OpenAI Chat Completions",
          capabilities: ["model_discovery", "probe", "priority"],
          configFields: [],
          secretFields: [{ key: "apiKey", label: "API Key", required: true }],
          presets: [
            {
              preset: "deepseek",
              label: "DeepSeek",
              defaultBaseUrl: "https://api.deepseek.com/v1",
            },
          ],
        },
      ],
    },
  ],
};

function renderList(
  providers: readonly ProviderConnection[],
  role: "super_admin" | "analyst" = "super_admin",
) {
  const actions = {
    onEdit: vi.fn(),
    onProbe: vi.fn(),
    onToggle: vi.fn(),
    onDelete: vi.fn(),
  };
  render(<ProviderList providers={providers} catalog={catalog} role={role} {...actions} />);
  return actions;
}

describe("ProviderList", () => {
  it("renders health text, preset label and masked secret", () => {
    renderList([provider()]);
    const table = screen.getByTestId("provider-table");

    expect(within(table).getByText("DeepSeek 主账号")).toBeInTheDocument();
    expect(within(table).getByText("正常")).toBeInTheDocument();
    expect(within(table).getByText("••••1234")).toBeInTheDocument();
  });

  it("shows an honest unset key state", () => {
    renderList([provider({ secrets: [] })]);
    expect(within(screen.getByTestId("provider-table")).getByText("未设置")).toBeInTheDocument();
  });

  it("shows an actionable AUTH_FAILED reason after real delivery failures", () => {
    renderList([
      provider({
        group: "mail",
        adapter: "smtp",
        preset: "smtp",
        label: "SMTP",
        health: {
          status: "unhealthy",
          lastCheckedAt: "2026-11-27T07:00:00.000Z",
          lastErrorCode: "AUTH_FAILED",
          cooldownUntil: "2026-11-27T07:00:30.000Z",
        },
      }),
    ]);

    const table = screen.getByTestId("provider-table");
    expect(within(table).getByText("异常")).toBeInTheDocument();
    expect(
      within(table).getByText("认证失败：检查用户名、应用专用密码或 API Key。"),
    ).toBeInTheDocument();
  });

  it("disables mutations for a non-super-admin role", () => {
    renderList([provider()], "analyst");
    const table = screen.getByTestId("provider-table");

    expect(within(table).getByRole("button", { name: "编辑 DeepSeek 主账号" })).toBeDisabled();
    expect(within(table).getByRole("button", { name: "测试 DeepSeek 主账号" })).toBeDisabled();
    expect(within(table).getByRole("button", { name: "删除 DeepSeek 主账号" })).toBeDisabled();
  });

  it("edits without toggling the enable switch", async () => {
    const user = userEvent.setup();
    const actions = renderList([provider()]);
    const table = screen.getByTestId("provider-table");

    await user.click(within(table).getByRole("button", { name: "编辑 DeepSeek 主账号" }));

    expect(actions.onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ label: "DeepSeek 主账号" }),
    );
    expect(actions.onToggle).not.toHaveBeenCalled();
  });
});
