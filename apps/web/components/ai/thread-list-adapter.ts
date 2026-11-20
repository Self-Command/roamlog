import type { ThreadMessageLike } from "@assistant-ui/react";

import { contentWithAttachmentParts } from "./media-attachment-adapter";
import {
  ExportedMessageRepository,
  useAuiState,
  type ExportedMessageRepositoryItem,
  type RemoteThreadListAdapter,
  type RuntimeAdapters,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import type { AiConversation, AiThreadMessage } from "@roamlog/contracts";
import type { UpsertAiConversationMessageBody } from "@roamlog/api-client";
import { useMemo, useRef, useSyncExternalStore } from "react";

import {
  AI_CONVERSATION_PAGE_LIMIT,
  AiConversationError,
  archiveConversation,
  createConversation,
  deleteConversation,
  deleteConversationMessages,
  generateConversationTitle,
  getConversation,
  listConversationMessages,
  listConversations,
  renameConversation,
  unarchiveConversation,
  upsertConversationMessage,
} from "@/lib/api/ai-conversations";

/**
 * assistant-ui `RemoteThreadListAdapter` backed by the persisted
 * `/v1/workspaces/{workspaceId}/ai/conversations` REST surface.
 *
 * The previous implementation kept both the thread list and every message in
 * `localStorage`, so a new device or a cleared cache showed an empty sidebar.
 * This adapter is the single source of truth on the server:
 *
 * - `list/initialize/fetch/rename/archive/unarchive/delete` map one-to-one onto
 *   the eleven conversation endpoints;
 * - `unstable_useAdapters().history.load` replays the flat
 *   `{ parentId, message }[]` response through
 *   `ExportedMessageRepository.fromBranchableArray`, which preserves branches
 *   and selects the server's `headId`;
 * - `append/update` use idempotent `PUT .../messages/{clientId}` with the
 *   assistant-ui message id as `clientId`, so a retried request cannot
 *   duplicate a message.
 *
 * Failure policy: a failed list or write is shown as a Chinese, retryable
 * banner. The adapter never writes conversation data to `localStorage`; the
 * only storage touch is deleting the legacy keys after the first successful
 * remote load (there is deliberately no data migration — the old payload
 * shape is not the server shape).
 */

const LEGACY_LIST_PREFIX = "roamlog.ai.threads";
const LEGACY_HISTORY_PREFIX = "roamlog.ai.history";

type RemoteThreadListPageOptions = NonNullable<
  Parameters<RemoteThreadListAdapter["list"]>[0]
>;
type RemoteThreadListResponse = Awaited<ReturnType<RemoteThreadListAdapter["list"]>>;
type RemoteThreadMetadata = RemoteThreadListResponse["threads"][number];

export type ConversationSyncPhase = "idle" | "loading" | "ready" | "error";

export interface ConversationSyncSnapshot {
  readonly phase: ConversationSyncPhase;
  /** Last failed list/fetch/initialize request, already translated to Chinese. */
  readonly listError: string | null;
  /** Last failed message write, already translated to Chinese. */
  readonly writeError: string | null;
  /** Regular threads on the first page; drives the empty state. */
  readonly threadCount: number;
  /** Idempotent writes waiting for a retry (upserts + deletes). */
  readonly pendingWrites: number;
}

export interface ConversationSyncController {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ConversationSyncSnapshot;
  /** Flushes failed writes and reloads the first page. */
  retry(): Promise<void>;
}

export type RemoteConversationThreadListAdapter = RemoteThreadListAdapter &
  Required<Pick<RemoteThreadListAdapter, "unarchive">> & {
    readonly sync: ConversationSyncController;
  };

class ConversationSyncStore implements ConversationSyncController {
  private snapshot: ConversationSyncSnapshot = {
    phase: "idle",
    listError: null,
    writeError: null,
    threadCount: 0,
    pendingWrites: 0,
  };

  private readonly listeners = new Set<() => void>();

  private retryTask: (() => Promise<void>) | null = null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): ConversationSyncSnapshot => this.snapshot;

  update(patch: Partial<ConversationSyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  setRetryTask(task: () => Promise<void>): void {
    this.retryTask = task;
  }

  async retry(): Promise<void> {
    await this.retryTask?.();
  }
}

/** Subscribes a component to the adapter's load/write state. */
export function useConversationSync(
  adapter: RemoteConversationThreadListAdapter,
): ConversationSyncSnapshot {
  return useSyncExternalStore(
    adapter.sync.subscribe,
    adapter.sync.getSnapshot,
    adapter.sync.getSnapshot,
  );
}

export function threadListKey(workspaceId: string): string {
  return `${LEGACY_LIST_PREFIX}.${workspaceId}`;
}

export function threadHistoryKey(workspaceId: string, threadId: string): string {
  return `${LEGACY_HISTORY_PREFIX}.${workspaceId}.${threadId}`;
}

/**
 * Removes the old localStorage keys once the server has answered.
 *
 * This is a cleanup, not a migration: the legacy payloads are keyed by local
 * thread ids and carry a different message shape, so importing them would
 * silently create a second, divergent history. Keeping them would make the
 * sidebar look like it has two copies of the same conversation.
 */
function clearLegacyThreadStorage(workspaceId: string): void {
  let store: Storage;
  try {
    if (typeof window === "undefined") return;
    store = window.localStorage;
  } catch {
    return;
  }

  const listKey = threadListKey(workspaceId);
  const historyPrefix = threadHistoryKey(workspaceId, "");
  const stale: string[] = [];
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key && (key === listKey || key.startsWith(historyPrefix))) stale.push(key);
    }
    for (const key of stale) store.removeItem(key);
  } catch {
    // A disabled or quota-full storage must never break the conversation.
  }
}

