"use client";

import type { AiRewriteInstruction } from "@roamlog/contracts";
import type { Editor } from "@tiptap/react";
import { Check, TextQuote, TrashIcon } from "lucide-react";

import { hashSelection } from "@/lib/ai/selection";
import { selectionMarkdown } from "@/lib/editor/text-context";

import { CommandGroup, CommandItem, CommandSeparator } from "./command";

/**
 * 移植来源: steven-tey/novel @ fa95098e66476c466faebb8211baa5869c101a9c
 *   apps/web/components/tailwind/generative/ai-completion-command.tsx (66 行) — 整文件
 * 许可: Apache-2.0（修改过的移植副本）
 * 修改说明（Apache-2.0 §4(b)）:
 *   - **design token / i18n 仅此两处**: 图标颜色 `text-muted-foreground` → `text-muted`；
 *     文案 `Replace selection`→「替换选中内容」、`Insert below`→「插入到下方」、
 *     `Discard`→「放弃」。
 *   - **类型**: editor 由 prop 传入（上游 `useEditor()`）。
 *   - **新增（本仓库既有的安全设计，保留）**: 上游 `Replace selection` 直接用**点击时**的
 *     `editor.view.state.selection` 写入，如果用户在等结果期间改了选区，它会覆盖错误的
 *     文字。这里在写入前重算「本次结果对应的文本」的哈希，和当前选区比对；不一致就
 *     报错不写（沿用 `journal-ai-rewrite.tsx:217-235` 的 `selectionStillMatches` 语义）。
 *     `continue` 没有选区（结果是基于上文生成的），此时不做该检查——上游同样不管。
 *   - 落点与事务语义逐字照抄上游：`insertContentAt({from,to})` / `insertContentAt(to+1)`，
 *     都是**单事务**，所以一次 undo 即可回退（规格 §6.5）。
 */

/** The request this result came from; used for the stale-selection guard. */
export interface AIPendingRun {
  readonly value: string;
  readonly instruction: AiRewriteInstruction;
  readonly command?: string;
  readonly contextBefore?: string;
  /** True when `value` is the selection itself, so a moved selection invalidates it. */
  readonly guardSelection: boolean;
}

interface AICompletionCommandsProps {
  editor: Editor;
  completion: string;
  pending: AIPendingRun | null;
  onDiscard: () => void;
  /** The document changed under the result; nothing was written. */
  onMismatch: () => void;
  /** The result was written into the document. */
  onApplied: () => void;
}

const AICompletionCommands = ({
  editor,
  completion,
  pending,
  onDiscard,
  onMismatch,
  onApplied,
}: AICompletionCommandsProps) => {
  /** Refuses to write a result whose source text is no longer under the cursor. */
  const stillApplies = async (): Promise<boolean> => {
    if (!pending?.guardSelection) return true;
    const [expected, current] = await Promise.all([
      hashSelection(pending.value),
      hashSelection(selectionMarkdown(editor)),
    ]);
    return expected === current;
  };

  return (
    <>
      <CommandGroup>
        <CommandItem
          className="gap-2 px-4"
          value="replace"
          onSelect={() => {
            void stillApplies().then((applies) => {
              if (!applies) {
                onMismatch();
                return;
              }
              const selection = editor.view.state.selection;

              editor
                .chain()
                .focus()
                .insertContentAt(
                  {
                    from: selection.from,
                    to: selection.to,
                  },
                  completion,
                )
                .run();
              onApplied();
            });
          }}
        >
          <Check aria-hidden="true" className="size-4 text-muted" />
          替换选中内容
        </CommandItem>
        <CommandItem
          className="gap-2 px-4"
          value="insert"
          onSelect={() => {
            const selection = editor.view.state.selection;
            editor
              .chain()
              .focus()
              .insertContentAt(selection.to + 1, completion)
              .run();
            onApplied();
          }}
        >
          <TextQuote aria-hidden="true" className="size-4 text-muted" />
          插入到下方
        </CommandItem>
      </CommandGroup>
      <CommandSeparator />

      <CommandGroup>
        <CommandItem onSelect={onDiscard} value="thrash" className="gap-2 px-4">
          <TrashIcon aria-hidden="true" className="size-4 text-muted" />
          放弃
        </CommandItem>
      </CommandGroup>
    </>
  );
};

export default AICompletionCommands;