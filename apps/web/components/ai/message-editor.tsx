"use client";

/**
 * Edit composer ported from vercel/chatbot
 * `components/chat/message-editor.tsx` @ a8989b522fa3672a2ae52f053105e40993b36ca1
 * (Apache-2.0).
 *
 * Adaptation layer: assistant-ui owns the edit composer runtime and already
 * truncates the trailing messages when the edited message is submitted. The
 * visual primitive is kept local so Roamlog's tokens and Chinese copy apply.
 */

import { ComposerPrimitive } from "@assistant-ui/react";
import { Button } from "@roamlog/ui";

export function EditComposer() {
  return (
    <ComposerPrimitive.Root
      aria-label="编辑消息"
      className="ml-auto flex w-full max-w-[85%] flex-col gap-2 rounded-card border border-hairline-strong bg-surface-2 px-3 py-2"
    >
      <ComposerPrimitive.Input
        aria-label="编辑消息内容"
        autoFocus
        rows={2}
        maxRows={8}
        className="min-h-12 w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-ink outline-none placeholder:text-stone"
      />
      <div className="flex justify-end gap-2">
        <ComposerPrimitive.Cancel asChild>
          <Button type="button" variant="ghost" size="sm">
            取消
          </Button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <Button type="button" variant="primary" size="sm">
            保存并重新生成
          </Button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}
