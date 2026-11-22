import { Editor, type Content, type JSONContent } from "@tiptap/core";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";

import { gotoCol, JournalColumn, JournalColumns, normalizeColumnsCount } from "../journal-columns";

const editors: Editor[] = [];

function makeEditor(
  content: Content,
  extensions = [StarterKit, JournalColumn, JournalColumns],
): Editor {
  const editor = new Editor({
    extensions,
    content,
    element: document.createElement("div"),
  });
  editors.push(editor);
  return editor;
}

function columnsDocument(labels: string[]): Content {
  return {
    type: "doc",
    content: [
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

function columnsNode(editor: Editor): JSONContent | null {
  const document = editor.getJSON() as unknown as JSONContent;
  return document.content?.find((node) => node.type === "columns") ?? null;
}

function columnText(column: JSONContent): string {
  return (
    column.content
      ?.map((node) => node.content?.map((child) => child.text ?? "").join("") ?? "")
      .join("") ?? ""
  );
}

function columnAt(columns: JSONContent, index: number): JSONContent {
  const column = columns.content?.[index];
  if (!column) throw new Error(`Column not found at index ${index}`);
  return column;
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

function selectedColumnIndex(editor: Editor): number | null {
  const { $from } = editor.state.selection;

  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "column") return Number(node.attrs.index);
  }

  return null;
}

function selectedCellPosition(editor: Editor): number | null {
  const { $from } = editor.state.selection;

  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      return $from.before(depth);
    }
  }

  return null;
}

function htmlDocument(editor: Editor): Document {
  return new DOMParser().parseFromString(editor.getHTML(), "text/html");
}

