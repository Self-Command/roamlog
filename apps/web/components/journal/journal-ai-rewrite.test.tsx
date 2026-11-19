import { webcrypto } from "node:crypto";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JournalAiRewrite } from "./journal-ai-rewrite";

const ORIGINAL = "在哲学之道走到天黑。";
const REWRITE = "沿哲学之道一直走到天黑。";

let editor: Editor | null = null;

function mount(text = ORIGINAL, props: Partial<Parameters<typeof JournalAiRewrite>[0]> = {}) {
  editor = new Editor({
    extensions: [StarterKit],
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  });
  const instance = editor;
  const onApplied = vi.fn();
  const view = render(
    <JournalAiRewrite editor={instance} workspaceId="ws-1" onApplied={onApplied} {...props} />,
  );
  return { editor: instance, onApplied, ...view };
}

function selectAll(instance: Editor) {
  instance.commands.setTextSelection({ from: 1, to: 1 + (instance.getText().length || 0) });
}

function rewriteResponse(replacement = REWRITE) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        replacement,
        selectionHash: "a".repeat(64),
        model: "test/model",
        usage: { inputTokens: 12, outputTokens: 9 },
      }),
  } as Response;
}

function apiError(status: number, code: string) {
  return {
    ok: false,
    status,
    text: async () =>
      JSON.stringify({
        type: "about:blank",
        title: "Error",
        status,
        code,
        instance: "/v1/workspaces/ws-1/ai/rewrite",
      }),
  } as Response;
}

beforeEach(() => {
  // jsdom ships no Web Crypto in this configuration; the control hashes the
  // selection exactly like the server does, so give it the real implementation.
  vi.stubGlobal("crypto", webcrypto);
});

afterEach(() => {
  editor?.destroy();
  editor = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("JournalAiRewrite", () => {
  it("stays visible but disabled until something is selected", async () => {
    mount();

    const entry = screen.getByRole("button", { name: /AI 改写/ });
    expect(entry).toBeVisible();
    expect(entry).toBeDisabled();
    // The reason is announced, not hidden behind a hover tooltip.
    expect(entry).toHaveAccessibleName(/先选中一段文字/);
  });

  it("enables itself as soon as a selection exists", async () => {
    const { editor: instance } = mount();
    expect(screen.getByRole("button", { name: /AI 改写/ })).toBeDisabled();

    selectAll(instance);

    expect(await screen.findByRole("button", { name: "AI 改写选中文字" })).toBeEnabled();
  });

  it("previews the rewrite as deleted/inserted text and writes only on accept", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => rewriteResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { editor: instance, onApplied } = mount();
    selectAll(instance);

    await user.click(await screen.findByRole("button", { name: "AI 改写选中文字" }));

    const panel = await screen.findByRole("dialog", { name: "AI 改写" });
    const group = within(panel).getByRole("group", { name: "选择改写方式" });
    expect(within(group).getAllByRole("button")).toHaveLength(6);
    expect(within(panel).getByRole("button", { name: "关闭预览" })).toBeInTheDocument();

    // Nothing is sent before an instruction is chosen.
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(panel).getByRole("button", { name: "润色" }));

    await within(panel).findByRole("button", { name: "接受" });
    expect(panel.querySelector("del")?.textContent).toBe("在");
    expect(panel.querySelector("ins")?.textContent).toBe("沿");
    // The document is untouched while the preview is open.
    expect(instance.getText()).toBe(ORIGINAL);

    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe("/v1/workspaces/ws-1/ai/rewrite");
    expect(JSON.parse(String(init.body))).toMatchObject({
      text: ORIGINAL,
      instruction: "polish",
    });
    expect(JSON.parse(String(init.body)).selectionHash).toHaveLength(64);

    await user.click(within(panel).getByRole("button", { name: "接受" }));

    expect(instance.getText()).toBe(REWRITE);
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the original text when the rewrite is rejected", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => rewriteResponse()));
    const { editor: instance, onApplied } = mount();
    selectAll(instance);

    await user.click(await screen.findByRole("button", { name: "AI 改写选中文字" }));
    const panel = await screen.findByRole("dialog", { name: "AI 改写" });
    await user.click(within(panel).getByRole("button", { name: "更简短" }));
    await within(panel).findByRole("button", { name: "接受" });

    await user.click(within(panel).getByRole("button", { name: "拒绝" }));

    expect(instance.getText()).toBe(ORIGINAL);
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("refuses to write when the text changed under the preview", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => rewriteResponse()));
    const { editor: instance, onApplied } = mount();
    selectAll(instance);

    await user.click(await screen.findByRole("button", { name: "AI 改写选中文字" }));
    const panel = await screen.findByRole("dialog", { name: "AI 改写" });
    await user.click(within(panel).getByRole("button", { name: "润色" }));
    await within(panel).findByRole("button", { name: "接受" });

    // Someone edits the paragraph while the preview is open.
    instance.commands.insertContentAt(1, "补一句。");

    expect(await within(panel).findByRole("alert")).toHaveTextContent("原文已变化，请重试");
    await user.click(within(panel).getByRole("button", { name: "接受" }));

    expect(instance.getText()).toBe(`补一句。${ORIGINAL}`);
    expect(onApplied).not.toHaveBeenCalled();
    expect(within(panel).getByRole("alert")).toHaveTextContent("原文已变化，请重试");
  });

  it("shows the retry copy when the server rejects the selection hash", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => apiError(422, "AI_SELECTION_HASH_MISMATCH")));
    const { editor: instance } = mount();
    selectAll(instance);

    await user.click(await screen.findByRole("button", { name: "AI 改写选中文字" }));
    const panel = await screen.findByRole("dialog", { name: "AI 改写" });
    await user.click(within(panel).getByRole("button", { name: "润色" }));

    expect(await within(panel).findByRole("alert")).toHaveTextContent("原文已变化，请重试");
    expect(within(panel).getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(instance.getText()).toBe(ORIGINAL);
  });

  it("explains a quota rejection and offers a retry", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => apiError(429, "AI_QUOTA_EXCEEDED")));
    const { editor: instance } = mount();
    selectAll(instance);

    await user.click(await screen.findByRole("button", { name: "AI 改写选中文字" }));
    const panel = await screen.findByRole("dialog", { name: "AI 改写" });
    await user.click(within(panel).getByRole("button", { name: "更正式" }));

    expect(await within(panel).findByRole("alert")).toHaveTextContent(/额度/);
  });

  it("closes on Escape without writing", async () => {
    const user = userEvent.setup();
    const { editor: instance } = mount();
    selectAll(instance);

    await user.click(await screen.findByRole("button", { name: "AI 改写选中文字" }));
    expect(await screen.findByRole("dialog", { name: "AI 改写" })).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(instance.getText()).toBe(ORIGINAL);
  });

  it("stays disabled while the entry has no workspace", async () => {
    mount(ORIGINAL, { workspaceId: null });

    const entry = screen.getByRole("button", { name: /AI 改写/ });
    expect(entry).toBeDisabled();
    expect(entry).toHaveAccessibleName(/仍在加载/);
  });
});
