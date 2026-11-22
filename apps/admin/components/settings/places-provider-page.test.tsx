import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  ProviderCatalog,
  ProviderConnection,
  ProviderGroupResponse,
} from "@roamlog/contracts";

import type { ProviderSettingsApi } from "../../lib/provider-settings-api";
import { ProviderGroupPage } from "./provider-group-page";

const TENCENT_ID = "0199b0c1-2200-7000-8000-000000000011";
const GEOAPIFY_ID = "0199b0c1-2200-7000-8000-000000000012";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function provider(
  input: Pick<ProviderConnection, "id" | "adapter" | "preset" | "label" | "priority" | "secrets">,
): ProviderConnection {
  return {
    ...input,
    group: "places",
    enabled: true,
    config: {
      baseUrl:
        input.adapter === "tencent"
          ? "https://apis.map.qq.com/ws"
          : "https://api.geoapify.com/v1/geocode/autocomplete",
      timeoutMs: 2_000,
      regions: input.adapter === "tencent" ? ["cn"] : ["global"],
      dailyQuota: 10_000,
      cacheTtlSeconds: 900,
    },
    version: 2,
    health: {
      status: "healthy",
      lastCheckedAt: "2026-11-22T12:00:00.000Z",
      lastErrorCode: null,
      cooldownUntil: null,
    },
    createdAt: "2026-11-22T12:00:00.000Z",
    updatedAt: "2026-11-22T12:00:00.000Z",
  };
}

const tencent = provider({
  id: TENCENT_ID,
  adapter: "tencent",
  preset: "tencent",
  label: "腾讯地图",
  priority: 10,
  secrets: [{ field: "apiKey", hasValue: true, last4: "1111", version: 1 }],
});

const geoapify = provider({
  id: GEOAPIFY_ID,
  adapter: "geoapify",
  preset: "geoapify",
  label: "Geoapify",
  priority: 20,
  secrets: [{ field: "apiKey", hasValue: true, last4: "2222", version: 1 }],
});

const placesCatalog: ProviderCatalog = {
  version: 1,
  groups: [
    {
      group: "places",
      label: "地图服务",
      routingModes: ["merge", "priority_failover"],
      adapters: [
        {
          adapter: "tencent",
          label: "腾讯位置服务",
          capabilities: ["probe", "merge", "priority"],
          configFields: [
            { key: "baseUrl", type: "url", label: "Base URL", required: true },
            {
              key: "timeoutMs",
              type: "integer",
              label: "超时（毫秒）",
              required: false,
              min: 1_000,
              max: 30_000,
              default: 2_000,
            },
            {
              key: "regions",
              type: "multi-select",
              label: "适用区域",
              required: true,
              options: [
                { value: "cn", label: "中国" },
                { value: "global", label: "全球" },
              ],
            },
            {
              key: "dailyQuota",
              type: "integer",
              label: "每日配额",
              required: false,
              min: 0,
              max: 1_000_000,
              default: 0,
            },
            {
              key: "cacheTtlSeconds",
              type: "integer",
              label: "缓存秒数",
              required: false,
              min: 60,
              max: 86_400,
              default: 900,
            },
          ],
          secretFields: [{ key: "apiKey", label: "API Key", required: true }],
          presets: [
            {
              preset: "tencent",
              label: "腾讯地图",
              defaultBaseUrl: "https://apis.map.qq.com/ws",
            },
          ],
        },
        {
          adapter: "geoapify",
          label: "Geoapify",
          capabilities: ["probe", "merge", "priority"],
          configFields: [
            { key: "baseUrl", type: "url", label: "Base URL", required: true },
            {
              key: "regions",
              type: "multi-select",
              label: "适用区域",
              required: true,
              options: [
                { value: "cn", label: "中国" },
                { value: "global", label: "全球" },
              ],
            },
          ],
          secretFields: [{ key: "apiKey", label: "API Key", required: true }],
          presets: [
            {
              preset: "geoapify",
              label: "Geoapify",
              defaultBaseUrl: "https://api.geoapify.com/v1/geocode/autocomplete",
            },
          ],
        },
        {
          adapter: "photon",
          label: "Photon",
          capabilities: ["probe", "merge", "priority"],
          configFields: [{ key: "baseUrl", type: "url", label: "Base URL", required: true }],
          secretFields: [],
          presets: [
            {
              preset: "photon",
              label: "Photon",
              defaultBaseUrl: "https://photon.komoot.io/api",
            },
          ],
        },
      ],
    },
  ],
};