function toThreadMetadata(conversation: AiConversation): RemoteThreadMetadata {
  return {
    remoteId: conversation.id,
    status: conversation.status,
    title: conversation.title ?? undefined,
    lastMessageAt: conversation.lastMessageAt ? new Date(conversation.lastMessageAt) : undefined,
  };
}

function toThreadMessageLike(message: AiThreadMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    content: message.content as ThreadMessageLike["content"],
    createdAt: new Date(message.createdAt),
    ...(message.status !== undefined
      ? { status: message.status as NonNullable<ThreadMessageLike["status"]> }
      : {}),
    ...(message.metadata !== undefined
      ? { metadata: message.metadata as ThreadMessageLike["metadata"] }
      : {}),
    ...(message.attachments !== undefined
      ? { attachments: message.attachments as ThreadMessageLike["attachments"] }
      : {}),
  };
}

function errorText(error: unknown): string {
  if (error instanceof AiConversationError) return error.message;
  if (error instanceof Error && /[\u4e00-\u9fff]/u.test(error.message)) return error.message;
  return "AI 会话操作失败，请稍后重试。";
}

interface PendingUpsert {
  conversationId: string;
  item: ExportedMessageRepositoryItem;
}

interface PendingDelete {
  conversationId: string;
  ids: string[];
}

/**
 * Shared state behind one adapter instance. The history adapters created by
 * `unstable_useAdapters` close over this object, so a retry can flush writes
 * that failed on any thread.
 */
class ConversationGateway {
  readonly workspaceId: string;

  readonly sync = new ConversationSyncStore();

  /** Serialized body of the last successful PUT, keyed by assistant-ui message id. */
  private readonly lastSuccessfulPut = new Map<string, string>();

  private readonly pendingUpserts = new Map<string, PendingUpsert>();

  private readonly pendingDeletes = new Map<string, PendingDelete>();

