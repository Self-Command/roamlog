import { webcrypto } from "node:crypto";

import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AiStreamEvent } from "@roamlog/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AIHighlight } from "@/lib/editor/ai-highlight";

import { AISelector } from "./ai-selector";

/**
 * Novel's generative panel (`ai-selector.tsx` / `ai-selector-commands.tsx` /
 * `ai-completion-command.tsx` @ fa95098e…) driven against this repo's SSE client.
 *
 * `streamRewrite` is the only seam that talks to the network, so it is mocked;
 * everything else (cmdk panel, state machine, editor mutations) is real.
 */

const streamRewrite = vi.fn();

vi.mock("@/lib/ai/rewrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/rewrite")>();
  return { ...actual, streamRewrite: (...args: unknown[]) => streamRewrite(...args) };
});

const SELECTION = "早上从京都站坐车去岚山。";
const RESULT = "清早自京都站出发前往岚山。";

const editors: Editor[] = [];

function makeEditor(): Editor {
  const editor = new Editor({
    extensions: [StarterKit, Markdown, AIHighlight],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: SELECTION }],
        },
        { type: "paragraph", content: [{ type: "text", text: "后面一段。" }] },
      ],
    },
    element: document.createElement("div"),
  });
  editors.push(editor);
  // Select the whole first paragraph text (positions 1..SELECTION.length + 1).
  editor.commands.setTextSelection({ from: 1, to: SELECTION.length + 1 });
  return editor;
}

function streamOf(chunks: string[], finishReason: "stop" | "error" = "stop"): AsyncGenerator<AiStreamEvent> {
  async function* generate(): AsyncGenerator<AiStreamEvent> {
    yield {
      type: "meta",
      v: 1,
      conversationId: "0193b1b0-7c3a-7d2e-8c4a-1b2c3d4e5f60",
      userMessageId: "rewrite-user",
      assistantMessageId: "rewrite-assistant",
      provider: { protocol: "openai-chat", model: "auto/deepseek-v4.1-flash" },
    };
    for (const chunk of chunks) yield { type: "text.delta", delta: chunk };
    yield { type: "done", messageId: "rewrite-assistant", finishReason };
  }
  return generate();
}

let onOpenChange: (open: boolean) => void;

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  onOpenChange = vi.fn<(open: boolean) => void>();
  streamRewrite.mockReset();
  streamRewrite.mockImplementation(() => streamOf([RESULT]));
});

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  cleanup();
  vi.unstubAllGlobals();
});

function renderPanel(editor: Editor) {
  return render(
    <AISelector
      open
      onOpenChange={onOpenChange}
      editor={editor}
      workspaceId="ws-1"
      tripId="trip-1"
      locale="zh"
    />,
  );
}

