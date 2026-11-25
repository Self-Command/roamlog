import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReasoningSelectorCompact } from "../chat-controls";
import { resetAiChatSelectionStores } from "../chat-selection";
import { resetAiChatModelStoresForTests } from "../model-selector";
import { resetAiReasoningDefaultForTests } from "../use-ai-reasoning";

const WORKSPACE_ID = "018f0a00-0000-7000-8000-0000000000aa";

function modelsResponse(reasoningSupported = true): Response {
  return new Response(
    JSON.stringify({
      defaultModel: "auto/test",
      reasoningSupported,
      models: [
        {
          id: "auto/test",
          name: "Test model",
          provider: "auto",
          reasoning: reasoningSupported,
          vision: false,
        },
      ],
    }),
    {
      headers: { "content-type": "application/json" },
      status: 200,
    },
  );
}

function installFetch(platformDefault: string, reasoningSupported = true): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/public/settings")) {
        return new Response(
          JSON.stringify({ settings: { "ai.defaultReasoningEffort": platformDefault } }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        );
      }
      return modelsResponse(reasoningSupported);
    }),
  );
}

beforeEach(() => {
  resetAiChatSelectionStores();
  resetAiChatModelStoresForTests();
  resetAiReasoningDefaultForTests();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("ReasoningSelectorCompact", () => {
  it("shows the platform default as a real effort and never exposes a default option", async () => {
    installFetch("high");
    const user = userEvent.setup();
    render(<ReasoningSelectorCompact workspaceId={WORKSPACE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("reasoning-selector-current")).toHaveTextContent("高");
    });
    await user.click(screen.getByTestId("reasoning-selector"));

    expect(screen.queryByTestId("reasoning-option-default")).not.toBeInTheDocument();
    expect(screen.queryByText("默认")).not.toBeInTheDocument();
    expect(screen.getByTestId("reasoning-option-high")).toBeInTheDocument();
  });

  it("persists a user choice in the browser across store remounts", async () => {
    installFetch("high");
    const user = userEvent.setup();
    const first = render(<ReasoningSelectorCompact workspaceId={WORKSPACE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("reasoning-selector-current")).toHaveTextContent("高");
    });
    await user.click(screen.getByTestId("reasoning-selector"));
    await user.click(screen.getByTestId("reasoning-option-medium"));

    await waitFor(() => {
      expect(screen.getByTestId("reasoning-selector-current")).toHaveTextContent("中");
    });
    first.unmount();
    resetAiChatSelectionStores();
    resetAiChatModelStoresForTests();

    render(<ReasoningSelectorCompact workspaceId={WORKSPACE_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId("reasoning-selector-current")).toHaveTextContent("中");
    });
  });

  it("uses a changed platform default when the browser has no saved choice", async () => {
    installFetch("medium");
    render(<ReasoningSelectorCompact workspaceId={WORKSPACE_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("reasoning-selector-current")).toHaveTextContent("中");
    });
  });

  it("disables the selector with user-facing copy when the model has no reasoning control", async () => {
    installFetch("high", false);
    render(<ReasoningSelectorCompact workspaceId={WORKSPACE_ID} />);

    const trigger = await screen.findByTestId("reasoning-selector");
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("title", "当前 AI 服务不支持调整思考强度");
  });
});
