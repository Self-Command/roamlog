"use client";

import { ThreadPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@roamlog/ui";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AppearanceMode } from "@roamlog/contracts";

import { applyAppearanceToDocument, saveAppearance } from "@/lib/api/appearance";

import { AiMotionStyles } from "./ai-motion";
import { AiVoteProvider } from "./ai-vote-context";
import { MobileChatHeader } from "./chat-header";
import { AssistantMessage, ThinkingMessage, UserMessage } from "./message";
import { EditComposer } from "./message-editor";
import { MultimodalInput } from "./multimodal-input";
import type { SlashCommandHandlers } from "./slash-commands";
import { SuggestedActions } from "./suggested-actions";
import { useAiSuggestedPrompts } from "./use-suggested-prompts";
import {
  latestPendingAnchor,
  scrollAnchorWithinContainer,
  useMessages,
  type ChatStatus,
} from "./use-messages";
import { shareUrlFromThreadCustom, visibilityFromThreadCustom } from "./visibility-selector";

/**
 * Conversation surface. The message viewport is ported from vercel/chatbot
 * `components/chat/messages.tsx:27-131` @ a8989b52 (Apache-2.0); the composer
 * is the complete `multimodal-input.tsx` port in `multimodal-input.tsx`.
 *
 * Slash commands are wired to the real assistant-ui thread item methods and
 * Roamlog's appearance mutation. No command is a visual placeholder.
 */

function EmptyState({
  disabled,
  onSelect,
  suggestions,
}: {
  disabled: boolean;
  onSelect: (suggestion: string) => void;
  suggestions: readonly string[];
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-6 text-center sm:gap-7 sm:py-16">
      <div className="space-y-2">
        <h2 className="font-display text-xl font-semibold leading-tight tracking-[-0.01em] text-ink sm:text-2xl">
          从一个目标开始
        </h2>
        <p className="mx-auto max-w-md text-xs leading-5 text-muted sm:text-sm sm:leading-6">
          描述你的目标、约束和期望结果。信息不足时，助手会先向你提问；确认后再生成计划。
        </p>
        <p className="type-meta text-stone">输入 / 查看会话命令</p>
      </div>
      <div className="w-full max-w-xl" data-testid="ai-empty-suggestions">
        <SuggestedActions
          disabled={disabled}
          onSelect={onSelect}
          suggestions={suggestions}
        />
      </div>
    </div>
  );
}

export interface ChatThreadProps {
  workspaceId: string;
  onOpenSidebar: () => void;
  /** Wired by AiChat to the remote adapter's single transactional delete-all. */
  onDeleteAll?: () => Promise<void>;
}

/**
 * assistant-ui keeps a local thread id and the persisted id on the matching
 * list item. Vote/share APIs only accept the persisted id, so resolve it in one
 * place. A new, unsaved thread has no remote id and therefore no vote store.
 */
export function remoteConversationIdFor(
  threadItems: readonly { id: string; remoteId?: string | undefined }[],
  mainThreadId: string | null | undefined,
): string | null {
  if (!mainThreadId) return null;
  return threadItems.find((item) => item.id === mainThreadId)?.remoteId ?? null;
}

export function ChatThread({ workspaceId, onOpenSidebar, onDeleteAll }: ChatThreadProps) {
  const aui = useAui();
  const currentItem = useAuiState((state) =>
    state.threads.threadItems.find((item) => item.id === state.threads.mainThreadId),
  );
  const remoteConversationId = useAuiState((state) =>
    remoteConversationIdFor(state.threads.threadItems, state.threads.mainThreadId),
  );
  const status: ChatStatus = useAuiState((state) =>
    state.thread.isRunning ? "streaming" : "ready",
  );
  const awaitingFirstToken = useAuiState(
    (state) => state.thread.isRunning && state.thread.messages.at(-1)?.role !== "assistant",
  );
  const messageCount = useAuiState((state) => state.thread.messages.length);
  const suggestions = useAiSuggestedPrompts({ enabled: messageCount === 0 });
  const {
    containerRef,
    endRef,
    hasSentMessage,
    isAtBottom,
    onViewportLeave,
    scrollToBottom,
  } = useMessages({
    status,
    // Existing history must not jump to the bottom when it loads. Auto-follow
    // only while a live turn is producing content.
    autoScroll: messageCount > 0 && status === "streaming",
  });

  const anchorSeen = useRef<WeakSet<Element>>(new WeakSet());
  const pendingAnchorSeen = useRef<WeakSet<Element>>(new WeakSet());
  const hasSentMessageRef = useRef(hasSentMessage);
  const viewportLeaveRef = useRef(onViewportLeave);
  hasSentMessageRef.current = hasSentMessage || status === "streaming";
  viewportLeaveRef.current = onViewportLeave;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const selector = [
      '[data-testid="ask-user-tool"]',
      '[data-testid="confirm-brief-tool"]',
      '[data-testid="plan-surface"]',
    ].join(",");

    const scheduleAnchorScroll = (anchor: Element) => {
      // Wait for the browser to finish the insertion/layout pass; otherwise a
      // bottom-follow mutation can win the race and hide the form header.
      const scroll = () => {
        scrollAnchorWithinContainer(container, anchor);
        viewportLeaveRef.current();
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(scroll));
      } else {
        setTimeout(scroll, 0);
      }
    };

    const markCurrentAnchors = (scrollLatest: boolean) => {
      const anchors = Array.from(container.querySelectorAll(selector));
      const unseen = anchors.filter((anchor) => !anchorSeen.current.has(anchor));
      for (const anchor of unseen) anchorSeen.current.add(anchor);

      // A pending human form restored from persisted history is the task the
      // user must finish. Unlike an old plan card, it must establish its own
      // scroll position even though no live message has been sent this session.
      const pending = latestPendingAnchor(container);
      if (pending && !pendingAnchorSeen.current.has(pending)) {
        pendingAnchorSeen.current.add(pending);
        scheduleAnchorScroll(pending);
        return;
      }

      if (!scrollLatest || !hasSentMessageRef.current) return;
      const latest = unseen.at(-1);
      if (!latest) return;
      scheduleAnchorScroll(latest);
    };

    // Historical anchors are marked as already seen, so opening a conversation
    // does not jump to an old plan card.
    markCurrentAnchors(false);
    const observer = new MutationObserver(() => markCurrentAnchors(true));
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [containerRef]);

  useEffect(() => {
    if (messageCount !== 0) return;
    const container = containerRef.current;
    if (!container) return;
    if (typeof container.scrollTo === "function") {
      container.scrollTo({ top: 0, behavior: "instant" });
    } else {
      container.scrollTop = 0;
    }
  }, [containerRef, messageCount]);

  const [renameOpen, setRenameOpen] = useState(false);
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const sendSuggestion = useCallback(
    (suggestion: string) => {
      if (status === "streaming") return;
      setActionError(null);
      aui.composer.setText(suggestion);
      void aui.composer.send();
    },
    [aui, status],
  );

  const commands = useMemo<SlashCommandHandlers>(
    () => ({
      new: () => {
        setActionError(null);
        aui.threads.switchToNewThread();
      },
      clear: () => {
        setActionError(null);
        aui.thread.reset();
      },
      rename: () => {
        if (!currentItem) {
          throw new Error("当前还没有已保存的会话，请先发送一条消息。");
        }
        setActionError(null);
        setRenameValue(currentItem.title ?? "");
        setRenameOpen(true);
      },
      model: () => {
        setModelSelectorOpen(true);
      },
      theme: async () => {
        const root = document.documentElement;
        const configured = (root.dataset.mode ?? root.dataset.theme ?? "system") as AppearanceMode;
        const resolved =
          configured === "system"
            ? window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light"
            : configured;
        const saved = await saveAppearance({
          mode: resolved === "dark" ? "light" : "dark",
        });
        applyAppearanceToDocument(saved);
      },
      delete: () => {
        if (!currentItem) {
          throw new Error("当前还没有已保存的会话。");
        }
        setActionError(null);
        setDeleteOpen(true);
      },
      purge: () => {
        if (!onDeleteAll) {
          throw new Error("清空会话功能尚未接线。");
        }
        setActionError(null);
        setPurgeOpen(true);
      },
    }),
    [aui, currentItem, onDeleteAll],
  );

  const confirmRename = useCallback(async () => {
    const title = renameValue.trim();
    if (!currentItem || !title || busy) {
      if (!title) setActionError("会话标题不能为空。");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      aui.threads.item({ id: currentItem.id }).rename(title);
      await aui.threads.reload();
      setRenameOpen(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "重命名失败，请重试。");
    } finally {
      setBusy(false);
    }
  }, [aui, busy, currentItem, renameValue]);

  const confirmDelete = useCallback(async () => {
    if (!currentItem || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      aui.threads.item({ id: currentItem.id }).delete();
      aui.threads.switchToNewThread();
      await aui.threads.reload();
      setDeleteOpen(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "删除会话失败，请重试。");
    } finally {
      setBusy(false);
    }
  }, [aui, busy, currentItem]);

  const confirmPurge = useCallback(async () => {
    if (!onDeleteAll || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await onDeleteAll();
      aui.threads.switchToNewThread();
      await aui.threads.reload();
      setPurgeOpen(false);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "清空会话失败，请重试。");
    } finally {
      setBusy(false);
    }
  }, [aui, busy, onDeleteAll]);

  const refreshThreads = useCallback(async () => {
    await aui.threads.reload();
  }, [aui]);

  return (
    <AiVoteProvider workspaceId={workspaceId} conversationId={remoteConversationId}>
      <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
        <AiMotionStyles />
        <MobileChatHeader
          conversationId={currentItem?.remoteId ?? null}
          onOpenSidebar={onOpenSidebar}
          onUpdated={refreshThreads}
          shareUrl={shareUrlFromThreadCustom(currentItem?.custom)}
          title={currentItem?.title?.trim() || "AI 旅行助手"}
          visibility={visibilityFromThreadCustom(currentItem?.custom)}
          workspaceId={workspaceId}
        />

        <div className="relative min-h-0 flex-1">
          <ThreadPrimitive.Viewport
            ref={containerRef}
            autoScroll={false}
            className="h-full min-h-0 overflow-y-auto px-3 py-6 sm:px-4"
          >
            <div className="mx-auto flex min-h-full w-full min-w-0 max-w-3xl flex-col gap-6">
              <ThreadPrimitive.Empty>
                <EmptyState
                  disabled={status === "streaming"}
                  onSelect={sendSuggestion}
                  suggestions={suggestions}
                />
              </ThreadPrimitive.Empty>
              <ThreadPrimitive.Messages
                components={{ UserMessage, AssistantMessage, EditComposer }}
              />
              {awaitingFirstToken ? <ThinkingMessage /> : null}
              <div ref={endRef} className="min-h-6 min-w-6 shrink-0" />
            </div>
          </ThreadPrimitive.Viewport>

          <button
            type="button"
            aria-label="滚动到底部"
            className={`absolute bottom-4 left-1/2 z-10 flex h-7 -translate-x-1/2 items-center rounded-pill border border-hairline-strong bg-surface-2/90 px-3 text-[10px] text-muted backdrop-blur transition-all duration-200 motion-reduce:transition-none ${
              isAtBottom
                ? "pointer-events-none scale-90 opacity-0"
                : "pointer-events-auto scale-100 opacity-100"
            }`}
            onClick={() => scrollToBottom("smooth")}
          >
            <ArrowDown aria-hidden="true" className="size-3" />
          </button>
        </div>

        <div className="border-t border-hairline px-4 py-3">
          <MultimodalInput
            commands={commands}
            modelSelectorOpen={modelSelectorOpen}
            onModelSelectorOpenChange={setModelSelectorOpen}
            workspaceId={workspaceId}
          />
          <p className="mx-auto mt-2 w-full max-w-3xl text-center text-[11px] leading-5 text-stone">
            助手只能先规划；写入必须由你在计划卡里勾选并确认。
          </p>
          {actionError ? (
            <p role="alert" className="mx-auto mt-2 max-w-3xl text-xs text-accent-red">
              {actionError}
            </p>
          ) : null}
        </div>
      </ThreadPrimitive.Root>

      <Dialog
        open={renameOpen}
        onOpenChange={(open) => {
          setRenameOpen(open);
          if (!open) setActionError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名会话</DialogTitle>
            <DialogDescription>标题只影响会话列表，不会改变已有消息。</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmRename();
            }}
          >
            <Input
              aria-label="会话标题"
              autoFocus
              maxLength={120}
              onChange={(event) => setRenameValue(event.target.value)}
              value={renameValue}
            />
            {actionError ? (
              <p role="alert" className="text-xs text-accent-red">
                {actionError}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setActionError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除会话？</DialogTitle>
            <DialogDescription>
              “{currentItem?.title ?? "新会话"}”及其消息将被永久删除，无法撤销。
            </DialogDescription>
          </DialogHeader>
          {actionError ? (
            <p role="alert" className="text-xs text-accent-red">
              {actionError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={() => void confirmDelete()}
            >
              {busy ? "删除中…" : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={purgeOpen}
        onOpenChange={(open) => {
          setPurgeOpen(open);
          if (!open) setActionError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空全部会话？</DialogTitle>
            <DialogDescription>所有 AI 会话和消息都会被永久删除，无法撤销。</DialogDescription>
          </DialogHeader>
          {actionError ? (
            <p role="alert" className="text-xs text-accent-red">
              {actionError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPurgeOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={() => void confirmPurge()}
            >
              {busy ? "清空中…" : "全部删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AiVoteProvider>
  );
}
