import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationVisibilitySelector } from "../visibility-selector";

const WORKSPACE_ID = "018f0a00-0000-7000-8000-0000000000aa";
const CONVERSATION_ID = "018f0a00-0000-7000-8000-0000000000c1";
const SHARE_URL = `https://we.spacedo.org/share/chat/${"x".repeat(96)}`;

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    workspaceId: WORKSPACE_ID,
    userId: "018f0a00-0000-7000-8000-0000000000bb",
    title: "京都一周",
    titleSource: "manual",
    status: "regular",
    visibility: "private",
    shareUrl: null,
    lastMessageAt: null,
    createdAt: "2026-11-20T08:00:00.000Z",
    updatedAt: "2026-11-20T08:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConversationVisibilitySelector", () => {
  it("switches to public through the real API shape and exposes a copy action", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            conversation({
              visibility: "public",
              shareUrl: SHARE_URL,
            }),
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const onUpdated = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ConversationVisibilitySelector
        conversationId={CONVERSATION_ID}
        onUpdated={onUpdated}
        shareUrl={null}
        visibility="private"
        workspaceId={WORKSPACE_ID}
      />,
    );

    await user.click(screen.getByTestId("visibility-selector"));
    await user.click(screen.getByTestId("visibility-selector-item-public"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/v1/workspaces/${WORKSPACE_ID}/ai/conversations/${CONVERSATION_ID}/visibility`,
        expect.objectContaining({
          body: JSON.stringify({ visibility: "public" }),
          method: "PATCH",
        }),
      );
    });
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "public", shareUrl: SHARE_URL }),
    );
    expect(await screen.findByTestId("visibility-copy-link")).toHaveTextContent("复制公开链接");
  });

  it("keeps the menu closed and readable for a private conversation without a URL", async () => {
    const user = userEvent.setup();
    render(
      <ConversationVisibilitySelector
        conversationId={CONVERSATION_ID}
        shareUrl={null}
        visibility="private"
        workspaceId={WORKSPACE_ID}
      />,
    );

    await user.click(screen.getByTestId("visibility-selector"));
    expect(await screen.findByText("只有你可以查看这个会话")).toBeVisible();
    expect(screen.queryByTestId("visibility-copy-link")).toBeNull();
  });
});
