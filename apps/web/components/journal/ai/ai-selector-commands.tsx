"use client";

import { ArrowDownWideNarrow, CheckCheck, RefreshCcwDot, StepForward, WrapText } from "lucide-react";
import type { Editor } from "@tiptap/react";

import type { AiRewriteInstruction } from "@roamlog/contracts";

import { getPrevText, selectionMarkdown } from "@/lib/editor/text-context";

import { CommandGroup, CommandItem, CommandSeparator } from "./command";

/**
 * 移植来源: steven-tey/novel @ fa95098e66476c466faebb8211baa5869c101a9c
 *   apps/web/components/tailwind/generative/ai-selector-commands.tsx (73 行) — 整文件
 * 许可: Apache-2.0（修改过的移植副本）
 * 修改说明（Apache-2.0 §4(b)）:
 *   - **D5（TipTap v3 markdown 序列化）**: 上游 `editor.storage.markdown.serializer.serialize(slice.content)`
 *     在 v3 是 `editor.storage.markdown.manager.serialize(json)`，已封装为 `selectionMarkdown()`。
 *   - **类型**: `useEditor()` → `editor` prop；option 值收敛到契约的 `AiRewriteInstruction`
 *     （取值与上游 `option` 字符串完全一致：improve/fix/shorter/longer/continue）。
 *   - **i18n**: 四个标签、两个分组标题、续写项按规格 §6.5 的中译表替换，**顺序与图标不变**。
 *   - `continue` 仍然取「选区之前的正文」`getPrevText(editor, selection.from)`，不取选区
 *     ——这是上游 `:55-68` 的关键行为。
 */

const options = [
  {
    value: "improve",
    label: "改善表达",
    icon: RefreshCcwDot,
  },
  {
    value: "fix",
    label: "修正语法",
    icon: CheckCheck,
  },
  {
    value: "shorter",
    label: "更简短",
    icon: ArrowDownWideNarrow,
  },
  {
    value: "longer",
    label: "更详细",
    icon: WrapText,
  },
] as const satisfies ReadonlyArray<{
  value: AiRewriteInstruction;
  label: string;
  icon: typeof RefreshCcwDot;
}>;

interface AISelectorCommandsProps {
  editor: Editor;
  onSelect: (value: string, option: AiRewriteInstruction) => void;
}

const AISelectorCommands = ({ editor, onSelect }: AISelectorCommandsProps) => {
  return (
    <>
      <CommandGroup heading="改写或检查选中内容">
        {options.map((option) => (
          <CommandItem
            onSelect={(value) => {
              // Upstream serializes the *selection* for these four options.
              onSelect(selectionMarkdown(editor), option.value);
              void value;
            }}
            className="flex gap-2 px-4"
            key={option.value}
            value={option.value}
          >
            <option.icon aria-hidden="true" className="size-4 text-accent-blue" />
            {option.label}
          </CommandItem>
        ))}
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="用 AI 做更多">
        <CommandItem
          onSelect={() => {
            // `Continue writing` sends the text *before* the cursor, not the
            // selection (upstream `ai-selector-commands.tsx:56-61`).
            const pos = editor.state.selection.from;
            const text = getPrevText(editor, pos);
            onSelect(text, "continue");
          }}
          value="continue"
          className="gap-2 px-4"
        >
          <StepForward aria-hidden="true" className="size-4 text-accent-blue" />
          接着往下写
        </CommandItem>
      </CommandGroup>
    </>
  );
};

export default AISelectorCommands;