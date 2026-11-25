"use client";

import type { WorkspaceRole } from "@roamlog/contracts";
import {
  AuiConfig,
  AssistantRuntimeProvider,
  Tools,
  useAui,
  useLocalRuntime,
  useRemoteThreadListRuntime,
  unstable_Interactables,
} from "@assistant-ui/react";
import { Button } from "@roamlog/ui";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PLAN_TOOL_NAME, createAiChatModelAdapter } from "./chat-model-adapter";
import { DesktopChatHeader } from "./chat-header";
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
import { workflowToolkit } from "./workflow";
import {
  createDraftPersistence,
  DraftScopeProvider,
} from "./workflow/draft-persistence";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

// The generative toolkit contains human tools only. The compiled build stamps
// `type: "human"`; the authored source exposes `execute`, so key iteration is
// the one representation shared by both.
const WORKFLOW_HUMAN_TOOL_NAMES = Object.keys(workflowToolkit);

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
  /**
   * Stable signed-in user id. It namespaces same-device human-tool drafts.
   * Optional only for isolated component tests; production always passes it.
   */
  userId?: string | undefined;
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

export function AiChat({
  workspaceId,
  workspaceSlug,
  userId,
  role,
  initialConversationId,
}: AiChatProps) {
  const canWrite = role === "owner" || role === "admin" || role === "editor";
  const draftUserId = userId ?? "anonymous";
  const assistantConfig = useMemo(
    () =>
      AuiConfig({
        tools: Tools({ toolkit: workflowToolkit }),
        unstable_interactables: unstable_Interactables({
          persistence: createDraftPersistence(workspaceId, draftUserId),
        }),
      }),
    [draftUserId, workspaceId],
  );

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

  // The mobile chat is a fixed surface between the app header and bottom nav.
  // The page underneath no longer needs to scroll, and leaving the body
  // scrollbar visible would draw a dark strip over the right edge of the
  // full-bleed panel (especially on Windows). Restore both elements on route
  // change or when crossing the desktop breakpoint.
  useEffect(() => {
    if (!isMobile) return;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
    };
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
        unstable_humanToolNames: [PLAN_TOOL_NAME, ...WORKFLOW_HUMAN_TOOL_NAMES],
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
        <DraftScopeProvider conversationId={conversationId}>
          <AssistantRuntimeProvider config={assistantConfig} runtime={runtime}>
            <AutoResumeThread workspaceId={workspaceId} conversationId={conversationId ?? null} />
          {/*
            Mobile chat owns the space between the sticky app header and the
            fixed bottom navigation. On a 360–390 px phone the page header would
            otherwise push the composer behind `MobileNav`; making the chat a
            dedicated fixed surface is the same shell model as the upstream
            full-height chat, adapted to Roamlog's app frame. Desktop keeps the
            bordered in-page card.
          */}
          <div
            className="fixed inset-x-0 top-16 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 flex overflow-hidden border-y border-hairline-strong bg-surface-1 md:static md:z-auto md:h-[calc(100dvh-15rem)] md:min-h-[560px] md:rounded-card md:border"
            data-testid="ai-chat-shell"
          >
            {collapsed ? null : (
              <aside
                aria-label="会话列表"
                className="hidden w-[248px] shrink-0 border-r border-hairline lg:block"
              >
                <div className="flex h-full min-h-0 flex-col">
                  <RuntimeConversationSyncStatus adapter={threadListAdapter} variant="sidebar" />
                  <div className="min-h-0 flex-1">
                    <AiThreadList adapter={threadListAdapter} workspaceId={workspaceId} />
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
                        workspaceId={workspaceId}
                        onClose={() => setDrawerOpen(false)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex min-w-0 flex-1 flex-col">
              <DesktopChatHeader
                collapsed={collapsed}
                onToggleSidebar={toggleSidebar}
                workspaceId={workspaceId}
              />

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
        </DraftScopeProvider>
      </WorkspaceChatProvider>
    </AiArtifactProvider>
  );
}
