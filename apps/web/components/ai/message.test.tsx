import type { ChatModelAdapter, ThreadAssistantMessagePart } from "@assistant-ui/react";
import { AssistantRuntimeProvider, ThreadPrimitive, useLocalRuntime } from "@assistant-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useMemo } from "react";
import { describe, expect, it, vi } from "vitest";

import { AssistantMessage, UserMessage } from "./message";
import { EditComposer } from "./message-editor";
import { AiVoteProvider } from "./ai-vote-context";

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
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, EditComposer }} />
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function isBefore(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("AssistantMessage part ordering", () => {
  it("renders copy, feedback, regenerate and edit actions; edit opens the composer", async () => {
    const user = userEvent.setup();
    render(<Harness content={[{ type: "text", text: "计划已经准备好。" }]} />);

    expect(await screen.findByRole("button", { name: "复制" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "有帮助" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "没帮助" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新生成" })).toBeInTheDocument();

    const edit = screen.getByRole("button", { name: "编辑消息" });
    await user.click(edit);
    expect(await screen.findByLabelText("编辑消息内容")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存并重新生成" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
  });

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

  it("persists feedback through the vote context", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ messageId: "message-id", isUpvoted: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    render(
      <AiVoteProvider
        workspaceId="01942f30-1200-7000-8000-000000000002"
        conversationId="01942f30-1200-7000-8000-000000000003"
      >
        <Harness content={[{ type: "text", text: "计划已经准备好。" }]} />
      </AiVoteProvider>,
    );

    await user.click(await screen.findByRole("button", { name: "有帮助" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/vote"),
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    expect(screen.getByRole("button", { name: "有帮助" })).toHaveAttribute("aria-pressed", "true");
  });
});
