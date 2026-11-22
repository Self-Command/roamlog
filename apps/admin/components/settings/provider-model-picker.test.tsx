import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProviderDiscoveredModel, ProviderModelDiscoveryResponse } from "@roamlog/contracts";

import { AdminMutationError } from "../../lib/admin-api-error";
import type { ProviderSettingsApi } from "../../lib/provider-settings-api";
import { ProviderModelPicker, useProviderModelDiscovery } from "./provider-model-picker";

const MODELS: ProviderDiscoveredModel[] = [
  {
    modelId: "stub-model-1",
    displayName: "Stub Model One",
    ownedBy: "stub",
    capabilities: { vision: false, reasoning: false, tools: false },
  },
  {
    modelId: "stub-model-2",
    displayName: "Stub Model Two",
    ownedBy: "stub",
    capabilities: { vision: false, reasoning: false, tools: false },
  },
];

function response(
  models: ProviderDiscoveredModel[] = MODELS,
  manualEntryRequired = false,
): ProviderModelDiscoveryResponse {
  return {
    models,
    fetchedAt: "2026-11-22T12:00:00.000Z",
    manualEntryRequired,
  };
}

function fakeApi(): ProviderSettingsApi {
  return {
    discoverModels: vi.fn(async () => response()),
    refreshModels: vi.fn(async () => response()),
  } as unknown as ProviderSettingsApi;
}

function hookOptions(api: ProviderSettingsApi, overrides: Record<string, unknown> = {}) {
  return {
    api,
    enabled: true,
    group: "ai" as const,
    adapter: "openai-chat",
    preset: "custom-openai-compatible",
    baseUrl: "https://stub.example/v1",
    apiKeyDraft: "stub-key",
    hasSavedKey: false,
    ...overrides,
  };
}

async function settle(ms = 700) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useProviderModelDiscovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces, fetches, and never chooses a model automatically", async () => {
    const api = fakeApi();
    const { result } = renderHook(() => useProviderModelDiscovery(hookOptions(api)));

    expect(api.discoverModels).not.toHaveBeenCalled();
    await settle(699);
    expect(api.discoverModels).not.toHaveBeenCalled();
    await settle(1);

    expect(api.discoverModels).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
    expect(result.current.models).toEqual(MODELS);
  });

  it("aborts the previous request and ignores its late result", async () => {
    let firstSignal: AbortSignal | undefined;
    let resolveFirst: ((value: ProviderModelDiscoveryResponse) => void) | undefined;
    let resolveSecond: ((value: ProviderModelDiscoveryResponse) => void) | undefined;
    const api = fakeApi();
    vi.mocked(api.discoverModels)
      .mockImplementationOnce((_input, options) => {
        firstSignal = options?.signal;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      })
      .mockImplementationOnce((_input, options) => {
        expect(options?.signal?.aborted).toBe(false);
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      });

    const { result, rerender } = renderHook(
      ({ keySuffix }: { keySuffix: string }) =>
        useProviderModelDiscovery(hookOptions(api, { apiKeyDraft: `stub-key-${keySuffix}` })),
      { initialProps: { keySuffix: "one" } },
    );

    await settle();
    expect(firstSignal?.aborted).toBe(false);
    rerender({ keySuffix: "two" });
    expect(firstSignal?.aborted).toBe(true);

    resolveFirst?.(response([MODELS[0]!]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("loading");

    await settle();
    resolveSecond?.(response([MODELS[1]!]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.models).toEqual([MODELS[1]]);
  });

  it("maps a provider failure to actionable copy", async () => {
    const api = fakeApi();
    vi.mocked(api.discoverModels).mockRejectedValue(
      new AdminMutationError({
        code: "PROVIDER_MODELS_DISCOVERY_FAILED",
        status: 502,
        title: "Upstream failed",
        detail: "secret upstream detail must not be shown",
        degraded: [],
      }),
    );
    const { result } = renderHook(() => useProviderModelDiscovery(hookOptions(api)));

    await settle();
    expect(result.current.status).toBe("error");
    expect(result.current.message).toContain("获取模型失败");
    expect(result.current.message).not.toContain("secret upstream detail");
  });

  it("marks an empty catalog as manual-entry required", async () => {
    const api = fakeApi();
    vi.mocked(api.discoverModels).mockResolvedValue(response([], true));
    const { result } = renderHook(() => useProviderModelDiscovery(hookOptions(api)));

    await settle();
    expect(result.current.status).toBe("empty");
    expect(result.current.manualEntryRequired).toBe(true);
  });

  it("uses refreshModels for a saved provider and advances its version", async () => {
    const api = fakeApi();
    const onVersionBump = vi.fn();
    const { result } = renderHook(() =>
      useProviderModelDiscovery(
        hookOptions(api, {
          apiKeyDraft: "",
          hasSavedKey: true,
          providerId: "0199b0c1-2200-7000-8000-000000000001",
          expectedVersion: 7,
          onVersionBump,
        }),
      ),
    );

    await settle();
    expect(api.discoverModels).not.toHaveBeenCalled();
    expect(api.refreshModels).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.refresh();
    });
    expect(api.refreshModels).toHaveBeenCalledWith(
      "0199b0c1-2200-7000-8000-000000000001",
      7,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(onVersionBump).toHaveBeenCalledWith(8);
  });
});

