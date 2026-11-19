import type { ThreadMessageLike } from "@assistant-ui/react";
import {
  ExportedMessageRepository,
  generateId,
  useAuiState,
  type ExportedMessageRepositoryItem,
  type RemoteThreadListAdapter,
  type RuntimeAdapters,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import { useMemo, useRef } from "react";

/**
 * localStorage-backed thread list + per-thread message history.
 *
 * Ported from the assistant-ui thread list adapter contract
 * (`@assistant-ui/core` `RemoteThreadListAdapter`, consumed by
 * `useRemoteThreadListRuntime`): `list/initialize/fetch/rename/archive/
 * unarchive/delete` back the sidebar, and `unstable_useAdapters` supplies the
 * per-thread `ThreadHistoryAdapter` that `useLocalRuntime` reads on switch.
 *
 * This stage persists client-side only; server-side persistence is a later
 * stage. Nothing here is authoritative product data — the API stays the source
 * of truth for trips, stops and logs.
 */

const LIST_PREFIX = "roamlog.ai.threads";
const HISTORY_PREFIX = "roamlog.ai.history";

/** One stored thread list entry. `title` is written by the title generator. */
interface StoredThread {
  remoteId: string;
  title?: string;
  lastMessageAt?: string;
  status: "regular" | "archived";
}

interface StoredHistoryItem {
  parentId: string | null;
  message: ThreadMessageLike;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(key: string, fallback: T): T {
  const store = storage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // A full or disabled quota must never break the conversation.
  }
}

export function threadListKey(workspaceId: string): string {
  return `${LIST_PREFIX}.${workspaceId}`;
}

export function threadHistoryKey(workspaceId: string, threadId: string): string {
  return `${HISTORY_PREFIX}.${workspaceId}.${threadId}`;
}

function readThreads(workspaceId: string): StoredThread[] {
  const stored = readJson<StoredThread[]>(threadListKey(workspaceId), []);
  return Array.isArray(stored) ? stored.filter((item) => item && typeof item.remoteId === "string") : [];
}

function writeThreads(workspaceId: string, threads: StoredThread[]): void {
  writeJson(threadListKey(workspaceId), threads);
}

function upsertThread(
  workspaceId: string,
  remoteId: string,
  patch: Partial<StoredThread>,
): StoredThread[] {
  const threads = readThreads(workspaceId);
  const index = threads.findIndex((item) => item.remoteId === remoteId);
  const existing = index >= 0 ? threads[index] : undefined;
  const next: StoredThread = existing
    ? { ...existing, ...patch }
    : {
        remoteId,
        status: patch.status ?? "regular",
        title: patch.title,
        lastMessageAt: patch.lastMessageAt,
      };
  if (index >= 0) threads[index] = next;
  else threads.unshift(next);
  writeThreads(workspaceId, threads);
  return threads;
}

function removeThread(workspaceId: string, remoteId: string): void {
  writeThreads(
    workspaceId,
    readThreads(workspaceId).filter((item) => item.remoteId !== remoteId),
  );
  const store = storage();
  try {
    store?.removeItem(threadHistoryKey(workspaceId, remoteId));
  } catch {
    // ignore
  }
}

/** Revives the `Date` fields `JSON.stringify` turned into strings. */
function reviveMessage(message: ThreadMessageLike): ThreadMessageLike {
  const createdAt = (message as { createdAt?: unknown }).createdAt;
  if (typeof createdAt === "string") {
    return { ...message, createdAt: new Date(createdAt) };
  }
  return message;
}

function readHistory(storageKey: string): StoredHistoryItem[] {
  const stored = readJson<StoredHistoryItem[]>(storageKey, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((item) => item && item.message && typeof item.message.id === "string");
}

function makeHistoryAdapter(
  workspaceId: string,
  localId: string,
  getRemoteId: () => string | undefined,
): ThreadHistoryAdapter {
  const key = () => threadHistoryKey(workspaceId, getRemoteId() ?? localId);

  return {
    scopeId: `${workspaceId}:${localId}`,
    async load() {
      const items = readHistory(key());
      if (items.length === 0) return { messages: [], headId: null };
      return ExportedMessageRepository.fromArray(
        items.map((item) => reviveMessage(item.message)),
      );
    },
    async append(item: ExportedMessageRepositoryItem) {
      const storageKey = key();
      const items = readHistory(storageKey);
      const id = item.message.id;
      const next: StoredHistoryItem = {
        parentId: item.parentId,
        message: JSON.parse(JSON.stringify(item.message)) as ThreadMessageLike,
      };
      const index = items.findIndex((entry) => entry.message.id === id);
      if (index >= 0) items[index] = next;
      else items.push(next);
      writeJson(storageKey, items);
      const remoteId = getRemoteId();
      if (remoteId) upsertThread(workspaceId, remoteId, { lastMessageAt: new Date().toISOString() });
    },
    async update(item: ExportedMessageRepositoryItem) {
      const storageKey = key();
      const items = readHistory(storageKey);
      const index = items.findIndex((entry) => entry.message.id === item.message.id);
      if (index < 0) return;
      items[index] = {
        parentId: item.parentId,
        message: JSON.parse(JSON.stringify(item.message)) as ThreadMessageLike,
      };
      writeJson(storageKey, items);
    },
    async delete(items: readonly ExportedMessageRepositoryItem[]) {
      const storageKey = key();
      const ids = new Set(
        items
          .map((item) => item.message.id)
          .filter((id): id is string => typeof id === "string"),
      );
      writeJson(
        storageKey,
        readHistory(storageKey).filter((entry) => {
          const id = entry.message.id;
          return typeof id === "string" ? !ids.has(id) : true;
        }),
      );
    },
  };
}

/**
 * The adapter instance must stay stable across renders — a new object is a new
 * store for the runtime — so callers memoize it per workspace.
 */
export function createLocalThreadListAdapter(workspaceId: string): RemoteThreadListAdapter {
  return {
    storeKey: `roamlog.ai.${workspaceId}`,

    async list() {
      const threads = readThreads(workspaceId);
      return {
        threads: threads.map((thread) => ({
          remoteId: thread.remoteId,
          status: thread.status,
          title: thread.title,
          lastMessageAt: thread.lastMessageAt ? new Date(thread.lastMessageAt) : undefined,
        })),
      };
    },

    async initialize() {
      const remoteId = generateId();
      upsertThread(workspaceId, remoteId, { status: "regular" });
      return { remoteId };
    },

    async fetch(remoteId) {
      const thread = readThreads(workspaceId).find((item) => item.remoteId === remoteId);
      if (!thread) throw new Error(`Unknown AI conversation ${remoteId}`);
      return {
        remoteId: thread.remoteId,
        status: thread.status,
        title: thread.title,
        lastMessageAt: thread.lastMessageAt ? new Date(thread.lastMessageAt) : undefined,
      };
    },

    async rename(remoteId, newTitle) {
      upsertThread(workspaceId, remoteId, { title: newTitle });
    },

    async archive(remoteId) {
      upsertThread(workspaceId, remoteId, { status: "archived" });
    },

    async unarchive(remoteId) {
      upsertThread(workspaceId, remoteId, { status: "regular" });
    },

    async delete(remoteId) {
      removeThread(workspaceId, remoteId);
    },

    /**
     * Title generation is local: the first user message is truncated and
     * persisted straight away. The returned stream carries that title once so
     * the sidebar updates without a reload.
     */
    async generateTitle(remoteId, messages) {
      const firstUser = messages.find((message) => message.role === "user");
      const title = firstUser ? titleFromMessage(firstUser, messages) : undefined;
      if (title) upsertThread(workspaceId, remoteId, { title });
      return titleStream(title) as unknown as Awaited<
        ReturnType<RemoteThreadListAdapter["generateTitle"]>
      >;
    },

    /**
     * Per-thread adapters handed to that thread's `useLocalRuntime`.
     *
     * The returned object must keep a stable identity across renders: a fresh
     * object makes the runtime re-load history forever and the thread never
     * leaves `isLoading`. The remote id is read lazily *inside* the adapter
     * (never captured), because it only exists after `initialize()` and
     * changing the adapter on that transition would reload the thread.
     */
    unstable_useAdapters(): RuntimeAdapters {
      const localId = useAuiState((state) => state.threadListItem.id);
      const remoteId = useAuiState((state) => state.threadListItem.remoteId);
      const remoteRef = useRef(remoteId);
      remoteRef.current = remoteId;

      return useMemo(
        () => ({ history: historyFor(workspaceId, localId, () => remoteRef.current) }),
        [workspaceId, localId],
      );
    },
  };
}

const historyCache = new Map<string, ThreadHistoryAdapter>();

function historyFor(
  workspaceId: string,
  localId: string,
  getRemoteId: () => string | undefined,
): ThreadHistoryAdapter {
  const cacheKey = `${workspaceId}:${localId}`;
  const cached = historyCache.get(cacheKey);
  if (cached) return cached;
  const adapter = makeHistoryAdapter(workspaceId, localId, getRemoteId);
  historyCache.set(cacheKey, adapter);
  return adapter;
}

function titleFromMessage(
  message: { content: readonly unknown[] | string },
  messages: readonly { role: string }[],
): string | undefined {
  const text =
    typeof message.content === "string"
      ? message.content
      : message.content
          .map((raw) => {
            const part = raw as { type?: string; text?: string };
            return part.type === "text" && typeof part.text === "string" ? part.text : "";
          })
          .join("");
  const trimmed = text.trim().replace(/\s+/gu, " ");
  if (!trimmed) return messages.length > 1 ? "AI 旅行助手对话" : undefined;
  return trimmed.length > 24 ? `${trimmed.slice(0, 23)}…` : trimmed;
}

function titleStream(title: string | undefined): ReadableStream<unknown> {
  return new ReadableStream({
    start(controller) {
      if (title) {
        controller.enqueue({ type: "part-start", path: [0], part: { type: "text" } });
        controller.enqueue({ type: "text-delta", path: [0], textDelta: title });
        controller.enqueue({ type: "part-finish", path: [0] });
      }
      controller.close();
    },
  });
}
