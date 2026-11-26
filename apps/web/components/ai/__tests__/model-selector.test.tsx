import type { AiChatModelsResponse } from "@roamlog/contracts";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aiChatSelectionStore, resetAiChatSelectionStores } from "../chat-selection";
import { ModelSelectorCompact, resetAiChatModelStoresForTests } from "../model-selector";

const WORKSPACE_ID = "018f0a00-0000-7000-8000-0000000000aa";

const MODELS: AiChatModelsResponse = {
  defaultModel: "deepseek/deepseek-chat",
  reasoningSupported: true,
  models: [
    {
      description: "通用对话模型",
      id: "deepseek/deepseek-chat",
      name: "DeepSeek Chat",
      provider: "deepseek",
      reasoning: true,
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      vision: false,
    },
    {
      description: "多模态旗舰",
      id: "openai/gpt-5",
      name: "GPT-5",
      provider: "openai",
      reasoning: true,
      reasoningEfforts: ["minimal", "low", "medium", "high"],
      vision: true,
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function clearModelCookie(): void {
  document.cookie = "chat-model=; path=/; max-age=0; SameSite=Lax";
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resetAiChatModelStoresForTests();
  resetAiChatSelectionStores();
  clearModelCookie();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearModelCookie();
});

describe("ModelSelectorCompact", () => {
  it("searches by model, groups by provider, and persists the selection", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(MODELS));
    render(<ModelSelectorCompact workspaceId={WORKSPACE_ID} />);

    const trigger = await screen.findByTestId("model-selector");
    await waitFor(() => {
      expect(screen.getByTestId("model-selector-current")).toHaveTextContent("DeepSeek Chat");
    });
    await user.click(trigger);

    expect(await screen.findByText("DeepSeek")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByTestId("model-option-openai/gpt-5")).toBeInTheDocument();

    await user.type(screen.getByLabelText("搜索 AI 模型"), "gpt");
    await waitFor(() => {
      expect(screen.getByTestId("model-option-openai/gpt-5")).toBeInTheDocument();
      expect(screen.queryByTestId("model-option-deepseek/deepseek-chat")).not.toBeInTheDocument();
    });

    await user.click(screen.getByTestId("model-option-openai/gpt-5"));

    expect(aiChatSelectionStore(WORKSPACE_ID).get().model).toBe("openai/gpt-5");
    expect(document.cookie).toContain("chat-model=openai%2Fgpt-5");
    await waitFor(() => {
      expect(screen.getByTestId("model-selector-current")).toHaveTextContent("GPT-5");
    });
  });

  it("restores the saved chat-model cookie after a reload", async () => {
    document.cookie = "chat-model=openai%2Fgpt-5; path=/; SameSite=Lax";
    fetchMock.mockResolvedValue(jsonResponse(MODELS));

    render(<ModelSelectorCompact workspaceId={WORKSPACE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("model-selector-current")).toHaveTextContent("GPT-5");
    });
    expect(aiChatSelectionStore(WORKSPACE_ID).get().model).toBe("openai/gpt-5");
  });

  it("supports keyboard search and selection", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(MODELS));
    render(<ModelSelectorCompact workspaceId={WORKSPACE_ID} />);

    await user.click(await screen.findByTestId("model-selector"));
    const search = await screen.findByLabelText("搜索 AI 模型");
    await user.type(search, "gpt");
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => {
      expect(aiChatSelectionStore(WORKSPACE_ID).get().model).toBe("openai/gpt-5");
    });
  });

  it("clamps a saved reasoning tier when switching to a model with fewer tiers", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(MODELS));
    const store = aiChatSelectionStore(WORKSPACE_ID);
    store.set({ model: "deepseek/deepseek-chat", reasoningEffort: "max" });

    render(<ModelSelectorCompact workspaceId={WORKSPACE_ID} />);
    await user.click(await screen.findByTestId("model-selector"));
    await user.click(await screen.findByTestId("model-option-openai/gpt-5"));

    await waitFor(() => {
      expect(store.get().model).toBe("openai/gpt-5");
      expect(store.get().reasoningEffort).toBe("high");
    });
  });

  it("shows a retry action when the model request fails", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(jsonResponse(MODELS));

    render(<ModelSelectorCompact workspaceId={WORKSPACE_ID} />);
    await user.click(await screen.findByTestId("model-selector"));

    expect(await screen.findByText("暂时无法获取可用模型。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新加载" }));

    expect(await screen.findByText("DeepSeek")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