describe("AISelector panel", () => {
  it("lists Novel's four edits in order, then Continue writing", () => {
    const editor = makeEditor();
    renderPanel(editor);

    const items = screen.getAllByRole("option").map((item) => item.textContent);
    expect(items).toEqual(["改善表达", "修正语法", "更简短", "更详细", "接着往下写"]);
    expect(screen.getByText("改写或检查选中内容")).toBeInTheDocument();
    expect(screen.getByText("用 AI 做更多")).toBeInTheDocument();
  });

  it("streams the result into the panel, then offers replace / insert below / discard", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    renderPanel(editor);

    streamRewrite.mockImplementation(() => streamOf(["清早自", "京都站出发", "前往岚山。"]));
    await user.click(screen.getByText("改善表达"));

    // Streaming: the panel fills in progressively as the deltas arrive.
    const result = await screen.findByTestId("ai-rewrite-result");
    await waitFor(() => expect(result).toHaveTextContent(RESULT));

    const actions = screen.getAllByRole("option").map((item) => item.textContent);
    expect(actions).toEqual(["替换选中内容", "插入到下方", "放弃"]);

    const [workspaceId, request] = streamRewrite.mock.calls[0] as [string, { instruction: string; text: string }];
    expect(workspaceId).toBe("ws-1");
    expect(request.instruction).toBe("improve");
    expect(request.text).toContain(SELECTION);
  });

  it("shows Novel's thinking line with a spinner and a stop button while streaming", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    renderPanel(editor);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    streamRewrite.mockImplementation(async function* held() {
      yield {
        type: "meta",
        v: 1,
        conversationId: "0193b1b0-7c3a-7d2e-8c4a-1b2c3d4e5f60",
        userMessageId: "rewrite-user",
        assistantMessageId: "rewrite-assistant",
        provider: { protocol: "openai-chat", model: "auto/deepseek-v4.1-flash" },
      } satisfies AiStreamEvent;
      await gate;
      yield { type: "text.delta", delta: RESULT };
      yield { type: "done", messageId: "rewrite-assistant", finishReason: "stop" };
    });

    await user.click(screen.getByText("改善表达"));

    expect(await screen.findByText("AI 正在思考")).toBeInTheDocument();
    // The input row is replaced while loading, exactly like upstream.
    expect(screen.queryByRole("combobox")).toBeNull();
    // Adaptation layer: upstream has no abort, the panel must still be escape-able.
    expect(screen.getByTestId("ai-rewrite-stop")).toHaveTextContent("停止");

    release();
    await waitFor(() => expect(screen.getByTestId("ai-rewrite-result")).toHaveTextContent(RESULT));
  });

  it("stops the stream on demand without writing anything", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    renderPanel(editor);

    // A held stream: the abort signal is the only way out.
    streamRewrite.mockImplementation(async function* held() {
      yield { type: "text.delta", delta: "半句" };
      await new Promise(() => {});
    });

    await user.click(screen.getByText("改善表达"));
    await screen.findByText("AI 正在思考");
    await user.click(screen.getByTestId("ai-rewrite-stop"));

    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    expect(editor.getText()).toContain(SELECTION);
    expect(editor.getText()).not.toContain("半句");
  });

  it("replaces the selection when the user accepts", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    renderPanel(editor);

    await user.click(screen.getByText("改善表达"));
    await screen.findByTestId("ai-rewrite-result");
    await user.click(await screen.findByText("替换选中内容"));

    await waitFor(() => expect(editor.getText()).toContain(RESULT));
    expect(editor.getText()).not.toContain(SELECTION);
    // Still a single paragraph plus the untouched second one.
    expect(editor.getText()).toContain("后面一段。");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("inserts below and leaves the original text in place", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    renderPanel(editor);

    await user.click(screen.getByText("改善表达"));
    await screen.findByTestId("ai-rewrite-result");
    await user.click(await screen.findByText("插入到下方"));

    await waitFor(() => expect(editor.getText()).toContain(RESULT));
    expect(editor.getText()).toContain(SELECTION);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("discards without writing and closes the panel", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    renderPanel(editor);

    await user.click(screen.getByText("改善表达"));
    await screen.findByTestId("ai-rewrite-result");
    await user.click(await screen.findByText("放弃"));

    expect(editor.getText()).toContain(SELECTION);
    expect(editor.getText()).not.toContain(RESULT);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("refuses to replace when the selection moved while the model was running", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    renderPanel(editor);

    await user.click(screen.getByText("改善表达"));
    await screen.findByTestId("ai-rewrite-result");

    // The user moves the caret to the second paragraph before accepting.
    editor.commands.setTextSelection({ from: SELECTION.length + 4, to: SELECTION.length + 7 });
    await user.click(screen.getByText("替换选中内容"));

    expect(await screen.findByRole("alert")).toHaveTextContent("原文已变化，请重试");
    expect(editor.getText()).toContain(SELECTION);
  });

  it("sends the text before the cursor for Continue writing, not the selection", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    renderPanel(editor);

    await user.click(screen.getByText("接着往下写"));

    await waitFor(() => expect(streamRewrite).toHaveBeenCalled());
    const [, request] = streamRewrite.mock.calls[0] as [
      string,
      { instruction: string; contextBefore?: string; text: string },
    ];
    expect(request.instruction).toBe("continue");
    // Upstream `getPrevText(editor, selection.from)`: the first paragraph is the
    // only block that starts before the caret.
    expect(request.contextBefore).toBe(request.text);
    expect(request.contextBefore).toContain(SELECTION);
  });

  it("iterates on the current result when the input is submitted again", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    renderPanel(editor);

    await user.click(screen.getByText("改善表达"));
    await screen.findByTestId("ai-rewrite-result");

    streamRewrite.mockImplementation(() => streamOf(["再改短一点。"]));
    await user.type(screen.getByRole("combobox"), "再短一点");
    await user.click(screen.getByTestId("ai-rewrite-submit"));

    await waitFor(() => expect(streamRewrite).toHaveBeenCalledTimes(2));
    const [, request] = streamRewrite.mock.calls[1] as [string, { instruction: string; command?: string; text: string }];
    expect(request.instruction).toBe("zap");
    expect(request.command).toBe("再短一点");
    // Novel sends the *completion* as the prompt for the second round.
    expect(request.text).toBe(RESULT);
  });

  it("shows the failure copy in the panel and can retry", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    renderPanel(editor);

    streamRewrite.mockImplementation(async function* failing() {
      yield { type: "meta", v: 1 } as never;
      yield { type: "error", code: "AI_UPSTREAM", message: "AI 服务暂时不可用", retryable: true };
      yield { type: "done", messageId: "rewrite-assistant", finishReason: "error" };
    });
    await user.click(screen.getByText("改善表达"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("AI 服务暂时不可用");
    expect(screen.getByText("重试")).toBeInTheDocument();

    streamRewrite.mockImplementation(() => streamOf([RESULT]));
    await user.click(screen.getByText("重试"));
    await waitFor(() => expect(streamRewrite).toHaveBeenCalledTimes(2));
  });

  it("highlights the selection when the input takes focus", async () => {
    const user = userEvent.setup();
    const editor = makeEditor();
    renderPanel(editor);

    await user.click(screen.getByRole("combobox"));

    expect(editor.getHTML()).toContain("<mark");
  });
});