"use client";

import type { NodeViewProps } from "@tiptap/react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";

import { normalizeColumnIndex, normalizeColumnsCount } from "./journal-columns";

const COLUMNS_CONTENT_CLASS = [
  "flex min-w-0 flex-col gap-4",
  "min-[769px]:flex-row min-[769px]:items-stretch",
  "[&>[data-node-view-content-react]]:contents",
].join(" ");

const COLUMN_CONTENT_CLASS = ["min-w-0", "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"].join(" ");

/**
 * Columns wrapper.
 *
 * Ported from hunghg255/reactjs-tiptap-editor@496b84967ef58b85465edb1c4eae517de11fba73
 * (MIT): src/extensions/Column/Column.ts:79-115 and src/styles/columns.scss:1-23.
 * Adaptation layer: the persisted HTML keeps only fixed data attributes, while
 * the editor uses Roamlog tokens and a responsive flex layout.
 */
export function JournalColumnsNodeView({ node }: NodeViewProps) {
  const columns = normalizeColumnsCount(node.attrs.columns);

  return (
    <NodeViewWrapper
      className="journal-columns-node relative my-4"
      data-type="columns"
      data-columns={columns}
    >
      <NodeViewContent className={COLUMNS_CONTENT_CLASS} />
    </NodeViewWrapper>
  );
}

/**
 * One column. The border/padding mirror the upstream columns.scss while staying
 * editor-only; `renderHTML` remains the plain data-attribute contract.
 */
export function JournalColumnNodeView({ node }: NodeViewProps) {
  const index = normalizeColumnIndex(node.attrs.index);

  return (
    <NodeViewWrapper
      className="journal-column-node min-w-0 flex-1 rounded-[3px] border border-hairline bg-surface-1/30 p-3"
      data-type="column"
      data-column-index={index}
    >
      <NodeViewContent className={COLUMN_CONTENT_CLASS} />
    </NodeViewWrapper>
  );
}
