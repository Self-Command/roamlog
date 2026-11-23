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
import { useCallback, useEffect, useMemo, useState } from "react";

import { PLAN_TOOL_NAME, createAiChatModelAdapter } from "./chat-model-adapter";
import { createMediaAttachmentAdapter } from "./media-attachment-adapter";
import { WorkspaceChatProvider } from "./plan-card";
import { AiArtifactProvider } from "./artifacts/artifact-context";
import { ArtifactPanel } from "./artifacts/artifact-panel";
import {
  createRemoteThreadListAdapter,
  useConversationSync,
  type RemoteConversationThreadListAdapter,
} from "./thread-list-adapter";
import { AiThreadList } from "./thread-list";
import { ChatThread } from "./thread";
import { useAutoResume } from "./use-auto-resume";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

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
  initialConversationId?: string | undefined;
}

function conversationIdFromLocation(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URL(window.location.href).searchParams.get("conversation");
  return value?.trim() ? value : undefined;
}

function updateConversationUrl(threadId: string | undefined, mode: "push" | "replace"): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const current = url.searchParams.get("conversation") ?? undefined;
  if (current === threadId) return;
  if (threadId) url.searchParams.set("conversation", threadId);
  else url.searchParams.delete("conversation");
  const target = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "push") window.history.pushState({}, "", target);
  else window.history.replaceState({}, "", target);
}

function readSidebarOpenCookie(): boolean | null {
  if (typeof document === "undefined") return null;
  const prefix = `${SIDEBAR_COOKIE_NAME}=`;
  const value = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function persistSidebarOpen(open: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SIDEBAR_COOKIE_NAME}=${String(open)}; path=/; max-age=${String(
    SIDEBAR_COOKIE_MAX_AGE,
  )}`;
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

function AutoResumeThread({
  workspaceId,
  conversationId,
}: {
  workspaceId: string;
  conversationId: string | null;
}) {
  useAutoResume({ workspaceId, conversationId });
  return null;
}

export function AiChat({ workspaceId, workspaceSlug, role, initialConversationId }: AiChatProps) {
  const canWrite = role === "owner" || role === "admin" || role === "editor";

  const chatModel = useMemo(
    () => createAiChatModelAdapter({ workspaceId, canWrite }),
    [workspaceId, canWrite],
  );
  const threadListAdapter = useMemo(
    () => createRemoteThreadListAdapter(workspaceId),
    [workspaceId],
  );
  // One attachment pipeline per page: uploads go straight into the media store,
  // so a remount mid-upload does not orphan a second upload of the same file.
  const attachmentAdapter = useMemo(
    () => createMediaAttachmentAdapter({ workspaceId }),
    [workspaceId],
  );
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setConversationId(initialConversationId);
  }, [initialConversationId]);

  useEffect(() => {
    const persisted = readSidebarOpenCookie();
    if (persisted !== null) setCollapsed(!persisted);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  useEffect(() => {
    const handlePopState = () => setConversationId(conversationIdFromLocation());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setDrawerOpen((open) => !open);
      return;
    }
    setCollapsed((current) => {
      const next = !current;
      persistSidebarOpen(!next);
      return next;
    });
  }, [isMobile]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "b" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  useEffect(() => {
    if (!drawerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  const handleThreadIdChange = useCallback((threadId: string | undefined) => {
    setConversationId(threadId);
    updateConversationUrl(threadId, threadId ? "push" : "replace");
  }, []);

  const handleDeleteAll = useCallback(() => threadListAdapter.deleteAll(), [threadListAdapter]);

  const runtimeHook = useCallback(
    () =>
      useLocalRuntime(chatModel, {
        unstable_humanToolNames: [PLAN_TOOL_NAME],
        adapters: { attachments: attachmentAdapter },
      }),
    [chatModel, attachmentAdapter],
  );

  const runtime = useRemoteThreadListRuntime({
    adapter: threadListAdapter,
    runtimeHook,
    threadId: conversationId,
    onThreadIdChange: handleThreadIdChange,
  });

  const context = useMemo(() => ({ workspaceSlug, canWrite }), [workspaceSlug, canWrite]);

  return (
    <AiArtifactProvider workspaceId={workspaceId}>
      <WorkspaceChatProvider value={context}>
        <AssistantRuntimeProvider runtime={runtime}>
        <AutoResumeThread workspaceId={workspaceId} conversationId={conversationId ?? null} />
        <div className="flex h-[calc(100dvh-15rem)] min-h-[560px] overflow-hidden rounded-card border border-hairline-strong bg-surface-0">
          {collapsed ? null : (
            <aside
              aria-label="会话列表"
              className="hidden w-[248px] shrink-0 border-r border-hairline lg:block"
            >
              <div className="flex h-full min-h-0 flex-col">
                <RuntimeConversationSyncStatus adapter={threadListAdapter} variant="sidebar" />
                <div className="min-h-0 flex-1">
                  <AiThreadList adapter={threadListAdapter} />
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
                    <AiThreadList
                      adapter={threadListAdapter}
                      onClose={() => setDrawerOpen(false)}
                    />
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
                aria-expanded={!collapsed}
                onClick={toggleSidebar}
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
              <ChatThread
                workspaceId={workspaceId}
                onDeleteAll={handleDeleteAll}
                onOpenSidebar={() => setDrawerOpen(true)}
              />
            </div>
          </div>
          <ArtifactPanel />
        </div>
        </AssistantRuntimeProvider>
      </WorkspaceChatProvider>
    </AiArtifactProvider>
  );
}
