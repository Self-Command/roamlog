import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JournalEditor } from "./journal-editor";

const doc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "在哲学之道走到天黑。" }],
    },
  ],
};

describe("JournalEditor", () => {
  it("renders a keyboard-accessible rich text toolbar and existing content", async () => {
    const onChange = vi.fn();
    render(
      <JournalEditor
        contentJson={doc}
        onChange={onChange}
        placeholder="写下今天"
      />,
    );

    expect(await screen.findByRole("toolbar", { name: "日志格式工具栏" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "粗体" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "无序列表" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "有序列表" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "代码块" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "引用" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "添加链接" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "插入图片占位" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "日志正文" })).toHaveTextContent(
      "在哲学之道走到天黑。",
    );
  });

  it("hides the toolbar in read-only viewer mode", async () => {
    render(<JournalEditor contentJson={doc} onChange={() => {}} readOnly />);
    expect(await screen.findByRole("textbox", { name: "日志正文" })).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(screen.queryByRole("toolbar", { name: "日志格式工具栏" })).not.toBeInTheDocument();
  });
});
