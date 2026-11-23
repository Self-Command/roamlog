"use client";

/**
 * Message actions ported from vercel/chatbot
 * `components/chat/message-actions.tsx` @ a8989b52 (Apache-2.0).
 *
 * Adaptation layer:
 * - Copy/edit/regenerate/feedback are wired to the assistant-ui action-bar
 *   primitives. The edit primitive opens `EditComposer`, whose submit path
 *   truncates the tail and regenerates through the thread runtime.
 * - Upstream's SWR vote mutation is replaced by the runtime feedback adapter;
 *   the buttons are present even when a host has not configured persistence.
 * - Text/toast feedback is replaced by primitive state and Chinese aria-labels.
 */

import { ActionBarPrimitive, useAuiState } from "@assistant-ui/react";
import { Button } from "@roamlog/ui";
import { Copy, Pencil, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { memo, useState } from "react";

import { useAiVoteContext } from "./ai-vote-context";
import { cn } from "./cn";

export interface MessageActionsProps {
  role: "user" | "assistant";
  isLoading?: boolean;
  onEdit?: () => void;
}

export function PureMessageActions({ role, isLoading, onEdit }: MessageActionsProps) {
  const running = useAuiState((state) => state.message.status?.type === "running");
  const messageId = useAuiState((state) => state.message.id);
  const { workspaceId, conversationId, votes, setVote } = useAiVoteContext();
  const loading = isLoading ?? running;
  const canPersistVote =
    role === "assistant" && Boolean(workspaceId && conversationId && messageId);
  const isUpvoted = messageId ? votes.get(messageId) : undefined;
  const [voteSaving, setVoteSaving] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  async function castVote(type: "up" | "down"): Promise<void> {
    if (!messageId || voteSaving) return;
    setVoteSaving(true);
    setVoteError(null);
    try {
      await setVote(messageId, type);
    } catch (error) {
      setVoteError(error instanceof Error ? error.message : "反馈保存失败，请重试。");
    } finally {
      setVoteSaving(false);
    }
  }

  if (loading) return null;

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      className={cn(
        "flex items-center gap-1 opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover/message:opacity-100 md:focus-within:opacity-100",
        role === "user" ? "justify-end" : "justify-start",
      )}
    >
      {role === "user" ? (
        onEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="编辑消息"
            title="编辑"
            className="size-8 px-0"
            onClick={onEdit}
          >
            <Pencil aria-hidden="true" className="size-3.5" />
          </Button>
        ) : (
          <ActionBarPrimitive.Edit asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="编辑消息"
              title="编辑"
              className="size-8 px-0"
            >
              <Pencil aria-hidden="true" className="size-3.5" />
            </Button>
          </ActionBarPrimitive.Edit>
        )
      ) : null}

      <ActionBarPrimitive.Copy asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="复制"
          title="复制"
          className="size-8 px-0"
        >
          <Copy aria-hidden="true" className="size-3.5" />
        </Button>
      </ActionBarPrimitive.Copy>

      {role === "assistant" ? (
        <>
          {canPersistVote ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="有帮助"
                title="有帮助"
                aria-pressed={isUpvoted === true}
                data-testid="message-upvote"
                className="size-8 px-0"
                disabled={voteSaving || isUpvoted === true}
                onClick={() => void castVote("up")}
              >
                <ThumbsUp aria-hidden="true" className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="没帮助"
                title="没帮助"
                aria-pressed={isUpvoted === false}
                data-testid="message-downvote"
                className="size-8 px-0"
                disabled={voteSaving || isUpvoted === false}
                onClick={() => void castVote("down")}
              >
                <ThumbsDown aria-hidden="true" className="size-3.5" />
              </Button>
            </>
          ) : (
            <>
              <ActionBarPrimitive.FeedbackPositive asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="有帮助"
                  title="有帮助"
                  className="size-8 px-0"
                >
                  <ThumbsUp aria-hidden="true" className="size-3.5" />
                </Button>
              </ActionBarPrimitive.FeedbackPositive>
              <ActionBarPrimitive.FeedbackNegative asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="没帮助"
                  title="没帮助"
                  className="size-8 px-0"
                >
                  <ThumbsDown aria-hidden="true" className="size-3.5" />
                </Button>
              </ActionBarPrimitive.FeedbackNegative>
            </>
          )}
          <ActionBarPrimitive.Reload asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="重新生成"
              title="重新生成"
              className="size-8 px-0"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
            </Button>
          </ActionBarPrimitive.Reload>
          {voteError ? (
            <span role="alert" className="ml-1 text-xs text-accent-red">
              {voteError}
            </span>
          ) : null}
        </>
      ) : null}
    </ActionBarPrimitive.Root>
  );
}

export const MessageActions = memo(PureMessageActions);
