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

const PROVIDER_ID = "0199b0c1-2200-7000-8000-000000000001";

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

const provider: ProviderConnection = {
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
};

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

function group(providers: ProviderConnection[]): ProviderGroupResponse {
  return {
    group: "ai",
    label: "AI 服务",
    routingMode: "priority",
    maxAttempts: 3,
    cooldownSeconds: 30,
    version: 4,
    providers,
  };
}

function apiWith(groupResponse: ProviderGroupResponse = group([provider])): ProviderSettingsApi {
  return {
    catalog: vi.fn(async () => catalog),
    group: vi.fn(async () => groupResponse),
    updatePolicy: vi.fn(),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ProviderGroupPage", () => {
  it("shows a loading state while the group is pending", async () => {
    const pendingGroup = deferred<ProviderGroupResponse>();
    const pendingCatalog = deferred<ProviderCatalog>();
    const api = apiWith();
    vi.mocked(api.group).mockReturnValue(pendingGroup.promise);
    vi.mocked(api.catalog).mockReturnValue(pendingCatalog.promise);

    render(<ProviderGroupPage group="ai" role="super_admin" api={api} />);

    expect(screen.getByLabelText("正在加载服务商配置")).toHaveAttribute("aria-busy", "true");
    pendingCatalog.resolve(catalog);
    pendingGroup.resolve(group([provider]));
    const table = await screen.findByTestId("provider-table");
    expect(within(table).getByText("DeepSeek 主账号")).toBeInTheDocument();
  });

  it("shows the empty state when no provider exists", async () => {
    render(<ProviderGroupPage group="ai" role="super_admin" api={apiWith(group([]))} />);

    expect(await screen.findByText("还没有配置 AI 服务")).toBeInTheDocument();
  });

  it("shows an error with retry", async () => {
    const user = userEvent.setup();
    const api = apiWith();
    vi.mocked(api.catalog)
      .mockRejectedValueOnce(new Error("网络断开"))
      .mockResolvedValueOnce(catalog);
    vi.mocked(api.group).mockResolvedValue(group([provider]));

    render(<ProviderGroupPage group="ai" role="super_admin" api={api} />);
    expect(await screen.findByText("网络断开")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新加载" }));
    const table = await screen.findByTestId("provider-table");
    expect(within(table).getByText("DeepSeek 主账号")).toBeInTheDocument();
  });

  it("renders the list, summary and routing policy", async () => {
    render(<ProviderGroupPage group="ai" role="super_admin" api={apiWith()} />);

    const table = await screen.findByTestId("provider-table");
    expect(within(table).getByText("DeepSeek 主账号")).toBeInTheDocument();
    expect(screen.getByText("1 个服务商")).toBeInTheDocument();
    expect(screen.getByText("1 个正常")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "优先级回退" })).toBeInTheDocument();
  });

  it("does not open the editor until the add CTA is pressed", async () => {
    const user = userEvent.setup();
    render(<ProviderGroupPage group="ai" role="super_admin" api={apiWith()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "添加服务商" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "添加服务商" })).toBeInTheDocument();
  });

  it("keeps mutation actions disabled for a read-only role", async () => {
    render(<ProviderGroupPage group="ai" role="analyst" api={apiWith()} />);

    expect(await screen.findByRole("button", { name: "添加服务商" })).toBeDisabled();
    const table = screen.getByTestId("provider-table");
    expect(within(table).getByRole("button", { name: "编辑 DeepSeek 主账号" })).toBeDisabled();
  });

  it("opens the probe panel and runs the saved provider probe", async () => {
    const user = userEvent.setup();
    const api = apiWith();
    vi.mocked(api.probe).mockResolvedValue({
      ok: true,
      providerId: PROVIDER_ID,
      testedAt: "2026-11-22T12:10:00.000Z",
      checks: [
        {
          name: "Models",
          status: "pass",
          latencyMs: 31,
          code: null,
          message: null,
        },
      ],
    });

    render(<ProviderGroupPage group="ai" role="super_admin" api={api} />);
    const table = await screen.findByTestId("provider-table");

    await user.click(within(table).getByRole("button", { name: "测试 DeepSeek 主账号" }));

    expect(await screen.findByText("连接正常")).toBeInTheDocument();
    expect(api.probe).toHaveBeenCalledWith(PROVIDER_ID, 1);
  });

  it("confirms provider deletion through the destructive action dialog", async () => {
    const user = userEvent.setup();
    const api = apiWith();
    vi.mocked(api.remove).mockResolvedValue();

    render(<ProviderGroupPage group="ai" role="super_admin" api={api} />);
    const table = await screen.findByTestId("provider-table");
    await user.click(within(table).getByRole("button", { name: "删除 DeepSeek 主账号" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("删除服务商");
    expect(api.remove).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText("输入服务商名称确认"), "DeepSeek 主账号");
    await user.click(within(dialog).getByRole("button", { name: "确认删除" }));

    expect(api.remove).toHaveBeenCalledWith(PROVIDER_ID, 1);
  });
});
