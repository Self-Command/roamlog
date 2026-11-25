"use client";

/**
 * Per-workspace model + reasoning selection.
 *
 * Porting source: vercel/chatbot `hooks/use-active-chat.tsx` / the chat page
 * state that feeds `selectedModelId` into the composer and the request body
 * (`components/chat/multimodal-input.tsx` L106, L550–L555; the id reaches the
 * server via `app/(chat)/api/chat/route.ts` L97–L99). Upstream keeps it in React
 * state above both the selector and the transport.
 *
 * Adaptation layer: assistant-ui owns the runtime in `ai-chat.tsx`, while the
 * selector and the model adapter are separate components that never share a
 * prop path. A tiny external store (readable via `useSyncExternalStore`) is the
 * smallest way to give both the exact same value at request time — the
 * selection must be the one on screen when the user presses Enter, not a stale
 * closure from mount.
 */

import type { AiReasoningEffort } from "@roamlog/contracts";
import { useSyncExternalStore } from "react";

const REASONING_STORAGE_PREFIX = "roamlog.ai.reasoning.v1";
const REASONING_EFFORTS: readonly AiReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
];

export interface AiChatSelection {
  /** `undefined` means "let the server use its configured default". */
  model?: string;
  reasoningEffort?: AiReasoningEffort;
}

export interface AiChatSelectionStore {
  get(): AiChatSelection;
  set(next: AiChatSelection): void;
  subscribe(listener: () => void): () => void;
}

const stores = new Map<string, AiChatSelectionStore>();

function reasoningStorageKey(workspaceId: string): string {
  return `${REASONING_STORAGE_PREFIX}:${workspaceId}`;
}

function readPersistedReasoningEffort(workspaceId: string): AiReasoningEffort | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value = window.localStorage.getItem(reasoningStorageKey(workspaceId));
    if (!value) return undefined;
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "string" &&
      (REASONING_EFFORTS as readonly string[]).includes(parsed)
      ? (parsed as AiReasoningEffort)
      : undefined;
  } catch {
    return undefined;
  }
}

function persistReasoningEffort(
  workspaceId: string,
  reasoningEffort: AiReasoningEffort | undefined,
): void {
  if (typeof window === "undefined") return;
  try {
    if (reasoningEffort === undefined) {
      window.localStorage.removeItem(reasoningStorageKey(workspaceId));
    } else {
      window.localStorage.setItem(reasoningStorageKey(workspaceId), JSON.stringify(reasoningEffort));
    }
  } catch {
    // Storage can be disabled or full. The in-memory selection still works.
  }
}

/** One stable store per workspace (module-level, so remounts keep the choice). */
export function aiChatSelectionStore(workspaceId: string): AiChatSelectionStore {
  const existing = stores.get(workspaceId);
  if (existing) return existing;

  const persistedReasoningEffort = readPersistedReasoningEffort(workspaceId);
  let value: AiChatSelection = persistedReasoningEffort
    ? { reasoningEffort: persistedReasoningEffort }
    : {};
  const listeners = new Set<() => void>();
  const store: AiChatSelectionStore = {
    get: () => value,
    set(next) {
      if (
        next.model === value.model &&
        next.reasoningEffort === value.reasoningEffort
      ) {
        return;
      }
      value = next;
      persistReasoningEffort(workspaceId, next.reasoningEffort);
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  stores.set(workspaceId, store);
  return store;
}

export function useAiChatSelection(workspaceId: string): AiChatSelection {
  const store = aiChatSelectionStore(workspaceId);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Test hook: forget every workspace selection. */
export function resetAiChatSelectionStores(): void {
  stores.clear();
}
