import type { ChatModelAdapter } from "@assistant-ui/react";
import { AssistantRuntimeProvider, ThreadPrimitive, useLocalRuntime } from "@assistant-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, useMemo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAutoResume } from "../use-auto-resume";
import { AssistantMessage, UserMessage } from "../message";
import { EditComposer } from "../message-editor";

const WORKSPACE_ID = "018f0a00-0000-7000-8000-0000000000aa";
const CONVERSATION_ID = "018f0a00-0000-7000-8000-0000000000cc";

function frame(id: number, type: string, data: unknown): string {
  return `id: ${String(id).padStart(6, "0")}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function AutoResumeHarness() {
  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run() {
        yield { content: [{ type: "text", text: "unused" }] };
      },
    }),
    [],
  );
  const runtime = useLocalRuntime(adapter);

  useEffect(() => {
    runtime.thread.append({
      role: "user",
      content: [{ type: "text", text: "刷新前的用户消息" }],
    });
  }, [runtime]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AutoResumeProbe />
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, EditComposer }} />
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function AutoResumeProbe() {
  useAutoResume({ workspaceId: WORKSPACE_ID, conversationId: CONVERSATION_ID });
  return null;
}

describe("useAutoResume", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("probes once and resumes an active stream after history loads", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/stream/status")) {
        return new Response(
          JSON.stringify({
            active: true,
            streamId: "018f0a00-0000-7000-8000-0000000000dd",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/stream?")) {
        return new Response(
          `${frame(1, "meta", {
            type: "meta",
            v: 1,
            conversationId: CONVERSATION_ID,
            userMessageId: "user-1",
            assistantMessageId: "assistant-resumed",
            streamId: "018f0a00-0000-7000-8000-0000000000dd",
            provider: { protocol: "openai-chat", model: "auto/test" },
          })}\n${frame(2, "text.delta", {
            type: "text.delta",
            delta: "恢复的回答",
          })}\n${frame(3, "done", {
            type: "done",
            messageId: "assistant-resumed",
            finishReason: "stop",
          })}\n`,
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AutoResumeHarness />);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/stream/status"))).toBe(
        true,
      );
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/stream?"))).toBe(true);
    });
    expect(await screen.findByText("恢复的回答", {}, { timeout: 3_000 })).toBeInTheDocument();
  });
});