  private readonly histories = new Map<string, ThreadHistoryAdapter>();

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
    this.sync.setRetryTask(async () => {
      this.sync.update({ phase: "loading", listError: null });
      await this.flushWrites();
      try {
        await this.listPage();
      } catch {
        // `listPage` has already written the Chinese error into the store.
      }
    });
  }

  private pendingCount(): number {
    return this.pendingUpserts.size + this.pendingDeletes.size;
  }

  private publishPending(): void {
    this.sync.update({ pendingWrites: this.pendingCount() });
  }

  async listPage(params?: RemoteThreadListPageOptions): Promise<RemoteThreadListResponse> {
    const initialPage = params?.after === undefined;
    if (initialPage) this.sync.update({ phase: "loading", listError: null });

    try {
      const query: { limit: number; cursor?: string } = {
        limit: AI_CONVERSATION_PAGE_LIMIT,
      };
      if (params?.after) query.cursor = params.after;

      const page = await listConversations(this.workspaceId, query);
      if (initialPage) {
        this.sync.update({
          phase: "ready",
          listError: null,
          threadCount: page.items.length,
        });
        clearLegacyThreadStorage(this.workspaceId);
      }

      const response: RemoteThreadListResponse = {
        threads: page.items.map(toThreadMetadata),
      };
      if (page.nextCursor) response.nextCursor = page.nextCursor;
      return response;
    } catch (error) {
      if (initialPage) {
        this.sync.update({ phase: "error", listError: errorText(error) });
      }
      throw error;
    }
  }

  async initialize(
    _threadId: string,
    options?: { custom?: Record<string, unknown> | undefined },
  ): Promise<{ remoteId: string; externalId?: string }> {
    const draftTitle = options?.custom?.title;
    const input =
      typeof draftTitle === "string" && draftTitle.trim().length > 0
        ? { title: draftTitle.trim().slice(0, 120) }
        : {};
    try {
      const conversation = await createConversation(this.workspaceId, input);
      return { remoteId: conversation.id };
    } catch (error) {
      this.sync.update({ listError: errorText(error) });
      throw error;
    }
  }

  async fetch(remoteId: string): Promise<RemoteThreadMetadata> {
    try {
      return toThreadMetadata(await getConversation(this.workspaceId, remoteId));
    } catch (error) {
      this.sync.update({ listError: errorText(error) });
      throw error;
    }
  }

  async rename(remoteId: string, newTitle: string): Promise<void> {
    await this.runMutation(async () => {
      await renameConversation(this.workspaceId, remoteId, newTitle);
    });
  }

  async archive(remoteId: string): Promise<void> {
    await this.runMutation(async () => {
      await archiveConversation(this.workspaceId, remoteId);
    });
  }

  async unarchive(remoteId: string): Promise<void> {
    await this.runMutation(async () => {
      await unarchiveConversation(this.workspaceId, remoteId);
    });
  }

  async delete(remoteId: string): Promise<void> {
    await this.runMutation(async () => {
      await deleteConversation(this.workspaceId, remoteId);
      for (const [clientId, entry] of this.pendingUpserts) {
        if (entry.conversationId === remoteId) this.pendingUpserts.delete(clientId);
      }
      for (const [key, entry] of this.pendingDeletes) {
        if (entry.conversationId === remoteId) this.pendingDeletes.delete(key);
      }
      this.publishPending();
    });
  }

  async generateTitle(remoteId: string): Promise<ReadableStream<unknown>> {
    try {
      const { title } = await generateConversationTitle(this.workspaceId, remoteId);
      return titleStream(title);
    } catch {
      // Titles are cosmetic and the server keeps its placeholder title; never
      // turn a title-generation failure into a blocking conversation error.
      return titleStream(undefined);
    }
  }

  private async runMutation(task: () => Promise<void>): Promise<void> {
    try {
      await task();
      this.sync.update({ writeError: null });
    } catch (error) {
      this.sync.update({ writeError: errorText(error) });
      throw error;
    }
  }

  historyFor(
    localId: string,
    getRemoteId: () => string | undefined,
  ): ThreadHistoryAdapter {
    const cached = this.histories.get(localId);
    if (cached) return cached;
    const adapter = makeHistoryAdapter(this, localId, getRemoteId);
    this.histories.set(localId, adapter);
    return adapter;
  }

  async upsertMessage(
    conversationId: string,
    item: ExportedMessageRepositoryItem,
  ): Promise<void> {
    const clientId = item.message.id;
    if (!clientId) return;

    // assistant-ui keeps attachment parts in `message.attachments`; the API
    // stores `content` only, so flatten them in or a reloaded conversation loses
    // its thumbnails (`contentWithAttachmentParts`).
    const body: UpsertAiConversationMessageBody = {
      content: contentWithAttachmentParts(
        item.message.content,
        item.message.attachments,
      ) as UpsertAiConversationMessageBody["content"],
      parentId: item.parentId,
    };
    if (item.message.status !== undefined) body.status = item.message.status;

    let serialized: string;
    try {
      serialized = JSON.stringify(body);
    } catch {
      this.sync.update({ writeError: "消息内容无法序列化，暂时无法保存。" });
      return;
    }
    if (this.lastSuccessfulPut.get(clientId) === serialized) return;

    this.pendingUpserts.set(clientId, { conversationId, item });
    this.publishPending();
    try {
      await upsertConversationMessage(this.workspaceId, conversationId, clientId, body);
      this.pendingUpserts.delete(clientId);
      this.lastSuccessfulPut.set(clientId, serialized);
      this.publishPending();
    } catch (error) {
      this.sync.update({
        writeError: `${errorText(error)}（消息已保留在当前会话，可重试保存）`,
      });
    }
  }

  async deleteMessages(conversationId: string, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const key = `${conversationId}:${ids.join(",")}`;
    this.pendingDeletes.set(key, { conversationId, ids: [...ids] });
    this.publishPending();
    try {
      await deleteConversationMessages(this.workspaceId, conversationId, ids);
      this.pendingDeletes.delete(key);
      this.publishPending();
    } catch (error) {
      this.sync.update({
        writeError: `${errorText(error)}（删除将在重试时继续）`,
      });
    }
  }

  async flushWrites(): Promise<void> {
    for (const [clientId, entry] of [...this.pendingUpserts]) {
      const body: UpsertAiConversationMessageBody = {
        content: contentWithAttachmentParts(
          entry.item.message.content,
          entry.item.message.attachments,
        ) as UpsertAiConversationMessageBody["content"],
        parentId: entry.item.parentId,
      };
      if (entry.item.message.status !== undefined) body.status = entry.item.message.status;
      try {
        await upsertConversationMessage(
          this.workspaceId,
          entry.conversationId,
          clientId,
          body,
        );
        this.pendingUpserts.delete(clientId);
        this.lastSuccessfulPut.set(clientId, JSON.stringify(body));
      } catch (error) {
        this.sync.update({ writeError: errorText(error) });
      }
    }

    for (const [key, entry] of [...this.pendingDeletes]) {
      try {
        await deleteConversationMessages(this.workspaceId, entry.conversationId, entry.ids);
        this.pendingDeletes.delete(key);
      } catch (error) {
        this.sync.update({ writeError: errorText(error) });
      }
    }

    this.publishPending();
    if (this.pendingCount() === 0) this.sync.update({ writeError: null });
  }
}

