import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  ProviderCatalogGroup,
  ProviderConfigField,
  ProviderConnection,
  ProviderModel,
} from "@roamlog/contracts";

import type { ProviderSettingsApi } from "../../lib/provider-settings-api";
import { ProviderEditor } from "./provider-editor";
import { ProviderPolicyCard } from "./provider-policy-card";

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

const PROVIDER_ID = "0199b0c1-2200-7000-8000-000000000001";
const NOW = "2026-11-22T12:00:00.000Z";

const configFields: ProviderConfigField[] = [
  { key: "baseUrl", type: "url", label: "Base URL", required: true },
  { key: "defaultModel", type: "model", label: "默认模型", required: false },
  {
    key: "timeoutMs",
    type: "integer",
    label: "超时（毫秒）",
    required: false,
    min: 1_000,
    max: 120_000,
    default: 60_000,
  },
];

const secretFields = [{ key: "apiKey", label: "API Key", required: true }];

const catalogGroup: ProviderCatalogGroup = {
  group: "ai",
  label: "AI 服务",
  routingModes: ["priority"],
  adapters: [
    {
      adapter: "openai-chat",
      label: "OpenAI Chat Completions",
      capabilities: ["model_discovery", "probe", "priority"],
      configFields,
      secretFields,
      presets: [
        { preset: "openai", label: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1" },
        { preset: "deepseek", label: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com/v1" },
        {
          preset: "openrouter",
          label: "OpenRouter",
          defaultBaseUrl: "https://openrouter.ai/api/v1",
        },
        { preset: "groq", label: "Groq", defaultBaseUrl: "https://api.groq.com/openai/v1" },
        {
          preset: "together",
          label: "Together",
          defaultBaseUrl: "https://api.together.xyz/v1",
        },
        {
          preset: "gemini-openai",
          label: "Gemini（OpenAI 兼容）",
          defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
        },
        {
          preset: "custom-openai-compatible",
          label: "自定义 OpenAI 兼容服务",
          defaultBaseUrl: null,
        },
      ],
    },
    {
      adapter: "anthropic-messages",
      label: "Anthropic Messages",
      capabilities: ["model_discovery", "probe", "priority"],
      configFields,
      secretFields,
      presets: [
        {
          preset: "anthropic",
          label: "Anthropic",
          defaultBaseUrl: "https://api.anthropic.com/v1",
        },
      ],
    },
    {
      adapter: "openai-responses",
      label: "OpenAI Responses",
      capabilities: ["model_discovery", "probe", "priority"],
      configFields,
      secretFields,
      presets: [
        {
          preset: "openai-responses",
          label: "OpenAI Responses",
          defaultBaseUrl: "https://api.openai.com/v1",
        },
      ],
    },
  ],
};

const provider: ProviderConnection = {
  id: PROVIDER_ID,
  group: "ai",
  adapter: "openai-chat",
  preset: "deepseek",
  label: "DeepSeek 主账号",
  enabled: true,
  priority: 10,
  config: {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    timeoutMs: 60_000,
  },
  version: 3,
  secrets: [{ field: "apiKey", hasValue: true, last4: "1234", version: 2 }],
  health: {
    status: "healthy",
    lastCheckedAt: NOW,
    lastErrorCode: null,
    cooldownUntil: null,
  },
  createdAt: NOW,
  updatedAt: NOW,
};

const discovered = {
  models: [
    {
      modelId: "deepseek-chat",
      displayName: "DeepSeek Chat",
      ownedBy: "deepseek",
      capabilities: { vision: false, reasoning: true, tools: false },
    },
    {
      modelId: "deepseek-reasoner",
      displayName: "DeepSeek Reasoner",
      ownedBy: "deepseek",
      capabilities: { vision: false, reasoning: true, tools: false },
    },
  ],
  fetchedAt: NOW,
  manualEntryRequired: false,
};

const providerModel: ProviderModel = {
  id: "0199b0c1-2200-7000-8000-000000000099",
  providerId: PROVIDER_ID,
  modelId: "deepseek-chat",
  displayName: "DeepSeek Chat",
  ownedBy: "deepseek",
  enabled: true,
  isDefault: true,
  capabilities: { vision: true, reasoning: true, tools: false },
  discoveredAt: NOW,
  updatedAt: NOW,
};

function fakeApi(): ProviderSettingsApi {
  return {
    refreshModels: vi.fn(async () => discovered),
    updateModel: vi.fn(async () => providerModel),
  } as unknown as ProviderSettingsApi;
}

describe("AI provider page integration", () => {
  it("shows the frozen vendor presets and keeps adapter ids in advanced diagnostics", () => {
    render(
      <ProviderEditor
        open
        group="ai"
        catalogGroup={catalogGroup}
        provider={provider}
        groupVersion={5}
        api={fakeApi()}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const typeSelect = screen.getByLabelText(/类型/);
    const optionNames = within(typeSelect)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(optionNames).toEqual(
      expect.arrayContaining([
        "OpenAI",
        "DeepSeek",
        "OpenRouter",
        "Groq",
        "Together",
        "Gemini（OpenAI 兼容）",
        "Anthropic",
        "OpenAI Responses",
        "自定义 OpenAI 兼容服务",
      ]),
    );
    expect(optionNames.some((name) => name?.includes("openai-chat"))).toBe(false);

    fireEvent.click(screen.getByText("高级诊断"));
    expect(screen.getByText("openai-chat")).toBeInTheDocument();
    expect(screen.getByText("deepseek")).toBeInTheDocument();
  });

  it("loads models with the saved key and persists an explicit capability toggle", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    render(
      <ProviderEditor
        open
        group="ai"
        catalogGroup={catalogGroup}
        provider={provider}
        groupVersion={5}
        api={api}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const refresh = screen.getByRole("button", { name: "获取模型" });
    expect(refresh).toBeEnabled();
    await user.click(refresh);
    await waitFor(() => expect(api.refreshModels).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("已获取 2 个模型")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "图片输入" })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("switch", { name: "图片输入" }));
    await waitFor(() =>
      expect(api.updateModel).toHaveBeenCalledWith(PROVIDER_ID, "deepseek-chat", {
        capabilities: { vision: true, reasoning: true, tools: false },
        expectedVersion: 4,
      }),
    );
  });

  it("allows AI attempt and cooldown policy edits while keeping priority routing fixed", async () => {
    const user = userEvent.setup();
    const updatePolicy = vi.fn(async () => ({
      group: "ai" as const,
      label: "AI 服务",
      routingMode: "priority" as const,
      maxAttempts: 4,
      cooldownSeconds: 0,
      version: 6,
      providers: [provider],
    }));
    const api = { updatePolicy } as unknown as ProviderSettingsApi;

    render(
      <ProviderPolicyCard
        group="ai"
        role="super_admin"
        data={{
          group: "ai",
          label: "AI 服务",
          routingMode: "priority",
          maxAttempts: 3,
          cooldownSeconds: 30,
          version: 5,
          providers: [provider],
        }}
        routingModes={["priority"]}
        api={api}
        onSaved={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    expect(screen.getByText(/流式响应开始后不切换/)).toBeInTheDocument();
    expect(screen.getByLabelText("路由模式")).toBeDisabled();

    const attempts = screen.getAllByRole("spinbutton")[0]!;
    const cooldown = screen.getAllByRole("spinbutton")[1]!;
    await user.clear(attempts);
    await user.type(attempts, "4");
    await user.clear(cooldown);
    await user.type(cooldown, "0");
    await user.click(screen.getByRole("button", { name: "保存路由策略" }));

    await waitFor(() =>
      expect(updatePolicy).toHaveBeenCalledWith("ai", {
        routingMode: "priority",
        maxAttempts: 4,
        cooldownSeconds: 0,
        expectedVersion: 5,
      }),
    );
  });
});
