import { findParentNode, Node } from "@tiptap/core";
import type { CommandProps, JSONContent } from "@tiptap/core";
import {
  Node as ProseMirrorNode,
  type Fragment,
  type NodeType,
  type Schema,
  type DOMOutputSpec,
} from "@tiptap/pm/model";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { JournalColumnNodeView, JournalColumnsNodeView } from "./journal-columns-node-view";

export const COLUMNS_DEFAULT_COUNT = 2;
export const COLUMNS_MIN_COUNT = 1;
export const COLUMNS_MAX_COUNT = 4;

const COLUMN_DEFAULT_INDEX = 0;
const EXTENSION_PRIORITY_HIGHEST = 200;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: {
      insertColumns: (attrs?: { columns?: number }) => ReturnType;
      addColBefore: () => ReturnType;
      addColAfter: () => ReturnType;
      deleteCol: () => ReturnType;
    };
  }
}

function numericValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return Number.NaN;
}

export function normalizeColumnsCount(value: unknown): number {
  const numeric = numericValue(value);

  return Number.isInteger(numeric) && numeric >= COLUMNS_MIN_COUNT && numeric <= COLUMNS_MAX_COUNT
    ? numeric
    : COLUMNS_DEFAULT_COUNT;
}

export function normalizeColumnIndex(value: unknown): number {
  const numeric = numericValue(value);

  return Number.isInteger(numeric) && numeric >= 0 && numeric < COLUMNS_MAX_COUNT
    ? numeric
    : COLUMN_DEFAULT_INDEX;
}

export function createColumn(
  colType: NodeType,
  index: number,
  colContent: Fragment | ProseMirrorNode | readonly ProseMirrorNode[] | null = null,
) {
  const attrs = { index: normalizeColumnIndex(index) };

  if (colContent) {
    return colType.createChecked(attrs, colContent);
  }

  return colType.createAndFill(attrs);
}

export function getColumnsNodeTypes(schema: Schema): {
  columns: NodeType;
  column: NodeType;
} {
  if (schema.cached.columnsNodeTypes) {
    return schema.cached.columnsNodeTypes as { columns: NodeType; column: NodeType };
  }

  const columns = schema.nodes.columns;
  const column = schema.nodes.column;

  if (!columns || !column) {
    throw new Error("The columns and column nodes must be registered in the schema.");
  }

  const roles = {
    columns,
    column,
  };

  schema.cached.columnsNodeTypes = roles;

  return roles;
}

export function createColumns(
  schema: Schema,
  colsCount: number,
  colContent: Fragment | ProseMirrorNode | readonly ProseMirrorNode[] | null = null,
) {
  const types = getColumnsNodeTypes(schema);
  const count = normalizeColumnsCount(colsCount);
  const cols: ProseMirrorNode[] = [];

  for (let index = 0; index < count; index += 1) {
    const col = createColumn(types.column, index, colContent);

    if (col) {
      cols.push(col);
    }
  }

  return types.columns.createChecked({ columns: count }, cols);
}

export function addOrDeleteCol({
  state,
  dispatch,
  type,
}: {
  state: EditorState;
  dispatch: CommandProps["dispatch"];
  type: "addBefore" | "addAfter" | "delete";
}) {
  const maybeColumns = findParentNode(
    (node: ProseMirrorNode) => node.type.name === JournalColumns.name,
  )(state.selection);
  const maybeColumn = findParentNode(
    (node: ProseMirrorNode) => node.type.name === JournalColumn.name,
  )(state.selection);

  if (!maybeColumns || !maybeColumn) return false;

  const cols = maybeColumns.node;
  const colCount = cols.content.childCount;

  if (type === "delete" && colCount <= COLUMNS_MIN_COUNT) return false;
  if (type !== "delete" && colCount >= COLUMNS_MAX_COUNT) return false;
  if (!dispatch) return true;

  const colIndex = normalizeColumnIndex(maybeColumn.node.attrs.index);
  const colsJSON = cols.toJSON() as JSONContent & {
    attrs: { columns: number };
    content: (JSONContent & { attrs: { index: number } })[];
  };

  let nextIndex = colIndex;

  if (type === "delete") {
    nextIndex = colIndex - 1;
    colsJSON.content.splice(colIndex, 1);
  } else {
    nextIndex = type === "addBefore" ? colIndex : colIndex + 1;
    colsJSON.content.splice(nextIndex, 0, {
      type: "column",
      attrs: {
        index: colIndex,
      },
      content: [
        {
          type: "paragraph",
        },
      ],
    });
  }

  colsJSON.attrs = { ...colsJSON.attrs, columns: colsJSON.content.length };

  colsJSON.content.forEach((colJSON, index) => {
    colJSON.attrs = { ...colJSON.attrs, index };
  });

  const nextCols = ProseMirrorNode.fromJSON(state.schema, colsJSON);

  let nextSelectPos = maybeColumns.pos;
  nextCols.content.forEach((col, _pos, index) => {
    if (index < nextIndex) {
      nextSelectPos += col.nodeSize;
    }
  });

  const tr = state.tr.setTime(Date.now());

  tr.replaceWith(
    maybeColumns.pos,
    maybeColumns.pos + maybeColumns.node.nodeSize,
    nextCols,
  ).setSelection(TextSelection.near(tr.doc.resolve(nextSelectPos)));

  dispatch(tr);
  return true;
}

