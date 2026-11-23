import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiVoteProvider, useAiVoteContext } from "../ai-vote-context";

const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000002";
const CONVERSATION_A = "01942f30-1200-7000-8000-000000000003";
const CONVERSATION_B = "01942f30-1200-7000-8000-000000000004";

function Consumer() {
  const { votes, status, setVote } = useAiVoteContext();
  return (
    <div>
      <p data-testid="vote-status">{status}</p>
      <p data-testid="vote-value">{String(votes.get("message-a") ?? "none")}</p>
      <button type="button" onClick={() => void setVote("message-a", "up")}>
        vote
      </button>
    </div>
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiVoteProvider", () => {
  it("does not request votes for an unsaved thread", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AiVoteProvider workspaceId={WORKSPACE_ID} conversationId={null}>
        <Consumer />
      </AiVoteProvider>,
    );

    expect(screen.getByTestId("vote-status")).toHaveTextContent("idle");
    await act(async () => Promise.resolve());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prefetches once per remote conversation and switches state cleanly", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(CONVERSATION_A)) {
        return json([{ messageId: "message-a", isUpvoted: false }]);
      }
      return json([{ messageId: "message-a", isUpvoted: true }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <AiVoteProvider workspaceId={WORKSPACE_ID} conversationId={CONVERSATION_A}>
        <Consumer />
        <Consumer />
      </AiVoteProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("vote-status")[0]).toHaveTextContent("ready");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_A}/votes`,
    );
    expect(screen.getAllByTestId("vote-value")[0]).toHaveTextContent("false");

    rerender(
      <AiVoteProvider workspaceId={WORKSPACE_ID} conversationId={CONVERSATION_B}>
        <Consumer />
        <Consumer />
      </AiVoteProvider>,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("vote-value")[0]).toHaveTextContent("true");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_B}/votes`,
    );
  });

  it("writes a vote under the remote conversation id", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return json({ messageId: "message-a", isUpvoted: true });
      }
      return json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AiVoteProvider workspaceId={WORKSPACE_ID} conversationId={CONVERSATION_A}>
        <Consumer />
      </AiVoteProvider>,
    );

    await user.click(screen.getByRole("button", { name: "vote" }));

    await waitFor(() => {
      expect(screen.getByTestId("vote-value")).toHaveTextContent("true");
    });
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(String(patchCall?.[0])).toContain(
      `/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_A}/messages/message-a/vote`,
    );
  });
});
