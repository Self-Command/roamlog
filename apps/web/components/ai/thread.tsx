"use client";

import {
  ComposerPrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import { Button } from "@roamlog/ui";
import { ArrowDown, ArrowUp, PanelLeft, Square } from "lucide-react";
import { useEffect } from "react";

import { AssistantMessage, UserMessage } from "./message";
import { useMessages, type ChatStatus } from "./use-messages";

/**
 * The conversation surface: message list + fixed composer.
 *
 * The outer structure is ported from vercel/chatbot `components/chat/messages.tsx`
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0), L27–L131:
 * scroll container → message rows → bottom anchor → floating scroll-to-bottom
 * button. assistant-ui's `ThreadPrimitive.Viewport/Messages/Empty` replace the
 * upstream `useChatHelpers` plumbing; `use-messages.ts` is the ported scroll
 * hook and drives the same auto-follow behaviour.
 *
 * Composer, mobile header and suggestions keep the existing Roamlog styling.
 */

const SUGGESTIONS = [
  "想去京都一周，预算 8000，喜欢古寺和咖啡馆",
  "带爸妈去成都四天，节奏慢一点，少走路",
  "周末去杭州，预算 2000，想住湖边",
] as const;

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center sm:py-16">
      <div className="space-y-2">
        <h2 className="font-serif text-2xl leading-tight tracking-[-0.02em] text-ink sm:text-3xl">
          先计划，后写入
        </h2>
        <p className="mx-auto max-w-md text-sm leading-6 text-muted">
          用一句话描述目的地、时间和预算。助手只做只读搜索并列出准备执行的操作，你确认后才会写入工作区。
        </p>
      </div>
      <ul className="flex w-full max-w-xl flex-col gap-2">
        {SUGGESTIONS.map((prompt) => (
          <li key={prompt}>
            <ThreadPrimitive.Suggestion
              prompt={prompt}
              send
              className="w-full rounded-control border border-hairline bg-surface-1 px-4 py-3 text-left text-sm leading-6 text-body outline-none transition-colors hover:border-hairline-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0"
            >
              {prompt}
            </ThreadPrimitive.Suggestion>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StopButton() {
  const aui = useAui();
  const running = useAuiState((state) => state.thread.isRunning);
  if (!running) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label="停止生成"
      className="shrink-0"
      onClick={() => aui.thread.cancelRun()}
    >
      <Square aria-hidden="true" className="size-3.5" />
    </Button>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-card border border-hairline-strong bg-surface-1 px-2 py-2 focus-within:border-ink/40">
      <ComposerPrimitive.Input
        aria-label="给 AI 助手发消息"
        placeholder="想去哪里？说一句就行（Enter 发送，Shift+Enter 换行）"
        rows={1}
        maxRows={8}
        className="max-h-48 min-h-9 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-6 text-ink outline-none placeholder:text-stone"
      />
      <StopButton />
      <ComposerPrimitive.Send asChild>
        <Button type="button" variant="primary" size="sm" aria-label="发送" className="shrink-0">
          <ArrowUp aria-hidden="true" className="size-4" />
        </Button>
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}

export interface ChatThreadProps {
  onOpenSidebar: () => void;
}

export function ChatThread({ onOpenSidebar }: ChatThreadProps) {
  const aui = useAui();
  const status: ChatStatus = useAuiState((state) =>
    state.thread.isRunning ? "streaming" : "ready",
  );
  const { containerRef, endRef, isAtBottom, scrollToBottom } = useMessages({
    status,
  });

  // Leaving the thread (route change / unmount) must abort the in-flight run,
  // otherwise the server keeps generating into a socket nobody watches and the
  // message stays "running" until a manual stop.
  useEffect(
    () => () => {
      try {
        aui.thread.cancelRun();
      } catch {
        // The runtime can already be torn down during navigation.
      }
    },
    [aui],
  );

  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2 lg:hidden">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="打开会话列表"
          onClick={onOpenSidebar}
        >
          <PanelLeft aria-hidden="true" className="size-4" />
        </Button>
        <p className="type-meta truncate">AI 旅行助手</p>
      </div>

      <div className="relative min-h-0 flex-1">
        <ThreadPrimitive.Viewport
          ref={containerRef}
          autoScroll={false}
          className="h-full min-h-0 overflow-y-auto px-3 py-6 sm:px-4"
        >
          <div className="mx-auto flex min-h-full w-full min-w-0 max-w-3xl flex-col gap-6">
            <ThreadPrimitive.Empty>
              <EmptyState />
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages
              components={{ UserMessage, AssistantMessage }}
            />
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
        <Composer />
        <p className="mx-auto mt-2 w-full max-w-3xl text-center text-[11px] leading-5 text-stone">
          助手只能先规划；写入必须由你在计划卡里勾选并确认。
        </p>
      </div>
    </ThreadPrimitive.Root>
  );
}
