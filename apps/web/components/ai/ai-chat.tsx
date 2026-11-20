"use client";

import type { WorkspaceRole } from "@roamlog/contracts";
import {
  AssistantRuntimeProvider,
  useAui,
  useLocalRuntime,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { Button } from "@roamlog/ui";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { PLAN_TOOL_NAME, createAiChatModelAdapter } from "./chat-model-adapter";
import { WorkspaceChatProvider } from "./plan-card";
import {
  createRemoteThreadListAdapter,
  useConversationSync,
  type RemoteConversationThreadListAdapter,
} from "./thread-list-adapter";
import { AiThreadList } from "./thread-list";
import { ChatThread } from "./thread";

/**
 * The single-column conversation shell for `/w/{slug}/ai`.
 *
 * Runtime composition follows the assistant-ui docs for a chat with a thread
 * list: `useRemoteThreadListRuntime({ adapter, runtimeHook })` wraps
 * `useLocalRuntime(chatModelAdapter, { unstable_humanToolNames })`, and
 * `AssistantRuntimeProvider` exposes it to the primitives.
 *
 * `workspaceId` is resolved from `workspaceSlug` one level up, in
 * `AiAssistant` (`useWorkspaceBySlug(workspaceSlug) -> workspace.id`). The
 * remote thread-list adapter therefore never derives a workspace from the URL
 * itself, and every conversation request is scoped to the same id the rest of
 * the page uses.
 */

export interface AiChatProps {
  workspaceId: string;
  workspaceSlug: string;
  role: WorkspaceRole;
}

/**
 * Inline state strip for the sidebar (loading/empty/error) and the main column
 * (write failures). Every string is Chinese and every error is retryable — a
 * failed request never silently falls back to localStorage.
 */
export function ConversationSyncStatus({
  adapter,
  variant,
  onRetry,
}: {
  adapter: RemoteConversationThreadListAdapter;
  variant: "sidebar" | "banner";
  onRetry?: () => void | Promise<void>;
}) {
  const sync = useConversationSync(adapter);
  const [retrying, setRetrying] = useState(false);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      if (onRetry) await onRetry();
      else await adapter.sync.retry();
    } catch {
      // The adapter store already holds the translated, user-facing error.
    } finally {
      setRetrying(false);
    }
  }, [adapter, onRetry]);

  const errors: string[] = [];
  if (sync.listError) errors.push(`会话列表加载失败：${sync.listError}`);
  if (sync.writeError) errors.push(`消息尚未保存：${sync.writeError}`);

  const hasError = errors.length > 0;
  const hasPending = sync.pendingWrites > 0;
  const showLoading = sync.phase === "loading" && !hasError;
  const showEmpty = sync.phase === "ready" && sync.threadCount === 0 && !hasError;
  const visible =
    variant === "banner"
      ? hasError || hasPending
      : hasError || hasPending || showLoading || showEmpty;
  if (!visible) return null;

  return (
    <div
      role={hasError ? "alert" : "status"}
      aria-live={hasError ? "assertive" : "polite"}
      className={
        variant === "sidebar"
          ? "shrink-0 space-y-1 border-b border-hairline px-3 py-2 text-xs text-stone"
          : "flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface-0 px-3 py-2 text-xs text-stone"
      }
    >
      <div className="space-y-1">
        {errors.map((error) => (
          <p key={error} className={hasError ? "text-accent-red" : undefined}>
            {error}
          </p>
        ))}
        {!hasError && showLoading ? <p>正在加载会话…</p> : null}
        {!hasError && showEmpty ? <p>还没有会话，发送第一条消息开始。</p> : null}
        {!hasError && hasPending ? <p>正在保存 {sync.pendingWrites} 条消息…</p> : null}
      </div>
      {hasError || hasPending ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void retry()}
          disabled={retrying}
        >
          {retrying ? "重试中…" : "重试"}
        </Button>
      ) : null}
    </div>
  );
}

function RuntimeConversationSyncStatus({
  adapter,
  variant,
}: {
  adapter: RemoteConversationThreadListAdapter;
  variant: "sidebar" | "banner";
}) {
  const aui = useAui();
  const retry = useCallback(async () => {
    await adapter.sync.retry();
    await aui.threads.reload();
  }, [adapter, aui]);

  return <ConversationSyncStatus adapter={adapter} variant={variant} onRetry={retry} />;
}

export function AiChat({ workspaceId, workspaceSlug, role }: AiChatProps) {
  const canWrite = role === "owner" || role === "admin" || role === "editor";

  const chatModel = useMemo(
    () => createAiChatModelAdapter({ workspaceId, canWrite }),
    [workspaceId, canWrite],
  );
  const threadListAdapter = useMemo(
    () => createRemoteThreadListAdapter(workspaceId),
    [workspaceId],
  );

  const runtimeHook = useCallback(
    () =>
      useLocalRuntime(chatModel, {
        unstable_humanToolNames: [PLAN_TOOL_NAME],
      }),
    [chatModel],
  );

  const runtime = useRemoteThreadListRuntime({
    adapter: threadListAdapter,
    runtimeHook,
  });

  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const context = useMemo(
    () => ({ workspaceSlug, canWrite }),
    [workspaceSlug, canWrite],
  );

  return (
    <WorkspaceChatProvider value={context}>
      <AssistantRuntimeProvider runtime={runtime}>
        <div className="flex h-[calc(100dvh-15rem)] min-h-[560px] overflow-hidden rounded-card border border-hairline-strong bg-surface-0">
          {collapsed ? null : (
            <aside
              aria-label="会话列表"
              className="hidden w-[248px] shrink-0 border-r border-hairline lg:block"
            >
              <div className="flex h-full min-h-0 flex-col">
                <RuntimeConversationSyncStatus adapter={threadListAdapter} variant="sidebar" />
                <div className="min-h-0 flex-1">
                  <AiThreadList />
                </div>
              </div>
            </aside>
          )}

          {drawerOpen ? (
            <div className="fixed inset-0 z-40 lg:hidden">
              <button
                type="button"
                aria-label="关闭会话列表"
                className="absolute inset-0 bg-black/60"
                onClick={() => setDrawerOpen(false)}
              />
              <div className="absolute inset-y-0 left-0 w-[80%] max-w-[320px] border-r border-hairline-strong shadow-xl">
                <div className="flex h-full min-h-0 flex-col">
                  <RuntimeConversationSyncStatus adapter={threadListAdapter} variant="sidebar" />
                  <div className="min-h-0 flex-1">
                    <AiThreadList onClose={() => setDrawerOpen(false)} />
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="hidden items-center gap-2 border-b border-hairline px-3 py-2 lg:flex">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={collapsed ? "展开会话列表" : "收起会话列表"}
                onClick={() => setCollapsed((value) => !value)}
              >
                {collapsed ? (
                  <PanelLeftOpen aria-hidden="true" className="size-4" />
                ) : (
                  <PanelLeftClose aria-hidden="true" className="size-4" />
                )}
              </Button>
              <p className="type-meta truncate">AI 旅行助手 · 先计划，后写入</p>
            </div>

            <RuntimeConversationSyncStatus adapter={threadListAdapter} variant="banner" />

            <div className="min-h-0 flex-1">
              <ChatThread onOpenSidebar={() => setDrawerOpen(true)} />
            </div>
          </div>
        </div>
      </AssistantRuntimeProvider>
    </WorkspaceChatProvider>
  );
}
