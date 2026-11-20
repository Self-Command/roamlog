import type {
  ChatModelAdapter,
  ThreadAssistantMessagePart,
} from "@assistant-ui/react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useLocalRuntime,
} from "@assistant-ui/react";
import { render, screen } from "@testing-library/react";
import { useEffect, useMemo } from "react";
import { describe, expect, it } from "vitest";

import { AssistantMessage, UserMessage } from "./message";

function Harness({ content }: { content: ThreadAssistantMessagePart[] }) {
  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run() {
        yield { content, status: { type: "running" } };
        yield { content, status: { type: "complete", reason: "stop" } };
      },
    }),
    [content],
  );
  const runtime = useLocalRuntime(adapter);

  useEffect(() => {
    runtime.thread.append("hello");
  }, [runtime]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Viewport>
          <ThreadPrimitive.Messages
            components={{ UserMessage, AssistantMessage }}
          />
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function isBefore(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("AssistantMessage part ordering", () => {
  it("renders text → tool → text → reasoning in arrival order", async () => {
    const content: ThreadAssistantMessagePart[] = [
      { type: "text", text: "先看看有哪些地点。" },
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "places.search",
        args: { query: "京都" },
        argsText: JSON.stringify({ query: "京都" }),
        result: { items: [{ name: "金阁寺" }] },
      },
      { type: "text", text: "找到了金阁寺。" },
      { type: "reasoning", text: "先搜地点，再组织答案。" },
    ];

    render(<Harness content={content} />);

    const first = await screen.findByText("先看看有哪些地点。");
    const tool = screen.getByText("搜索地点");
    const second = screen.getByText("找到了金阁寺。");
    const reasoning = screen.getByTestId("message-reasoning");

    expect(isBefore(first, tool)).toBe(true);
    expect(isBefore(tool, second)).toBe(true);
    expect(isBefore(second, reasoning)).toBe(true);
    expect(screen.getByText("完成")).toBeInTheDocument();
  });

  it("renders an unknown tool through the Fallback card instead of returning null", async () => {
    const content: ThreadAssistantMessagePart[] = [
      {
        type: "tool-call",
        toolCallId: "tool-unknown",
        toolName: "unknown.tool",
        args: { arbitrary: true },
        argsText: JSON.stringify({ arbitrary: true }),
        result: { ok: true },
      },
    ];

    render(<Harness content={content} />);

    expect(await screen.findByText("unknown.tool")).toBeInTheDocument();
    expect(screen.getByText("完成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unknown.tool 完成/ })).toBeInTheDocument();
  });
});
