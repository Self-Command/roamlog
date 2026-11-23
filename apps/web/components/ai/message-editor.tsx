"use client";

/**
 * Edit composer ported from vercel/chatbot
 * `components/chat/message-editor.tsx` @ a8989b522fa3672a2ae52f053105e40993b36ca1
 * (Apache-2.0).
 *
 * Adaptation layer: assistant-ui owns the edit composer runtime. Roamlog
 * explicitly deletes the edited message and every later persisted message
 * before appending the replacement, mirroring upstream's
 * `deleteTrailingMessages` call. The visual primitive is local so Roamlog's
 * tokens and Chinese copy apply.
 */

import { ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { Button } from "@roamlog/ui";
import { useCallback, useMemo, useState, type FormEvent } from "react";

import { deleteConversationMessages } from "../../lib/api/ai-conversations";
import { useAiVoteContext } from "./ai-vote-context";

export function EditComposer() {
  const aui = useAui();
  const sourceId = useAuiState((state) => state.message.id);
  const messages = useAuiState((state) => state.thread.messages);
  const canSend = useAuiState((state) => state.composer.canSend);
  const remoteConversationId = useAuiState(
    (state) =>
      state.threads.threadItems.find((item) => item.id === state.threads.mainThreadId)?.remoteId ??
      null,
  );
  const { workspaceId, conversationId: contextConversationId } = useAiVoteContext();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Upstream `submitEditedMessage` deletes the edited message and every later
   * message before it regenerates (`message-editor.tsx:18-30`). assistant-ui
   * would otherwise keep the old branch in the database. We delete by the
   * persisted client ids first, then let the edit composer append the new
   * branch.
   */
  const conversationId = remoteConversationId ?? contextConversationId;
  const idsToDelete = useMemo(() => {
    const index = messages.findIndex((message) => message.id === sourceId);
    return index === -1 ? [] : messages.slice(index).map((message) => message.id);
  }, [messages, sourceId]);

  const submit = useCallback(async (): Promise<void> => {
    if (saving || !canSend) return;
    setSaving(true);
    setError(null);
    try {
      if (workspaceId && conversationId && idsToDelete.length > 0) {
        await deleteConversationMessages(workspaceId, conversationId, idsToDelete);
      }
      await aui.composer.send();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存编辑失败，请重试。");
    } finally {
      setSaving(false);
    }
  }, [aui, canSend, conversationId, idsToDelete, saving, workspaceId]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submit();
    },
    [submit],
  );

  return (
    <ComposerPrimitive.Root
      aria-label="编辑消息"
      className="ml-auto flex w-full max-w-[85%] flex-col gap-2 rounded-card border border-hairline-strong bg-surface-2 px-3 py-2"
      onSubmit={handleSubmit}
    >
      <ComposerPrimitive.Input
        aria-label="编辑消息内容"
        autoFocus
        rows={2}
        maxRows={8}
        className="min-h-12 w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-ink outline-none placeholder:text-stone"
      />
      {error ? (
        <p
          className="px-1 text-xs leading-5 text-accent-red"
          data-testid="message-edit-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <ComposerPrimitive.Cancel asChild>
          <Button type="button" variant="ghost" size="sm">
            取消
          </Button>
        </ComposerPrimitive.Cancel>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          aria-busy={saving}
          data-testid="message-edit-send"
          disabled={!canSend || saving}
        >
          {saving ? "保存中…" : "保存并重新生成"}
        </Button>
      </div>
    </ComposerPrimitive.Root>
  );
}