function placesGroup(overrides: Partial<ProviderGroupResponse> = {}): ProviderGroupResponse {
  return {
    group: "places",
    label: "地图服务",
    routingMode: "merge",
    maxAttempts: 3,
    cooldownSeconds: 30,
    version: 4,
    providers: [tencent, geoapify],
    ...overrides,
  };
}

function apiWith(groupResponse: ProviderGroupResponse = placesGroup()): ProviderSettingsApi {
  return {
    catalog: vi.fn(async () => placesCatalog),
    group: vi.fn(async () => groupResponse),
    updatePolicy: vi.fn(async () => groupResponse),
    reorder: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    probe: vi.fn(),
    probeDraft: vi.fn(),
    discoverModels: vi.fn(),
    refreshModels: vi.fn(),
    replaceSecret: vi.fn(),
    revealSecret: vi.fn(),
  } as unknown as ProviderSettingsApi;
}

describe("Places Provider page", () => {
  it("shows Tencent and Geoapify together with independent masked credentials", async () => {
    render(<ProviderGroupPage group="places" role="super_admin" api={apiWith()} />);

    const table = await screen.findByTestId("provider-table");
    expect(within(table).getAllByText("腾讯地图").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Geoapify").length).toBeGreaterThan(0);
    expect(within(table).getByText("••••1111")).toBeInTheDocument();
    expect(within(table).getByText("••••2222")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("provider-policy-card")).getByRole("heading", {
        name: "并行召回合并",
      }),
    ).toBeInTheDocument();
  });

  it("renders map fields from the catalog instead of a hardcoded vendor form", async () => {
    const user = userEvent.setup();
    render(<ProviderGroupPage group="places" role="super_admin" api={apiWith()} />);

    await user.click(await screen.findByRole("button", { name: "添加服务商" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("适用区域")).toBeInTheDocument();
    expect(screen.getByText("每日配额")).toBeInTheDocument();
  });

  it("switches to strict failover with explanatory copy and saves the versioned policy", async () => {
    const user = userEvent.setup();
    const api = apiWith();
    const nextGroup = placesGroup({ routingMode: "priority_failover", version: 5 });
    vi.mocked(api.updatePolicy).mockResolvedValue(nextGroup);
    vi.mocked(api.group).mockResolvedValueOnce(placesGroup()).mockResolvedValue(nextGroup);

    render(<ProviderGroupPage group="places" role="super_admin" api={api} />);

    const mode = await screen.findByLabelText("路由模式");
    expect(mode).toHaveValue("merge");

    await user.selectOptions(mode, "priority_failover");
    expect(
      within(screen.getByTestId("provider-policy-card")).getByRole("status"),
    ).toHaveTextContent(/更省额度但延迟更高/);

    await user.click(screen.getByRole("button", { name: "保存路由策略" }));

    expect(api.updatePolicy).toHaveBeenCalledWith("places", {
      routingMode: "priority_failover",
      maxAttempts: 3,
      cooldownSeconds: 30,
      expectedVersion: 4,
    });
    expect(await screen.findByText("地图路由策略已保存。")).toBeInTheDocument();
  });

  it("keeps the policy controls read-only for a non-super-admin role", async () => {
    render(<ProviderGroupPage group="places" role="analyst" api={apiWith()} />);

    expect(await screen.findByLabelText("路由模式")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存路由策略" })).toBeDisabled();
  });
});
