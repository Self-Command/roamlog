"use client";

import { ThreadListItemPrimitive, ThreadListPrimitive, useAuiState } from "@assistant-ui/react";
import { Button } from "@roamlog/ui";
import { MessageSquarePlus, Trash2, X } from "lucide-react";

/**
 * The conversation list.
 *
 * Ported from the assistant-ui "ThreadList" composition —
 * `ThreadListPrimitive.Root/New/Items` with `ThreadListItemPrimitive.Root/
 * Trigger/Title/Delete` (see `@assistant-ui/react/dist/primitives/threadList.js`
 * and `threadListItem.js`). The active item is derived from the runtime state
 * exactly as `ThreadListItemRoot` does internally
 * (`s.threads.mainThreadId === s.threadListItem.id`).
 */

function ThreadListItem() {
  const isActive = useAuiState((state) => state.threads.mainThreadId === state.threadListItem.id);

  return (
    <ThreadListItemPrimitive.Root
      data-active={isActive ? "true" : undefined}
      className="group flex items-center gap-1 rounded-control px-1 data-[active]:bg-white/[0.06]"
    >
      <ThreadListItemPrimitive.Trigger className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm text-body outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 group-data-[active]:text-ink">
        <ThreadListItemPrimitive.Title fallback="新会话" />
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemPrimitive.Delete asChild>
        <button
          type="button"
          aria-label="删除会话"
          className="mr-1 hidden shrink-0 rounded-[6px] p-1.5 text-stone outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink group-hover:block"
        >
          <Trash2 aria-hidden="true" className="size-3.5" />
        </button>
      </ThreadListItemPrimitive.Delete>
    </ThreadListItemPrimitive.Root>
  );
}

export function AiThreadList({ onClose }: { onClose?: () => void }) {
  return (
    <ThreadListPrimitive.Root className="flex h-full min-h-0 flex-col bg-surface-0">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <p className="type-meta">会话</p>
        <div className="flex items-center gap-1">
          <ThreadListPrimitive.New asChild>
            <Button type="button" variant="ghost" size="sm" aria-label="新建会话">
              <MessageSquarePlus aria-hidden="true" className="size-4" />
            </Button>
          </ThreadListPrimitive.New>
          {onClose ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="关闭会话列表"
              onClick={onClose}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
      <ThreadListPrimitive.Items>
        {() => <ThreadListItem />}
      </ThreadListPrimitive.Items>
    </ThreadListPrimitive.Root>
  );
}
