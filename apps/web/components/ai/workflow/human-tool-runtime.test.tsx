import type { ChatModelAdapter, ThreadAssistantMessagePart } from "@assistant-ui/react";
import {
  AssistantRuntimeProvider,
  AuiConfig,
  ThreadPrimitive,
  Tools,
  unstable_Interactables,
  useLocalRuntime,
} from "@assistant-ui/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useMemo } from "react";
import { describe, expect, it } from "vitest";

import { AssistantMessage, UserMessage } from "../message";
import { DraftScopeProvider } from "./draft-persistence";
import type { AskUserArgs, ConfirmBriefArgs } from "./types";
import { workflowToolkit } from ".";

/**
 * Runtime-level contract from assistant-ui `LocalRuntimeOptions`
 * (`unstable_humanToolNames`) and `ToolCallMessagePartProps.addResult`
 * (commit 4a0d2a5b9f04c8fb7ff9cd224827a958096b52dc, MIT):
 *
 * - a human tool part without `result` pauses the run;
 * - `addResult` records the answer on the part and resumes the adapter;
 * - the next render receives the same part with `result` set.
 *
 * This test deliberately exercises the real runtime instead of rendering the
 * tool component in isolation.
 */
function HumanToolHarness({
  toolName,
  args,
}: {
  toolName: "ask_user" | "confirm_brief";
  args: AskUserArgs | ConfirmBriefArgs;
}) {
  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ unstable_getMessage }) {
        const inFlight = unstable_getMessage?.();
        const answered = inFlight?.content.some(
          (part) => part.type === "tool-call" && part.result !== undefined,
        );

        if (!answered) {
          const part = {
            type: "tool-call",
            toolCallId: `${toolName}-1`,
            toolName,
            args: args as never,
            argsText: JSON.stringify(args),
          } satisfies ThreadAssistantMessagePart;
          yield {
            content: [part],
            status: { type: "requires-action", reason: "tool-calls" as const },
          };
          return;
        }

        yield {
          content: [{ type: "text", text: "回答已提交，继续处理。" }],
          status: { type: "complete", reason: "stop" as const },
        };
      },
    }),
    [args, toolName],
  );
  const runtime = useLocalRuntime(adapter, {
    unstable_humanToolNames: Object.keys(workflowToolkit),
  });
  const config = useMemo(
    () =>
      AuiConfig({
        tools: Tools({ toolkit: workflowToolkit }),
        unstable_interactables: unstable_Interactables({}),
      }),
    [],
  );

  useEffect(() => {
    runtime.thread.append("帮我规划一次旅行");
  }, [runtime]);

  return (
    <AssistantRuntimeProvider config={config} runtime={runtime}>
      <DraftScopeProvider conversationId="test-conversation">
        <ThreadPrimitive.Root>
          <ThreadPrimitive.Viewport>
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </DraftScopeProvider>
    </AssistantRuntimeProvider>
  );
}

const askUserArgs: AskUserArgs = {
  title: "补充出行需求",
  intro: "这些信息会直接影响方案。",
  questions: [
    {
      id: "destination",
      prompt: "目的地",
      kind: "text",
      placeholder: "例如：京都",
    },
  ],
};

const briefArgs: ConfirmBriefArgs = {
  title: "确认需求摘要",
  summary: "2027 年 4 月去京都，5 天，预算 8000 元。",
  constraints: ["京都", "5 天"],
  assumptions: ["从上海出发"],
};

describe("human tool runtime integration", () => {
  it("passes the ask_user tool part through message.tsx and resumes after addResult", async () => {
    const user = userEvent.setup();
    render(<HumanToolHarness args={askUserArgs} toolName="ask_user" />);

    const input = await screen.findByLabelText("目的地");
    await user.type(input, "京都");
    await user.click(screen.getByRole("button", { name: "提交回答" }));

    expect(await screen.findByTestId("ask-user-result")).toHaveTextContent("京都");
    expect(
      await screen.findByText("回答已提交，继续处理。", {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
  });

  it("renders confirm_brief through the same runtime registry", async () => {
    render(<HumanToolHarness args={briefArgs} toolName="confirm_brief" />);

    expect(await screen.findByTestId("confirm-brief-tool")).toHaveTextContent("确认需求摘要");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "确认并生成计划" })).toBeEnabled();
    });
  });
});