export function gotoCol({
  state,
  dispatch,
  type,
}: {
  state: EditorState;
  dispatch: CommandProps["dispatch"];
  type: "before" | "after";
}) {
  const maybeColumns = findParentNode(
    (node: ProseMirrorNode) => node.type.name === JournalColumns.name,
  )(state.selection);
  const maybeColumn = findParentNode(
    (node: ProseMirrorNode) => node.type.name === JournalColumn.name,
  )(state.selection);

  if (!maybeColumns || !maybeColumn) return false;
  if (!dispatch) return true;

  const cols = maybeColumns.node;
  const colCount = normalizeColumnsCount(cols.attrs.columns);
  const colIndex = normalizeColumnIndex(maybeColumn.node.attrs.index);

  const nextIndex =
    type === "before" ? (colIndex - 1 + colCount) % colCount : (colIndex + 1) % colCount;

  let nextSelectPos = maybeColumns.start;
  cols.content.forEach((col, _pos, index) => {
    if (index < nextIndex) {
      nextSelectPos += col.nodeSize;
    }
  });

  const tr = state.tr.setTime(Date.now());

  tr.setSelection(TextSelection.near(tr.doc.resolve(nextSelectPos)));
  dispatch(tr);
  return true;
}

export const JournalColumn = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  defining: true,

  addNodeView() {
    // The React renderer inserts its own wrapper as the flex item, so the
    // equal-width rule must live on that wrapper rather than the inner node.
    return ReactNodeViewRenderer(JournalColumnNodeView, {
      className: "min-w-0 min-[769px]:flex-1",
    });
  },

  addAttributes() {
    return {
      index: {
        default: COLUMN_DEFAULT_INDEX,
        parseHTML: (element) =>
          normalizeColumnIndex(
            element.getAttribute("data-column-index") ?? element.getAttribute("index"),
          ),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="column"]',
        priority: 1000,
      },
      {
        tag: "div.column",
        priority: 100,
      },
    ];
  },

  renderHTML({ node }): DOMOutputSpec {
    return [
      "div",
      {
        "data-type": "column",
        "data-column-index": String(normalizeColumnIndex(node.attrs.index)),
      },
      0,
    ];
  },
});

export const JournalColumns = Node.create({
  name: "columns",
  group: "block",
  defining: true,
  isolating: true,
  allowGapCursor: false,
  content: `column{${COLUMNS_MIN_COUNT},${COLUMNS_MAX_COUNT}}`,
  priority: EXTENSION_PRIORITY_HIGHEST,

  addNodeView() {
    return ReactNodeViewRenderer(JournalColumnsNodeView);
  },

  addAttributes() {
    return {
      columns: {
        default: COLUMNS_DEFAULT_COUNT,
        parseHTML: (element) =>
          normalizeColumnsCount(
            element.getAttribute("data-columns") ?? element.getAttribute("cols"),
          ),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="columns"]',
        priority: 1000,
      },
      {
        tag: "div.grid",
        priority: 100,
      },
      {
        tag: "div.columns",
        priority: 100,
      },
    ];
  },

  renderHTML({ node }): DOMOutputSpec {
    return [
      "div",
      {
        "data-type": "columns",
        "data-columns": String(normalizeColumnsCount(node.attrs.columns)),
      },
      0,
    ];
  },

  addCommands() {
    return {
      insertColumns:
        (attrs) =>
        ({ tr, dispatch, editor }) => {
          const node = createColumns(editor.schema, attrs?.columns ?? COLUMNS_DEFAULT_COUNT);

          if (dispatch) {
            const offset = tr.selection.anchor + 1;

            tr.replaceSelectionWith(node)
              .scrollIntoView()
              .setSelection(TextSelection.near(tr.doc.resolve(offset)));
          }

          return true;
        },
      addColBefore:
        () =>
        ({ dispatch, state }) => {
          return addOrDeleteCol({ dispatch, state, type: "addBefore" });
        },
      addColAfter:
        () =>
        ({ dispatch, state }) => {
          return addOrDeleteCol({ dispatch, state, type: "addAfter" });
        },
      deleteCol:
        () =>
        ({ dispatch, state }) => {
          return addOrDeleteCol({ dispatch, state, type: "delete" });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        return gotoCol({
          state: this.editor.state,
          dispatch: this.editor.view.dispatch,
          type: "after",
        });
      },
      "Shift-Tab": () => {
        return gotoCol({
          state: this.editor.state,
          dispatch: this.editor.view.dispatch,
          type: "before",
        });
      },
    };
  },
});

export const Column = JournalColumn;
export const Columns = JournalColumns;
export const ColumnNode = JournalColumn;
export const MultipleColumnNode = JournalColumns;

export default JournalColumns;