function makeHistoryAdapter(
  gateway: ConversationGateway,
  localId: string,
  getRemoteId: () => string | undefined,
): ThreadHistoryAdapter {
  return {
    scopeId: `${gateway.workspaceId}:${localId}`,
    async load() {
      const remoteId = getRemoteId();
      if (!remoteId) return { messages: [], headId: null };

      try {
        const response = await listConversationMessages(gateway.workspaceId, remoteId);
        const items = response.messages.map(({ parentId, message }) => ({
          parentId,
          message: toThreadMessageLike(message),
        }));
        return ExportedMessageRepository.fromBranchableArray(items, {
          headId: response.headId,
        });
      } catch (error) {
        gateway.sync.update({ listError: errorText(error) });
        throw error;
      }
    },
    async append(item) {
      const remoteId = getRemoteId();
      if (!remoteId) return;
      await gateway.upsertMessage(remoteId, item);
    },
    async update(item) {
      const remoteId = getRemoteId();
      if (!remoteId) return;
      await gateway.upsertMessage(remoteId, item);
    },
    async delete(items) {
      const remoteId = getRemoteId();
      if (!remoteId) return;
      const ids = items
        .map((item) => item.message.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      await gateway.deleteMessages(remoteId, ids);
    },
  };
}

/**
 * Creates a standalone history adapter (without the sidebar adapter).
 *
 * Exported so the history mapping can be tested directly: the normal entry
 * point is `unstable_useAdapters`, which needs a React/assistant-ui context.
 */
export function createRemoteHistoryAdapter(
  workspaceId: string,
  getRemoteId: () => string | undefined,
): ThreadHistoryAdapter {
  return new ConversationGateway(workspaceId).historyFor("standalone", getRemoteId);
}

const titleStream = (title: string | undefined): ReadableStream<unknown> =>
  new ReadableStream({
    start(controller) {
      if (title) {
        controller.enqueue({ type: "part-start", path: [0], part: { type: "text" } });
        controller.enqueue({ type: "text-delta", path: [0], textDelta: title });
        controller.enqueue({ type: "part-finish", path: [0] });
      }
      controller.close();
    },
  });

/**
 * The adapter instance must stay stable across renders — a new object is a new
 * store for the runtime — so callers memoize it per workspace.
 */
export function createRemoteThreadListAdapter(
  workspaceId: string,
): RemoteConversationThreadListAdapter {
  const gateway = new ConversationGateway(workspaceId);

  return {
    storeKey: `roamlog.ai.remote.${workspaceId}`,

    list: (params) => gateway.listPage(params),

    initialize: (threadId, options) => gateway.initialize(threadId, options),

    fetch: (remoteId) => gateway.fetch(remoteId),

    rename: (remoteId, newTitle) => gateway.rename(remoteId, newTitle),

    archive: (remoteId) => gateway.archive(remoteId),

    unarchive: (remoteId) => gateway.unarchive(remoteId),

    delete: (remoteId) => gateway.delete(remoteId),

    async generateTitle(remoteId, _messages) {
      return gateway.generateTitle(remoteId) as unknown as Awaited<
        ReturnType<RemoteThreadListAdapter["generateTitle"]>
      >;
    },

    /**
     * Per-thread history adapter. The remote id is read lazily inside the
     * adapter because it only exists after `initialize()`; the returned object
     * is cached per thread so the runtime does not reload history forever.
     */
    unstable_useAdapters(): RuntimeAdapters {
      const localId = useAuiState((state) => state.threadListItem.id);
      const remoteId = useAuiState((state) => state.threadListItem.remoteId);
      const remoteRef = useRef(remoteId);
      remoteRef.current = remoteId;

      return useMemo(
        () => ({ history: gateway.historyFor(localId, () => remoteRef.current) }),
        [gateway, localId],
      );
    },

    sync: gateway.sync,
  };
}
