"use client";

/**
 * Message actions ported from vercel/chatbot
 * `components/chat/message-actions.tsx` @ a8989b52 (Apache-2.0).
 *
 * Adaptation layer:
 * - Copy/regenerate are wired to assistant-ui `ActionBarPrimitive.Copy` and
 *   `ActionBarPrimitive.Reload` instead of the upstream SWR + vote API.
 * - Edit and vote controls are omitted: Roamlog has no message-edit endpoint
 *   and the spec explicitly says voting can stay hidden until there is an API.
 * - Text/toast feedback is replaced by the primitive's `data-copied` state and
 *   Chinese `aria-label`s.
 */

import { ActionBarPrimitive, useAuiState } from "@assistant-ui/react";
import { Button } from "@roamlog/ui";
import { Copy, Pencil, RotateCcw } from "lucide-react";
import { memo } from "react";

import { cn } from "./cn";

export interface MessageActionsProps {
  role: "user" | "assistant";
  isLoading?: boolean;
  onEdit?: () => void;
}

export function PureMessageActions({
  role,
  isLoading,
  onEdit,
}: MessageActionsProps) {
  const running = useAuiState((state) => state.message.status?.type === "running");
  const loading = isLoading ?? running;
  if (loading) return null;

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      className={cn(
        "flex items-center gap-1 opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover/message:opacity-100 md:focus-within:opacity-100",
        role === "user" ? "justify-end" : "justify-start",
      )}
    >
      {role === "user" && onEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="编辑消息"
          className="size-8 px-0"
          onClick={onEdit}
        >
          <Pencil aria-hidden="true" className="size-3.5" />
        </Button>
      ) : null}

      <ActionBarPrimitive.Copy asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="复制"
          className="size-8 px-0"
        >
          <Copy aria-hidden="true" className="size-3.5" />
        </Button>
      </ActionBarPrimitive.Copy>

      {role === "assistant" ? (
        <ActionBarPrimitive.Reload asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="重新生成"
            className="size-8 px-0"
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
          </Button>
        </ActionBarPrimitive.Reload>
      ) : null}
    </ActionBarPrimitive.Root>
  );
}

export const MessageActions = memo(PureMessageActions);
