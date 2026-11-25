"use client";

import {
  ThreadListItemByIndexProvider,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from "@roamlog/ui";
import { LoaderCircle, MessageSquarePlus, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  useConversationSync,
  type RemoteConversationThreadListAdapter,
} from "./thread-list-adapter";
import {
  ConversationVisibilitySubmenu,
  shareUrlFromThreadCustom,
  visibilityFromThreadCustom,
} from "./visibility-selector";

/**
 * Ported behavior from vercel/chatbot
 * `components/chat/sidebar-history.tsx:33-360`,
 * `components/chat/sidebar-history-item.tsx:29-132` and
 * `components/chat/app-sidebar.tsx:47-176`:
 * date buckets, load-more, item menu, delete-one confirmation, delete-all
 * confirmation, active item, and mobile close-on-select.
 *
 * The Roamlog adaptation uses assistant-ui thread state instead of SWR, and
 * localizes labels/theme tokens. Grouping uses assistant-ui's canonical
 * `lastMessageAt` because the Roamlog server list is ordered by that field
 * (`AiConversationService.list`); the boundaries still match date-fns
 * `isToday`, `isYesterday`, `subWeeks(1)` and `subMonths(1)`. Rename is a
 * Roamlog backend capability that upstream's menu does not expose; the Share
 * submenu is deferred to the visibility/vote wave because no visibility
 * contract exists yet.
 */

const DAY_MS = 86_400_000;

export type ThreadGroupKey = "today" | "yesterday" | "lastWeek" | "lastMonth" | "older" | "unknown";

export interface ThreadListDateItem {
  readonly lastMessageAt?: Date | undefined;
}

export interface ThreadGroup<T extends ThreadListDateItem = ThreadListDateItem> {
  readonly key: ThreadGroupKey;
  readonly label: string;
  readonly items: readonly {
    readonly item: T;
    readonly index: number;
  }[];
}

const GROUP_LABELS: Readonly<Record<ThreadGroupKey, string>> = {
  today: "今天",
  yesterday: "昨天",
  lastWeek: "最近 7 天",
  lastMonth: "最近 30 天",
  older: "更早",
  unknown: "无时间",
};

const GROUP_ORDER: readonly ThreadGroupKey[] = [
  "today",
  "yesterday",
  "lastWeek",
  "lastMonth",
  "older",
  "unknown",
];

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function monthAgo(now: Date): Date {
  const value = new Date(now);
  value.setMonth(value.getMonth() - 1);
  return value;
}

function groupKeyFor(date: Date | undefined, now: Date): ThreadGroupKey {
  if (!date || Number.isNaN(date.getTime())) return "unknown";
  const today = startOfDay(now);
  const time = date.getTime();
  if (time >= today) return "today";
  if (time >= today - DAY_MS) return "yesterday";
  if (time > now.getTime() - 7 * DAY_MS) return "lastWeek";
  if (time > monthAgo(now).getTime()) return "lastMonth";
  return "older";
}

/**
 * Pure grouping helper. The thread order from assistant-ui is already
 * server-ordered (lastMessageAt desc, id desc), so grouping preserves it.
 */
export function groupThreads<T extends ThreadListDateItem>(
  items: readonly T[],
  now = new Date(),
): readonly ThreadGroup<T>[] {
  const buckets = new Map<ThreadGroupKey, Array<{ item: T; index: number }>>();
  items.forEach((item, index) => {
    const key = groupKeyFor(item.lastMessageAt, now);
    const bucket = buckets.get(key) ?? [];
    bucket.push({ item, index });
    buckets.set(key, bucket);
  });

  return GROUP_ORDER.flatMap((key) => {
    const bucket = buckets.get(key);
    return bucket && bucket.length > 0 ? [{ key, label: GROUP_LABELS[key], items: bucket }] : [];
  });
}

function ThreadListItem({
  workspaceId,
  onRequestDelete,
  onRequestRename,
  onClose,
}: {
  workspaceId: string;
  onRequestDelete: (target: { id: string; title: string }) => void;
  onRequestRename: (target: { id: string; title: string }) => void;
  onClose?: () => void;
}) {
  const aui = useAui();
  const item = useAuiState((state) => state.threadListItem);
  const isActive = useAuiState((state) => state.threads.mainThreadId === state.threadListItem.id);
  const title = item.title?.trim() || "新会话";
  const refreshThreads = useCallback(async () => {
    await aui.threads.reload();
  }, [aui]);

  return (
    <ThreadListItemPrimitive.Root
      data-testid="thread-list-item"
      data-active={isActive ? "true" : undefined}
      className="group flex items-center gap-1 rounded-control px-1 data-[active]:bg-surface-2"
    >
      <ThreadListItemPrimitive.Trigger
        className="min-w-0 flex-1 truncate px-2 py-2 text-left text-sm text-body outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-surface-0 group-data-[active]:font-medium group-data-[active]:text-ink"
        onClick={onClose}
      >
        <ThreadListItemPrimitive.Title fallback="新会话" />
      </ThreadListItemPrimitive.Trigger>

      {item.isRunning ? (
        <LoaderCircle aria-label="正在生成" className="size-3.5 shrink-0 animate-spin text-muted" />
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`会话操作：${title}`}
            className="mr-1 hidden shrink-0 rounded-[6px] p-1.5 text-stone outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink group-hover:block data-[state=open]:block data-[state=open]:text-ink"
          >
            <MoreHorizontal aria-hidden="true" className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {item.remoteId ? (
            <ConversationVisibilitySubmenu
              conversationId={item.remoteId}
              onUpdated={refreshThreads}
              shareUrl={shareUrlFromThreadCustom(item.custom)}
              visibility={visibilityFromThreadCustom(item.custom)}
              workspaceId={workspaceId}
            />
          ) : null}
          <DropdownMenuItem
            onSelect={() => onRequestRename({ id: item.id, title: item.title ?? "" })}
          >
            <Pencil aria-hidden="true" className="size-3.5" />
            重命名
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-accent-red focus:text-accent-red"
            onSelect={() => onRequestDelete({ id: item.id, title })}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ThreadListItemPrimitive.Root>
  );
}

function LoadMoreSentinel() {
  const aui = useAui();
  const hasMore = useAuiState((state) => state.threads.hasMore);
  const isLoadingMore = useAuiState((state) => state.threads.isLoadingMore);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore || isLoadingMore || typeof IntersectionObserver === "undefined") return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void aui.threads.loadMore();
        }
      },
      { rootMargin: "120px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [aui, hasMore, isLoadingMore]);

  if (!hasMore) return null;
  return (
    <div ref={sentinelRef} className="flex justify-center py-2">
      <ThreadListPrimitive.LoadMore asChild>
        <Button type="button" variant="ghost" size="sm" disabled={isLoadingMore}>
          {isLoadingMore ? (
            <>
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              加载中…
            </>
          ) : (
            "加载更多"
          )}
        </Button>
      </ThreadListPrimitive.LoadMore>
    </div>
  );
}

