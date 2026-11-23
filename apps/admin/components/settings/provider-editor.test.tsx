import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  ProviderCatalogGroup,
  ProviderConnection,
  ProviderSecretState,
} from "@roamlog/contracts";

import { AdminMutationError } from "../../lib/admin-api-error";
import { AdminSettingsError } from "../../lib/admin-settings-api";
import type { ProviderSettingsApi } from "../../lib/provider-settings-api";
import { ProviderEditor } from "./provider-editor";

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

const catalogGroup: ProviderCatalogGroup = {
  group: "ai",
  label: "AI 服务",
  routingModes: ["priority"],
  adapters: [
    {
      adapter: "openai-chat",
      label: "OpenAI Chat Completions",
      capabilities: ["model_discovery", "probe", "priority"],
      configFields: [
        {
          key: "baseUrl",
          type: "url",
          label: "Base URL",
          required: true,
        },
        {
          key: "defaultModel",
          type: "model",
          label: "默认模型",
          required: false,
        },
        {
          key: "timeoutMs",
          type: "integer",
          label: "超时（毫秒）",
          required: false,
          min: 1_000,
          max: 120_000,
          default: 60_000,
        },
        {
          key: "reasoningEffort",
          type: "select",
          label: "推理强度",
          required: false,
          options: [
            { value: "low", label: "low" },
            { value: "medium", label: "medium" },
            { value: "high", label: "high" },
          ],
        },
      ],
      secretFields: [{ key: "apiKey", label: "API Key", required: true }],
      presets: [
        {
          preset: "deepseek",
          label: "DeepSeek",
          defaultBaseUrl: "https://api.deepseek.com/v1",
        },
        {
          preset: "custom-openai-compatible",
          label: "自定义 OpenAI 兼容服务",
          defaultBaseUrl: null,
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
    timeoutMs: 60_000,
  },
  version: 3,
  secrets: [{ field: "apiKey", hasValue: true, last4: "1234", version: 2 }],
  health: {
    status: "healthy",
    lastCheckedAt: "2026-11-22T12:00:00.000Z",
    lastErrorCode: null,
    cooldownUntil: null,
  },
  createdAt: "2026-11-22T12:00:00.000Z",
  updatedAt: "2026-11-22T12:00:00.000Z",
};

function createdProvider(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    ...provider,
    label: "DeepSeek 主账号",
    version: 1,
    secrets: [{ field: "apiKey", hasValue: true, last4: "test", version: 1 }],
    ...overrides,
  };
}

function fakeApi(): ProviderSettingsApi {
  return {
    catalog: vi.fn(),
    group: vi.fn(),
    updatePolicy: vi.fn(),
    reorder: vi.fn(),
    create: vi.fn(async () => createdProvider()),
    update: vi.fn(async () => ({ ...provider, version: 4 })),
    remove: vi.fn(),
    probe: vi.fn(),
    probeDraft: vi.fn(),
    discoverModels: vi.fn(async () => ({
      models: [],
      fetchedAt: "2026-11-22T12:00:00.000Z",
      manualEntryRequired: true,
    })),
    refreshModels: vi.fn(async () => ({
      models: [],
      fetchedAt: "2026-11-22T12:00:00.000Z",
      manualEntryRequired: true,
    })),
    replaceSecret: vi.fn(async (): Promise<ProviderSecretState> => ({
      field: "apiKey",
      hasValue: true,
      last4: "test",
      version: 3,
    })),
    revealSecret: vi.fn(),
  } as unknown as ProviderSettingsApi;
}

function renderEditor(
  options: {
    api?: ProviderSettingsApi;
    provider?: ProviderConnection | null;
    onOpenChange?: ReturnType<typeof vi.fn>;
    onSaved?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const api = options.api ?? fakeApi();
  const onOpenChange = options.onOpenChange ?? vi.fn();
  const onSaved = options.onSaved ?? vi.fn(async () => undefined);
  render(
    <ProviderEditor
      open
      group="ai"
      catalogGroup={catalogGroup}
      provider={options.provider ?? null}
      groupVersion={4}
      api={api}
      onOpenChange={onOpenChange as (open: boolean) => void}
      onSaved={onSaved as (provider: ProviderConnection) => void | Promise<void>}
    />,
  );
  return { api, onOpenChange, onSaved };
}

async function fillRequiredCreateFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/名称/), "DeepSeek 主账号");
  await user.type(screen.getByLabelText(/API Key/), "sk-test");
}

