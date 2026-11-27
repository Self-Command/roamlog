import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ProviderDraftProbeRequest, ProviderProbeResponse } from "@roamlog/contracts";

import { AdminMutationError } from "../../lib/admin-api-error";
import type { ProviderSettingsApi } from "../../lib/provider-settings-api";
import { ProviderProbePanel, type ProviderProbeSource } from "./provider-probe-panel";

const PROVIDER_ID = "0199b0c1-2200-7000-8000-000000000001";

const draftInput: ProviderDraftProbeRequest = {
  group: "ai",
  adapter: "openai-chat",
  preset: "deepseek",
  config: {
    baseUrl: "https://api.deepseek.com/v1",
    timeoutMs: 30_000,
  },
  secrets: { apiKey: "sk-draft" },
};

const okResponse: ProviderProbeResponse = {
  ok: true,
  providerId: PROVIDER_ID,
  testedAt: "2026-11-22T12:00:00.000Z",
  checks: [
    {
      name: "Credentials",
      status: "pass",
      latencyMs: null,
      code: null,
      message: null,
    },
    {
      name: "Models",
      status: "pass",
      latencyMs: 42,
      code: null,
      message: null,
    },
    {
      name: "Delivery",
      status: "skip",
      latencyMs: null,
      code: null,
      message: "Use the mail test endpoint after activation.",
    },
  ],
};

function fakeApi(): ProviderSettingsApi {
  return {
    catalog: vi.fn(),
    group: vi.fn(),
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
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function renderPanel(
  api: ProviderSettingsApi,
  source: ProviderProbeSource,
  options: {
    autoRun?: boolean;
    disabled?: boolean;
    buttonLabel?: string;
    onDismiss?: () => void;
    onComplete?: (result: ProviderProbeResponse) => void;
  } = {},
) {
  return render(
    <ProviderProbePanel
      api={api}
      source={source}
      autoRun={options.autoRun}
      disabled={options.disabled}
      buttonLabel={options.buttonLabel}
      onDismiss={options.onDismiss}
      onComplete={options.onComplete}
    />,
  );
}

describe("ProviderProbePanel", () => {
  it("calls the saved probe endpoint and reports latency and checked count", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    vi.mocked(api.probe).mockResolvedValue(okResponse);

    renderPanel(
      api,
      {
        kind: "saved",
        providerId: PROVIDER_ID,
        expectedVersion: 3,
        label: "DeepSeek 主账号",
      },
      { buttonLabel: "测试连接" },
    );
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    expect(await screen.findByText("连接正常")).toBeInTheDocument();
    expect(screen.getByText("2 项检查 · 延迟 42 ms")).toBeInTheDocument();
    expect(api.probe).toHaveBeenCalledWith(PROVIDER_ID, 3);
    expect(api.probeDraft).not.toHaveBeenCalled();
  });

  it("calls the draft probe endpoint with the current draft", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    vi.mocked(api.probeDraft).mockResolvedValue({
      ...okResponse,
      providerId: null,
    });

    renderPanel(
      api,
      { kind: "draft", input: draftInput, label: "未保存配置" },
      { buttonLabel: "测试未保存配置" },
    );
    await user.click(screen.getByRole("button", { name: "测试未保存配置" }));

    await screen.findByText("连接正常");
    expect(api.probeDraft).toHaveBeenCalledWith(draftInput);
    expect(api.probe).not.toHaveBeenCalled();
  });

  it("locks the button while a probe is in flight", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    const pending = deferred<ProviderProbeResponse>();
    vi.mocked(api.probe).mockReturnValue(pending.promise);

    renderPanel(api, {
      kind: "saved",
      providerId: PROVIDER_ID,
      expectedVersion: 3,
    });
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    expect(screen.getByRole("button", { name: "测试中…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("正在连接服务商并执行最小可用性检查");

    pending.resolve(okResponse);
    await screen.findByText("连接正常");
  });

  it("maps errors to safe copy, keeps the panel open, and supports retry", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    vi.mocked(api.probe)
      .mockRejectedValueOnce(
        new AdminMutationError({
          code: "PROVIDER_PROBE_TIMEOUT",
          status: 504,
          title: "Upstream timeout",
          detail: "Secret sk-live-must-never-render",
          degraded: [],
        }),
      )
      .mockResolvedValueOnce(okResponse);

    renderPanel(api, {
      kind: "saved",
      providerId: PROVIDER_ID,
      expectedVersion: 3,
    });
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("测试超时");
    expect(screen.queryByText(/sk-live-must-never-render/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新测试" }));
    expect(await screen.findByText("连接正常")).toBeInTheDocument();
    expect(api.probe).toHaveBeenCalledTimes(2);
  });

  it("auto-runs once for a saved provider target", async () => {
    const api = fakeApi();
    vi.mocked(api.probe).mockResolvedValue(okResponse);

    renderPanel(
      api,
      {
        kind: "saved",
        providerId: PROVIDER_ID,
        expectedVersion: 3,
      },
      { autoRun: true },
    );

    expect(await screen.findByText("连接正常")).toBeInTheDocument();
    expect(api.probe).toHaveBeenCalledTimes(1);
  });

  it("treats failed checks as an alert, not a success", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    vi.mocked(api.probe).mockResolvedValue({
      ...okResponse,
      ok: false,
      checks: [
        {
          name: "Models",
          status: "fail",
          latencyMs: 12,
          code: "AUTH_FAILED",
          message: "The provider rejected the credentials.",
        },
      ],
    });

    renderPanel(api, {
      kind: "saved",
      providerId: PROVIDER_ID,
      expectedVersion: 3,
    });
    await user.click(screen.getByRole("button", { name: "测试连接" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("测试未通过");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "认证失败：检查用户名、应用专用密码或 API Key。",
    );
    expect(screen.queryByText("连接正常")).not.toBeInTheDocument();
  });

  it("exposes an explicit dismiss action", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    const onDismiss = vi.fn();
    renderPanel(
      api,
      {
        kind: "saved",
        providerId: PROVIDER_ID,
        expectedVersion: 3,
      },
      { onDismiss },
    );

    await user.click(screen.getByRole("button", { name: "关闭测试面板" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not start a probe while disabled", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    renderPanel(
      api,
      {
        kind: "saved",
        providerId: PROVIDER_ID,
        expectedVersion: 3,
      },
      { disabled: true },
    );

    const button = screen.getByRole("button", { name: "测试连接" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(api.probe).not.toHaveBeenCalled();
  });

  it("retries after a generic network failure without exposing the raw error", async () => {
    const user = userEvent.setup();
    const api = fakeApi();
    vi.mocked(api.probeDraft)
      .mockRejectedValueOnce(new Error("socket failed with sk-raw"))
      .mockResolvedValueOnce({ ...okResponse, providerId: null });

    renderPanel(api, { kind: "draft", input: draftInput });
    await user.click(screen.getByRole("button", { name: "测试连接" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("测试没有完成，请检查配置后重试。");
    expect(screen.queryByText(/sk-raw/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新测试" }));
    await waitFor(() => expect(screen.getByText("连接正常")).toBeInTheDocument());
  });
});
