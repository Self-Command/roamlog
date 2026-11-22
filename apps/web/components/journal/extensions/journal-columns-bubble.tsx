"use client";

import type { Editor } from "@tiptap/core";
import { Popover, PopoverContent, PopoverTrigger } from "@roamlog/ui";
import { BubbleMenu } from "@tiptap/react/menus";
import { ArrowLeft, ArrowRight, Columns3, Trash2 } from "lucide-react";
import { useCallback, useState, type MouseEvent, type ReactNode } from "react";

import {
  COLUMNS_MAX_COUNT,
  COLUMNS_MIN_COUNT,
  normalizeColumnIndex,
  normalizeColumnsCount,
} from "./journal-columns";

const COLUMNS_INSERT_OPTIONS = [2, 3, 4] as const;
const COLUMNS_BUBBLE_OPTIONS = {
  placement: "bottom",
  offset: 8,
  flip: true,
} as const;

const TOOLBAR_BUTTON_CLASS =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-[5px] border border-hairline-strong bg-surface-1 px-2 font-mono text-[10px] text-muted transition-colors outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-35";

const TOOLBAR_ICON_BUTTON_CLASS =
  "inline-flex size-8 items-center justify-center rounded-[5px] border border-hairline-strong bg-surface-1 text-muted transition-colors outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-35";

export interface ColumnsSelectionInfo {
  index: number | null;
  total: number | null;
}

export function getColumnsSelectionInfo(editor: Editor): ColumnsSelectionInfo {
  const { $from } = editor.state.selection;
  let index: number | null = null;
  let total: number | null = null;

  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "column") index = normalizeColumnIndex(node.attrs.index);
    if (node.type.name === "columns") total = normalizeColumnsCount(node.attrs.columns);
  }

  return { index, total };
}

export function shouldShowColumnsBubble(editor: Editor): boolean {
  return editor.isEditable && getColumnsSelectionInfo(editor).total !== null;
}

function BubbleButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={TOOLBAR_ICON_BUTTON_CLASS}
      onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/**
 * Column bubble toolbar.
 *
 * Ported from hunghg255/reactjs-tiptap-editor@496b84967ef58b85465edb1c4eae517de11fba73
 * (MIT): src/components/Bubble/RichTextBubbleColumns.tsx:1-58 and
 * src/extensions/Column/Column.ts:117-149. Roamlog adaptation: no whole-columns
 * delete action, localized labels, and project tokens.
 */
export function JournalColumnsBubble({ editor }: { editor: Editor }) {
  // JournalEditor re-renders on every transaction, so deriving this during
  // render stays current without another store subscription. A subscription
  // here would also fight BubbleMenu's own positioning updates in jsdom.
  const info = getColumnsSelectionInfo(editor);
  // BubbleMenu@3.34 dispatches an `updateOptions` transaction whenever
  // `shouldShow` changes identity. This editor enables
  // `shouldRerenderOnTransaction`, so a fresh closure here would loop:
  // render -> updateOptions -> transaction -> render. Keep it stable; the
  // callback reads the current editor state when the plugin invokes it.
  const shouldShow = useCallback(
    ({ editor: current }: { editor: Editor }) => shouldShowColumnsBubble(current),
    [],
  );

  // Keep the plugin mounted for the whole editable lifetime. Mounting it only
  // when a column is selected unregisters/registers the ProseMirror plugin on
  // every selection change, which drops pending menu interactions in a real
  // browser. `shouldShow` handles visibility instead.
  if (!editor.isEditable) return null;

  const displayIndex = info.index === null ? 1 : info.index + 1;
  const displayTotal = info.total ?? 0;
  const canAddBefore =
    info.total !== null && info.total < COLUMNS_MAX_COUNT && editor.can().addColBefore();
  const canAddAfter =
    info.total !== null && info.total < COLUMNS_MAX_COUNT && editor.can().addColAfter();
  const canDelete =
    info.total !== null && info.total > COLUMNS_MIN_COUNT && editor.can().deleteCol();

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="journal-columns-bubble"
      options={COLUMNS_BUBBLE_OPTIONS}
      shouldShow={shouldShow}
      role="toolbar"
      aria-label="多栏工具"
      className="journal-columns-bubble flex max-w-[calc(100vw-24px)] flex-wrap items-center gap-1 rounded-control border border-hairline-strong bg-surface-1/95 p-1 shadow-lg backdrop-blur"
    >
      <span className="px-1.5 font-mono text-[10px] tabular-nums text-muted">
        {displayIndex} / {displayTotal} 栏
      </span>
      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-hairline-strong" />
      <BubbleButton
        label="左侧加列"
        disabled={!canAddBefore}
        onClick={() => editor.chain().focus().addColBefore().run()}
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        label="右侧加列"
        disabled={!canAddAfter}
        onClick={() => editor.chain().focus().addColAfter().run()}
      >
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </BubbleButton>
      <BubbleButton
        label="删除当前列"
        disabled={!canDelete}
        onClick={() => editor.chain().focus().deleteCol().run()}
      >
        <Trash2 aria-hidden="true" className="size-3.5" />
      </BubbleButton>
    </BubbleMenu>
  );
}

/**
 * Insert menu for the main editor toolbar.
 *
 * Ported from hunghg255/reactjs-tiptap-editor@496b84967ef58b85465edb1c4eae517de11fba73
 * (MIT): src/utils/columns.ts:37-54 and src/extensions/Column/Column.ts:117-132.
 */
export function JournalColumnsInsertMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);

  function insert(columns: number): void {
    setOpen(false);
    editor.chain().focus().insertColumns({ columns }).run();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="插入多栏"
          aria-haspopup="menu"
          title="插入多栏"
          className={TOOLBAR_ICON_BUTTON_CLASS}
          onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
        >
          <Columns3 aria-hidden="true" className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-48 p-2"
        aria-label="选择栏数"
        onCloseAutoFocus={(event) => {
          // Radix otherwise returns focus to the toolbar trigger after
          // `insert()` has already placed the cursor in the new column.
          // Keep the user's caret in the document so typing can continue.
          event.preventDefault();
          editor.chain().focus().run();
        }}
      >
        <p className="px-2 pb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-stone">
          插入多栏
        </p>
        <div role="menu" aria-label="栏数选择" className="grid gap-1">
          {COLUMNS_INSERT_OPTIONS.map((columns) => (
            <button
              key={columns}
              type="button"
              role="menuitem"
              aria-label={`插入 ${columns} 栏`}
              className={TOOLBAR_BUTTON_CLASS}
              onMouseDown={(event: MouseEvent<HTMLButtonElement>) => event.preventDefault()}
              onClick={() => insert(columns)}
            >
              <Columns3 aria-hidden="true" className="size-3.5" />
              {columns} 栏
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