describe("ProviderEditor", () => {
  it("renders catalog fields and validates required values", async () => {
    const user = userEvent.setup();
    const { api } = renderEditor();

    expect(screen.getByRole("heading", { name: "添加服务商" })).toBeInTheDocument();
    expect(screen.getByLabelText(/名称/)).toBeInTheDocument();
    expect(screen.getByLabelText(/类型/)).toHaveValue("openai-chat::deepseek");
    expect(screen.getByLabelText(/Base URL/)).toHaveValue("https://api.deepseek.com/v1");
    expect(screen.getByLabelText("默认模型")).toHaveValue("");
    expect(screen.getByLabelText("超时（毫秒）")).toHaveValue(60_000);

    await user.click(screen.getByRole("button", { name: "保存服务商" }));

    expect(screen.getByText("请输入服务商名称。")).toBeInTheDocument();
    expect(screen.getByText("API Key不能为空。")).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("validates integer bounds without native browser validation", async () => {
    const user = userEvent.setup();
    const { api } = renderEditor();

    await fillRequiredCreateFields(user);
    const timeout = screen.getByLabelText("超时（毫秒）");
    await user.clear(timeout);
    await user.type(timeout, "100");
    await user.click(screen.getByRole("button", { name: "保存服务商" }));

    expect(screen.getByText("超时（毫秒）不能小于 1000。")).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("sends initial secrets only in create and leaves a failed create open", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    vi.mocked(api.create).mockRejectedValueOnce(
      new AdminSettingsError(
        {
          code: "PROVIDER_CONFIG_INVALID",
          status: 400,
          title: "配置无效",
          detail: "请检查服务商名称。",
          degraded: [],
        },
        [{ field: "label", code: "REQUIRED", message: "名称已被占用。" }],
      ),
    );
    const { onSaved } = renderEditor({ api });

    await fillRequiredCreateFields(user);
    await user.click(screen.getByRole("button", { name: "保存服务商" }));

    await screen.findByText("名称已被占用。");
    expect(screen.getByLabelText(/名称/)).toHaveValue("DeepSeek 主账号");
    expect(screen.getByLabelText(/API Key/)).toHaveValue("sk-test");
    expect(onSaved).not.toHaveBeenCalled();
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        group: "ai",
        adapter: "openai-chat",
        preset: "deepseek",
        label: "DeepSeek 主账号",
        expectedGroupVersion: 4,
        secrets: { apiKey: "sk-test" },
      }),
    );
    expect(api.update).not.toHaveBeenCalled();
  });

  it("saves create with secrets in the POST body", async () => {
    const user = userEvent.setup();
    const { api, onOpenChange, onSaved } = renderEditor();

    await fillRequiredCreateFields(user);
    await user.click(screen.getByRole("button", { name: "保存服务商" }));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const input = vi.mocked(api.create).mock.calls[0]?.[0];
    expect(input).toMatchObject({
      group: "ai",
      adapter: "openai-chat",
      preset: "deepseek",
      label: "DeepSeek 主账号",
      config: {
        baseUrl: "https://api.deepseek.com/v1",
        timeoutMs: 60_000,
      },
      secrets: { apiKey: "sk-test" },
    });
    expect(input).not.toHaveProperty("patch");
    expect(api.refreshModels).toHaveBeenCalledWith(PROVIDER_ID, 1);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(api.update).not.toHaveBeenCalled();
  });

  it("keeps create draft values when a draft probe fails", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    vi.mocked(api.probeDraft).mockRejectedValueOnce(
      new AdminMutationError({
        code: "PROVIDER_PROBE_TIMEOUT",
        status: 504,
        title: "Upstream timeout",
        detail: "raw provider response must not replace the form",
        degraded: [],
      }),
    );
    renderEditor({ api });

    await fillRequiredCreateFields(user);
    await user.click(screen.getByRole("button", { name: "测试未保存配置" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("测试超时");
    expect(screen.getByLabelText(/名称/)).toHaveValue("DeepSeek 主账号");
    expect(screen.getByLabelText(/API Key/)).toHaveValue("sk-test");
    expect(api.create).not.toHaveBeenCalled();
  });

  it("uses PATCH without secrets and the dedicated secret endpoint on edit", async () => {
    const user = userEvent.setup();
    const { api, onSaved } = renderEditor({ provider });

    const name = screen.getByLabelText(/名称/);
    await user.clear(name);
    await user.type(name, "DeepSeek 主账号（更新）");
    await user.type(screen.getByLabelText(/API Key/), "sk-new");
    await user.click(screen.getByRole("button", { name: "保存服务商" }));

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    const updateInput = vi.mocked(api.update).mock.calls[0]?.[1];
    expect(updateInput).toMatchObject({
      label: "DeepSeek 主账号（更新）",
      expectedVersion: 3,
    });
    expect(updateInput).not.toHaveProperty("secrets");
    await waitFor(() =>
      expect(api.replaceSecret).toHaveBeenCalledWith(PROVIDER_ID, "apiKey", {
        value: "sk-new",
        expectedVersion: 4,
      }),
    );
    expect(api.refreshModels).toHaveBeenCalledWith(PROVIDER_ID, 5);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("requires confirmation before closing a dirty editor", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderEditor();

    await user.type(screen.getByLabelText(/名称/), "Draft");
    await user.click(screen.getByRole("button", { name: "关闭" }));

    expect(screen.getByText("放弃未保存的修改？")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.queryByText("放弃未保存的修改？")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关闭" }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes an untouched editor without confirmation", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderEditor();

    await user.click(screen.getByRole("button", { name: "关闭" }));

    expect(screen.queryByText("放弃未保存的修改？")).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
