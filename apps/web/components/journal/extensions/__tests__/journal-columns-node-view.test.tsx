import { Editor, type Content, type JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getColumnsSelectionInfo,
  JournalColumnsBubble,
  JournalColumnsInsertMenu,
  shouldShowColumnsBubble,
} from "../journal-columns-bubble";
import { JournalColumn, JournalColumns } from "../journal-columns";

vi.mock("@tiptap/react/menus", async () => {
  const React = await import("react");

  return {
    BubbleMenu: (props: {
      editor: Editor;
      children: React.ReactNode;
      shouldShow?: (input: {
        editor: Editor;
        state: Editor["state"];
        view: Editor["view"];
        from: number;
        to: number;
        element: HTMLElement;
      }) => boolean;
      role?: string;
      "aria-label"?: string;
      className?: string;
    }) => {
      const visible =
        props.shouldShow?.({
          editor: props.editor,
          state: props.editor.state,
          view: props.editor.view,
          from: props.editor.state.selection.from,
          to: props.editor.state.selection.to,
          element: document.createElement("div"),
        }) ?? true;

      if (!visible) return null;

      return React.createElement(
        "div",
        {
          role: props.role,
          "aria-label": props["aria-label"],
          className: props.className,
        },
        props.children,
      );
    },
  };
});

const editors: Editor[] = [];

function columnsDocument(labels: string[], leadingParagraph = false): Content {
  return {
    type: "doc",
    content: [
      ...(leadingParagraph
        ? [{ type: "paragraph", content: [{ type: "text", text: "Outside" }] }]
        : []),
      {
        type: "columns",
        attrs: { columns: labels.length },
        content: labels.map((label, index) => ({
          type: "column",
          attrs: { index },
          content: [
            {
              type: "paragraph",
              ...(label ? { content: [{ type: "text", text: label }] } : {}),
            },
          ],
        })),
      },
    ],
  } as Content;
}

function makeEditor(content: Content, editable = true): Editor {
  const editor = new Editor({
    extensions: [StarterKit, JournalColumn, JournalColumns],
    content,
    editable,
    element: document.createElement("div"),
  });
  editors.push(editor);
  return editor;
}

function selectText(editor: Editor, text: string): void {
  let target: number | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (target === null && node.isText && node.text === text) {
      target = pos + 1;
      return false;
    }
    return target === null;
  });

  if (target === null) throw new Error(`Text not found: ${text}`);
  editor.commands.setTextSelection(target);
}