describe("ProviderModelPicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows discovered models and changes the default only after selection", async () => {
    const api = fakeApi();
    const onChange = vi.fn();
    const onModelsChange = vi.fn();
    render(
      <ProviderModelPicker
        api={api}
        group="ai"
        adapter="openai-chat"
        preset="custom-openai-compatible"
        baseUrl="https://stub.example/v1"
        apiKeyDraft="stub-key"
        hasSavedKey={false}
        value=""
        onChange={onChange}
        onModelsChange={onModelsChange}
      />,
    );

    expect(screen.getByLabelText("默认模型")).toHaveValue("");
    await settle();
    expect(screen.getByText("已获取 2 个模型")).toBeInTheDocument();
    expect(onModelsChange).toHaveBeenLastCalledWith(MODELS);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("默认模型"));
    fireEvent.click(screen.getByRole("option", { name: /stub-model-1/ }));

    expect(onChange).toHaveBeenCalledWith("stub-model-1");
  });

  it("supports keyboard selection without auto-selecting on open", async () => {
    const api = fakeApi();
    const onChange = vi.fn();
    render(
      <ProviderModelPicker
        api={api}
        group="ai"
        adapter="openai-chat"
        preset="custom-openai-compatible"
        baseUrl="https://stub.example/v1"
        apiKeyDraft="stub-key"
        hasSavedKey={false}
        value=""
        onChange={onChange}
      />,
    );
    await settle();
    expect(onChange).not.toHaveBeenCalled();

    const input = screen.getByLabelText("默认模型");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("stub-model-1");
  });

  it("preserves a saved model that was not returned by discovery", async () => {
    const api = fakeApi();
    vi.mocked(api.discoverModels).mockResolvedValue(response([MODELS[0]!]));
    render(
      <ProviderModelPicker
        api={api}
        group="ai"
        adapter="openai-chat"
        preset="custom-openai-compatible"
        baseUrl="https://stub.example/v1"
        apiKeyDraft="stub-key"
        hasSavedKey={false}
        value="saved-model"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("默认模型")).toHaveValue("saved-model");
    await settle();
    expect(screen.getByLabelText("默认模型")).toHaveValue("saved-model");
    expect(screen.getByText(/当前模型不在本次返回的目录中/)).toBeInTheDocument();
  });

  it("offers a clearly marked manual fallback after discovery failure", async () => {
    const api = fakeApi();
    vi.mocked(api.discoverModels).mockRejectedValue(
      new AdminMutationError({
        code: "PROVIDER_MODELS_DISCOVERY_UNSUPPORTED",
        status: 422,
        title: "Unsupported",
        detail: "manual model required",
        degraded: [],
      }),
    );
    const onChange = vi.fn();
    render(
      <ProviderModelPicker
        api={api}
        group="ai"
        adapter="openai-chat"
        preset="custom-openai-compatible"
        baseUrl="https://stub.example/v1"
        apiKeyDraft="stub-key"
        hasSavedKey={false}
        value=""
        onChange={onChange}
      />,
    );
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("没有可用的模型目录");
    fireEvent.click(screen.getByRole("button", { name: "手动输入模型 ID" }));
    fireEvent.change(screen.getByLabelText("默认模型"), {
      target: { value: "manual-model" },
    });

    expect(onChange).toHaveBeenCalledWith("manual-model");
    expect(screen.getByText("手动模型未验证，保存后请先测试连接。")).toBeInTheDocument();
  });
});