export function AiThreadList({
  adapter,
  workspaceId,
  onClose,
}: {
  adapter: RemoteConversationThreadListAdapter;
  workspaceId: string;
  onClose?: () => void;
}) {
  const aui = useAui();
  const threadItems = useAuiState((state) => state.threads.threadItems);
  const threadIds = useAuiState((state) => state.threads.threadIds);
  const currentThreadId = useAuiState((state) => state.threads.mainThreadId);
  const sync = useConversationSync(adapter);
  const now = useMemo(() => new Date(), []);
  // `ThreadListItemByIndexProvider` resolves by `threadIds[index]`. Use that
  // exact collection so a transient state where `threadItems` has a row before
  // `threadIds` cannot render with an undefined index.
  const items = useMemo(() => {
    const byId = new Map(threadItems.map((item) => [item.id, item]));
    return threadIds.flatMap((id) => {
      const item = byId.get(id);
      return item ? [item] : [];
    });
  }, [threadIds, threadItems]);
  const groups = useMemo(() => groupThreads(items, now), [items, now]);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const renameInputId = useId();

  const requestDelete = useCallback((target: { id: string; title: string }) => {
    setActionError(null);
    setDeleteTarget(target);
  }, []);

  const requestRename = useCallback((target: { id: string; title: string }) => {
    setActionError(null);
    setRenameValue(target.title);
    setRenameTarget(target);
  }, []);

  const remoteIdFor = useCallback(
    (localId: string) => items.find((item) => item.id === localId)?.remoteId,
    [items],
  );

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || busy) return;
    const remoteId = remoteIdFor(deleteTarget.id);
    if (!remoteId) {
      setActionError("这个会话还没有保存，请刷新页面后重试。");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const deletingCurrent = currentThreadId === deleteTarget.id;
      await adapter.delete(remoteId);
      setDeleteTarget(null);
      if (deletingCurrent) aui.threads.switchToNewThread();
      await aui.threads.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "删除会话失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRename(): Promise<void> {
    if (!renameTarget || busy) return;
    const title = renameValue.trim();
    if (!title) {
      setActionError("会话标题不能为空。");
      return;
    }
    const remoteId = remoteIdFor(renameTarget.id);
    if (!remoteId) {
      setActionError("这个会话还没有保存，请刷新页面后重试。");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await adapter.rename(remoteId, title);
      setRenameTarget(null);
      await aui.threads.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "重命名失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteAll(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await adapter.deleteAll();
      setDeleteAllOpen(false);
      aui.threads.switchToNewThread();
      await aui.threads.reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "清空会话失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThreadListPrimitive.Root className="flex h-full min-h-0 flex-col bg-surface-0">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <p className="type-meta">会话</p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="清空全部会话"
            title="清空全部会话"
            onClick={() => {
              setActionError(null);
              setDeleteAllOpen(true);
            }}
          >
            <Trash2 aria-hidden="true" className="size-4" />
          </Button>
          <ThreadListPrimitive.New asChild>
            <Button type="button" variant="ghost" size="sm" aria-label="新建会话" onClick={onClose}>
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

      {actionError ? (
        <p role="alert" className="border-b border-hairline px-3 py-2 text-xs text-accent-red">
          {actionError}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {items.length === 0 && (sync.phase === "idle" || sync.phase === "loading") ? (
          <div aria-label="正在加载会话" className="space-y-1 px-1 py-2">
            {[44, 32, 28, 64, 52].map((width) => (
              <div key={width} className="flex h-8 items-center rounded-control px-2">
                <div
                  className="h-3 animate-pulse rounded-md bg-ink/[0.06]"
                  style={{ width: `${String(width)}%` }}
                />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <p className="px-2 py-4 text-xs leading-5 text-stone">
            {sync.phase === "error" ? "会话列表加载失败。" : "你的对话会出现在这里。"}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.key} aria-labelledby={`thread-group-${group.key}`} className="pb-2">
              <h2
                id={`thread-group-${group.key}`}
                className="px-2 pt-2 pb-1 type-meta text-[10px] uppercase tracking-[0.12em] text-stone"
              >
                {group.label}
              </h2>
              <div className="space-y-px">
                {group.items.map(({ item, index }) => (
                  <ThreadListItemByIndexProvider key={item.id} index={index} archived={false}>
                    <ThreadListItem
                      workspaceId={workspaceId}
                      onRequestDelete={requestDelete}
                      onRequestRename={requestRename}
                      {...(onClose ? { onClose } : {})}
                    />
                  </ThreadListItemByIndexProvider>
                ))}
              </div>
            </section>
          ))
        )}
        <LoadMoreSentinel />
      </div>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除会话？</DialogTitle>
            <DialogDescription>
              “{deleteTarget?.title ?? "新会话"}”及其消息将被永久删除，无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
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

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
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
            <label htmlFor={renameInputId} className="type-eyebrow">
              会话标题
            </label>
            <Input
              id={renameInputId}
              value={renameValue}
              maxLength={120}
              autoFocus
              onChange={(event) => setRenameValue(event.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
                取消
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清空全部会话？</DialogTitle>
            <DialogDescription>所有 AI 会话和消息都会被永久删除，无法撤销。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteAllOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={() => void confirmDeleteAll()}
            >
              {busy ? "清空中…" : "全部删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ThreadListPrimitive.Root>
  );
}