function pressTab(editor: Editor, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  editor.view.dom.dispatchEvent(event);
  return event;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("JournalColumns", () => {
  it("inserts two empty columns by default", () => {
    const editor = makeEditor("<p>Start</p>");
    editor.commands.setTextSelection(1);

    expect(editor.commands.insertColumns()).toBe(true);

    const columns = columnsNode(editor);
    expect(columns?.attrs).toEqual({ columns: 2 });
    expect(columns?.content).toHaveLength(2);
    expect(columns?.content?.map((column) => column.attrs?.index)).toEqual([0, 1]);
    expect(columns?.content?.every((column) => column.content?.[0]?.type === "paragraph")).toBe(
      true,
    );
    expect(selectedColumnIndex(editor)).toBe(0);

    const html = editor.getHTML();
    expect(html).toContain('<div data-type="columns" data-columns="2">');
    expect(html).toContain('<div data-type="column" data-column-index="0">');
    expect(html).toContain('<div data-type="column" data-column-index="1">');
    expect(html).not.toMatch(/\sclass=/);
    expect(html).not.toMatch(/\sstyle=/);
  });

  it("inserts a requested three-column layout", () => {
    const editor = makeEditor("<p></p>");
    editor.commands.setTextSelection(1);

    expect(editor.commands.insertColumns({ columns: 3 })).toBe(true);

    const columns = columnsNode(editor);
    expect(columns?.attrs).toEqual({ columns: 3 });
    expect(columns?.content).toHaveLength(3);
    expect(columns?.content?.map((column) => column.attrs?.index)).toEqual([0, 1, 2]);
  });

  it("adds a column before the active column and reindexes the group", () => {
    const editor = makeEditor(columnsDocument(["Left", "Middle", "Right"]));
    selectText(editor, "Middle");

    expect(editor.commands.addColBefore()).toBe(true);

    const columns = columnsNode(editor);
    expect(columns?.attrs).toEqual({ columns: 4 });
    expect(columns?.content).toHaveLength(4);
    expect(columns?.content?.map((column) => column.attrs?.index)).toEqual([0, 1, 2, 3]);
    expect(columnText(columnAt(columns!, 1))).toBe("");
    expect(columnText(columnAt(columns!, 2))).toBe("Middle");
    expect(selectedColumnIndex(editor)).toBe(1);
  });

  it("adds a column after the active column and reindexes the group", () => {
    const editor = makeEditor(columnsDocument(["Left", "Right"]));
    selectText(editor, "Left");

    expect(editor.commands.addColAfter()).toBe(true);

    const columns = columnsNode(editor);
    expect(columns?.attrs).toEqual({ columns: 3 });
    expect(columns?.content).toHaveLength(3);
    expect(columns?.content?.map((column) => column.attrs?.index)).toEqual([0, 1, 2]);
    expect(columnText(columnAt(columns!, 0))).toBe("Left");
    expect(columnText(columnAt(columns!, 1))).toBe("");
    expect(columnText(columnAt(columns!, 2))).toBe("Right");
    expect(selectedColumnIndex(editor)).toBe(1);
  });

  it("deletes the active column and reindexes the remaining columns", () => {
    const editor = makeEditor(columnsDocument(["Left", "Middle", "Right"]));
    selectText(editor, "Middle");

    expect(editor.commands.deleteCol()).toBe(true);

    const columns = columnsNode(editor);
    expect(columns?.attrs).toEqual({ columns: 2 });
    expect(columns?.content).toHaveLength(2);
    expect(columns?.content?.map((column) => column.attrs?.index)).toEqual([0, 1]);
    expect(columnText(columnAt(columns!, 0))).toBe("Left");
    expect(columnText(columnAt(columns!, 1))).toBe("Right");
    expect(selectedColumnIndex(editor)).toBe(0);
  });

  it("keeps a single-column group instead of removing the columns node", () => {
    const editor = makeEditor(columnsDocument(["Only", "Other"]));
    selectText(editor, "Other");

    expect(editor.commands.deleteCol()).toBe(true);

    const columns = columnsNode(editor);
    expect(columns?.attrs).toEqual({ columns: 1 });
    expect(columns?.content).toHaveLength(1);
    expect(columns?.content?.[0]?.attrs).toEqual({ index: 0 });
    expect(columnText(columnAt(columns!, 0))).toBe("Only");
    expect(selectedColumnIndex(editor)).toBe(0);
  });

  it("refuses to exceed four columns or delete the last column", () => {
    const full = makeEditor(columnsDocument(["One", "Two", "Three", "Four"]));
    selectText(full, "Two");

    expect(full.commands.addColBefore()).toBe(false);
    expect(columnsNode(full)?.content).toHaveLength(4);

    const single = makeEditor(columnsDocument(["Only"]));
    selectText(single, "Only");

    expect(single.commands.deleteCol()).toBe(false);
    expect(columnsNode(single)?.attrs).toEqual({ columns: 1 });
    expect(columnsNode(single)?.content).toHaveLength(1);
  });

  it("cycles Tab and Shift-Tab only while the cursor is inside columns", () => {
    const editor = makeEditor(columnsDocument(["One", "Two", "Three"]));
    selectText(editor, "One");

    pressTab(editor);
    expect(selectedColumnIndex(editor)).toBe(1);

    pressTab(editor);
    expect(selectedColumnIndex(editor)).toBe(2);

    pressTab(editor);
    expect(selectedColumnIndex(editor)).toBe(0);

    pressTab(editor, true);
    expect(selectedColumnIndex(editor)).toBe(2);
  });

  it("returns false for column navigation outside a columns node", () => {
    const editor = makeEditor("<p>Outside</p>");
    selectText(editor, "Outside");

    expect(
      gotoCol({
        state: editor.state,
        dispatch: editor.view.dispatch,
        type: "after",
      }),
    ).toBe(false);
  });

  it("does not intercept list Tab behavior", () => {
    const editor = makeEditor("<ul><li><p>One</p></li><li><p>Two</p></li></ul>");
    selectText(editor, "Two");

    expect(
      gotoCol({
        state: editor.state,
        dispatch: editor.view.dispatch,
        type: "after",
      }),
    ).toBe(false);

    pressTab(editor);

    const list = editor.getJSON().content?.[0];
    expect(list?.type).toBe("bulletList");
    expect(selectedColumnIndex(editor)).toBeNull();
  });

  it("does not intercept table Tab behavior", () => {
    const editor = makeEditor(
      "<table><tbody><tr><td><p>One</p></td><td><p>Two</p></td></tr></tbody></table>",
      [
        StarterKit,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
        JournalColumn,
        JournalColumns,
      ],
    );
    selectText(editor, "One");
    const before = selectedCellPosition(editor);

    pressTab(editor);

    expect(before).not.toBeNull();
    expect(selectedCellPosition(editor)).not.toBe(before);
  });

  it("round-trips JSON through data-* HTML", () => {
    const editor = makeEditor(columnsDocument(["Left", "Right"]));
    const original = columnsNode(editor);
    const html = editor.getHTML();

    expect(html).toContain('<div data-type="columns" data-columns="2">');
    expect(html).not.toMatch(/\sclass=/);
    expect(html).not.toMatch(/\sstyle=/);

    const roundTripped = makeEditor(html);
    expect(columnsNode(roundTripped)).toEqual(original);
  });

  it.each(["grid", "columns"])("parses legacy .%s class HTML", (legacyClass) => {
    const editor = makeEditor(
      `<div class="${legacyClass}" cols="3">
        <div class="column" index="0"><p>Left</p></div>
        <div class="column" index="1"><p>Middle</p></div>
        <div class="column" index="2"><p>Right</p></div>
      </div>`,
    );

    const columns = columnsNode(editor);
    expect(columns?.attrs).toEqual({ columns: 3 });
    expect(columns?.content?.map((column) => column.attrs?.index)).toEqual([0, 1, 2]);
    expect(columnText(columnAt(columns!, 1))).toBe("Middle");

    const html = editor.getHTML();
    expect(html).toContain('<div data-type="columns" data-columns="3">');
    expect(html).toContain('<div data-type="column" data-column-index="0">');
    expect(html).not.toMatch(/\sclass=/);
  });

  it.each(["0", "5", "nine"])("falls back to two columns for data-columns=%s", (value) => {
    const editor = makeEditor(
      `<div data-type="columns" data-columns="${value}">
        <div data-type="column" data-column-index="0"><p>Left</p></div>
        <div data-type="column" data-column-index="1"><p>Right</p></div>
      </div>`,
    );

    const columns = columnsNode(editor);
    expect(columns?.attrs).toEqual({ columns: 2 });
    expect(
      htmlDocument(editor).querySelector('[data-type="columns"]')?.getAttribute("data-columns"),
    ).toBe("2");
    expect(normalizeColumnsCount(value)).toBe(2);
  });

  it("fills an empty parsed column with one empty paragraph", () => {
    const editor = makeEditor(
      `<div data-type="columns" data-columns="2">
        <div data-type="column" data-column-index="0"></div>
        <div data-type="column" data-column-index="1"><p>Right</p></div>
      </div>`,
    );

    const columns = columnsNode(editor);
    expect(columns?.content?.[0]?.content).toEqual([{ type: "paragraph" }]);
  });
});
