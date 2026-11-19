import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    expect(screen.getByRole("button", { name: "插入图片" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "任务列表" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "插入表格" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "上方插入行" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "右侧插入列" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "日志正文" })).toHaveTextContent(
      "在哲学之道走到天黑。",
    );
  });

  it("inserts a table through the toolbar and keeps the JSON in sync", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<JournalEditor contentJson={doc} onChange={onChange} />);

    await user.click(await screen.findByRole("button", { name: "插入表格" }));

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getAllByRole("cell")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "删除当前行" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "删除当前列" })).toBeEnabled();

    const lastCall = onChange.mock.calls.at(-1)?.[0] as {
      contentJson: { content?: { type: string }[] };
      contentHtml: string;
    };
    expect(lastCall.contentJson.content?.some((node) => node.type === "table")).toBe(true);
    expect(lastCall.contentHtml).toContain("<table");
  });

  it("toggles a task list through the toolbar", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<JournalEditor contentJson={doc} onChange={onChange} />);

    await user.click(await screen.findByRole("button", { name: "任务列表" }));

    expect(screen.getByRole("checkbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "任务列表" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The rendered task item carries `data-checked`; the editor styles hook onto it.
    expect(document.querySelector('li[data-checked="false"]')).not.toBeNull();

    const lastCall = onChange.mock.calls.at(-1)?.[0] as {
      contentJson: { content?: { type: string }[] };
    };
    expect(lastCall.contentJson.content?.some((node) => node.type === "taskList")).toBe(true);
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