function columnsNode(editor: Editor): JSONContent | null {
  return (
    (editor.getJSON().content?.find((node) => node.type === "columns") as
      JSONContent | undefined) ?? null
  );
}

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("JournalColumnsNodeView", () => {
  it("renders the responsive flex layout without changing serialized HTML", async () => {
    const editor = makeEditor(columnsDocument(["Left", "Middle", "Right"]));
    const { container } = render(<EditorContent editor={editor} />);

    const columns = await waitFor(() => {
      const element = container.querySelector('[data-node-view-wrapper][data-type="columns"]');
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    expect(columns).toHaveAttribute("data-columns", "3");
    expect(columns.querySelectorAll('[data-node-view-wrapper][data-type="column"]')).toHaveLength(
      3,
    );
    expect(
      columns.querySelectorAll(".react-renderer.node-column.min-\\[769px\\]\\:flex-1"),
    ).toHaveLength(3);
    expect(columns.innerHTML).toContain("min-[769px]:flex-row");
    expect(columns.innerHTML).toContain("flex-1");

    const html = editor.getHTML();
    expect(html).toContain('<div data-type="columns" data-columns="3">');
    expect(html).toContain('<div data-type="column" data-column-index="0">');
    expect(html).not.toContain("data-node-view-wrapper");
    expect(html).not.toMatch(/\sclass=/);
    expect(html).not.toMatch(/\sstyle=/);
  });
});

describe("JournalColumnsBubble", () => {
  it("shows only when the cursor is inside columns and displays the active column", async () => {
    const editor = makeEditor(columnsDocument(["Left", "Middle", "Right"], true));
    const rendered = render(<JournalColumnsBubble editor={editor} />);

    expect(getColumnsSelectionInfo(editor).total).toBeNull();
    expect(shouldShowColumnsBubble(editor)).toBe(false);

    act(() => selectText(editor, "Middle"));
    rendered.rerender(<JournalColumnsBubble editor={editor} />);

    const toolbar = await screen.findByRole("toolbar", { name: "多栏工具" });
    expect(toolbar).toHaveTextContent("2 / 3 栏");
    expect(screen.getByRole("button", { name: "左侧加列" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "右侧加列" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "删除当前列" })).toBeEnabled();
  });

  it("keeps the bubble mounted across a transaction while inside columns", async () => {
    const editor = makeEditor(columnsDocument(["Left", "Middle", "Right"]));
    act(() => selectText(editor, "Middle"));
    const rendered = render(<JournalColumnsBubble editor={editor} />);

    expect(await screen.findByRole("toolbar", { name: "多栏工具" })).toBeInTheDocument();

    act(() => selectText(editor, "Middle"));
    rendered.rerender(<JournalColumnsBubble editor={editor} />);

    expect(screen.getByRole("toolbar", { name: "多栏工具" })).toHaveTextContent("2 / 3 栏");
    expect(screen.getByRole("button", { name: "右侧加列" })).toBeEnabled();
  });

  it("adds a column on the left and right side", () => {
    const editor = makeEditor(columnsDocument(["Left", "Right"]));
    act(() => selectText(editor, "Right"));
    const rendered = render(<JournalColumnsBubble editor={editor} />);

    fireEvent.click(screen.getByRole("button", { name: "左侧加列" }));
    rendered.rerender(<JournalColumnsBubble editor={editor} />);
    expect(columnsNode(editor)?.attrs).toEqual({ columns: 3 });
    expect(columnsNode(editor)?.content?.[1]?.content).toEqual([{ type: "paragraph" }]);

    act(() => selectText(editor, "Left"));
    fireEvent.click(screen.getByRole("button", { name: "右侧加列" }));
    rendered.rerender(<JournalColumnsBubble editor={editor} />);
    expect(columnsNode(editor)?.attrs).toEqual({ columns: 4 });
    expect(columnsNode(editor)?.content?.[1]?.content).toEqual([{ type: "paragraph" }]);
  });

  it("disables growth at four columns and deleting at one", () => {
    const four = makeEditor(columnsDocument(["One", "Two", "Three", "Four"]));
    act(() => selectText(four, "Two"));
    const rendered = render(<JournalColumnsBubble editor={four} />);

    expect(screen.getByRole("button", { name: "左侧加列" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "右侧加列" })).toBeDisabled();
    rendered.unmount();

    const one = makeEditor(columnsDocument(["Only"]));
    act(() => selectText(one, "Only"));
    render(<JournalColumnsBubble editor={one} />);
    expect(screen.getByRole("button", { name: "删除当前列" })).toBeDisabled();
  });

  it("deletes the current column and restores it with undo", () => {
    const editor = makeEditor(columnsDocument(["Left", "Middle", "Right"]));
    act(() => selectText(editor, "Middle"));
    const rendered = render(<JournalColumnsBubble editor={editor} />);

    fireEvent.click(screen.getByRole("button", { name: "删除当前列" }));
    rendered.rerender(<JournalColumnsBubble editor={editor} />);
    expect(columnsNode(editor)?.attrs).toEqual({ columns: 2 });
    expect(editor.can().undo()).toBe(true);

    act(() => {
      editor.chain().focus().undo().run();
    });
    rendered.rerender(<JournalColumnsBubble editor={editor} />);
    expect(columnsNode(editor)?.attrs).toEqual({ columns: 3 });
    expect(columnsNode(editor)?.content?.[1]?.content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Middle" }] },
    ]);
  });

  it("hides the bubble toolbar in read-only mode", () => {
    const readOnly = makeEditor(columnsDocument(["Only"]), false);
    act(() => selectText(readOnly, "Only"));
    render(<JournalColumnsBubble editor={readOnly} />);

    expect(screen.queryByRole("toolbar", { name: "多栏工具" })).not.toBeInTheDocument();
  });
});

describe("JournalColumnsInsertMenu", () => {
  it("inserts the selected 2/3/4 column layout", async () => {
    const user = userEvent.setup();
    const editor = makeEditor("<p>Start</p>");
    editor.commands.setTextSelection(1);
    render(<JournalColumnsInsertMenu editor={editor} />);

    await user.click(screen.getByRole("button", { name: "插入多栏" }));
    await user.click(await screen.findByRole("menuitem", { name: "插入 3 栏" }));

    expect(columnsNode(editor)?.attrs).toEqual({ columns: 3 });
    expect(columnsNode(editor)?.content).toHaveLength(3);
  });

  it("keeps the open menu across an editor transaction", async () => {
    const user = userEvent.setup();
    const editor = makeEditor("<p>Start</p>");
    editor.commands.setTextSelection(1);
    render(<JournalColumnsInsertMenu editor={editor} />);

    await user.click(screen.getByRole("button", { name: "插入多栏" }));
    expect(await screen.findByRole("menuitem", { name: "插入 4 栏" })).toBeInTheDocument();

    act(() => {
      editor.commands.setTextSelection(1);
    });

    await user.click(screen.getByRole("menuitem", { name: "插入 4 栏" }));
    expect(columnsNode(editor)?.attrs).toEqual({ columns: 4 });
    expect(screen.queryByRole("menuitem", { name: "插入 4 栏" })).not.toBeInTheDocument();
  });
});
