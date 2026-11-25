"use client";

/**
 * Same-device persistence for human-tool drafts.
 *
 * Ported from assistant-ui `examples/with-interactables/app/page.tsx:246-267`
 * (MIT, commit 4a0d2a5b9f04c8fb7ff9cd224827a958096b52dc):
 *
 *   const persistenceAdapter = {
 *     load: () => localStorage.getItem(STORAGE_KEY) ...,
 *     save: (state) => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)),
 *   };
 *   AuiConfig({ unstable_interactables: unstable_Interactables({ persistence }) })
 *
 * Adaptation for Roamlog:
 * - The upstream demo persists app-scoped interactables. Inside a human tool
 *   part assistant-ui marks an interactable with the same name as the tool as
 *   `scope: "thread"`, and explicitly excludes that scope from this adapter
 *   (`packages/core/src/react/client/Interactables.ts:170-175`). The form
 *   draft therefore registers under the separate names below, which keeps it
 *   app-scoped and eligible for the upstream persistence path.
 * - The storage key is scoped by workspace and user, and every instance id
 *   contains the conversation id + tool-call id, so drafts cannot leak between
 *   accounts or conversations on a shared device.
 * - This is intentionally same-device only. Cross-device draft restore needs a
 *   separate server contract; localStorage must not be described as such.
 */

import type { Unstable_InteractablePersistenceAdapter } from "@assistant-ui/react";
import { createContext, createElement, useContext, type ReactNode } from "react";

import {
  hasAskUserDraft,
  hasConfirmBriefDraft,
  readAskUserDraft,
  readConfirmBriefDraft,
} from "./plan-draft-state";

export const ASK_USER_DRAFT_NAME = "roamlog_ask_user_draft";
export const CONFIRM_BRIEF_DRAFT_NAME = "roamlog_confirm_brief_draft";
export const PLAN_DRAFT_NAME = "roamlog_plan_draft";

const STORAGE_PREFIX = "roamlog.ai.human-drafts.v2";

type DraftStorage = Pick<Storage, "getItem" | "setItem">;

type PersistedEntry = {
  name: string;
  state: unknown;
};

type PersistedDraftState = Record<string, PersistedEntry>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEmptyDraftEntry(entry: PersistedEntry): boolean {
  if (entry.name === ASK_USER_DRAFT_NAME) {
    return !hasAskUserDraft(readAskUserDraft(entry.state));
  }
  if (entry.name === CONFIRM_BRIEF_DRAFT_NAME) {
    return !hasConfirmBriefDraft(readConfirmBriefDraft(entry.state));
  }
  if (entry.name === PLAN_DRAFT_NAME) {
    return !(
      isRecord(entry.state) &&
      entry.state.dirty === true &&
      entry.state.schemaVersion === 1 &&
      typeof entry.state.runId === "string" &&
      typeof entry.state.message === "string" &&
      Array.isArray(entry.state.selected)
    );
  }
  return false;
}

function readStorage(): DraftStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function draftStorageKey(workspaceId: string, userId: string): string {
  return `${STORAGE_PREFIX}:${workspaceId}:${userId}`;
}

export function createDraftPersistence(
  workspaceId: string,
  userId: string,
  storage?: DraftStorage,
): Unstable_InteractablePersistenceAdapter {
  const storageKey = draftStorageKey(workspaceId, userId);
  const resolveStorage = () => storage ?? readStorage();
  return {
    load(): PersistedDraftState | undefined {
      const target = resolveStorage();
      if (!target) return undefined;
      try {
        const value = target.getItem(storageKey);
        if (!value) return undefined;
        const parsed: unknown = JSON.parse(value);
        if (!isRecord(parsed)) return undefined;
        return Object.fromEntries(
          Object.entries(parsed).flatMap(([id, entry]) => {
            if (!isRecord(entry) || typeof entry.name !== "string") return [];
            return [[id, { name: entry.name, state: entry.state }]];
          }),
        );
      } catch {
        return undefined;
      }
    },
    save(state: PersistedDraftState): void {
      const target = resolveStorage();
      if (!target) return;
      try {
        const restorable = Object.fromEntries(
          Object.entries(state).filter(([, entry]) => !isEmptyDraftEntry(entry)),
        );
        target.setItem(storageKey, JSON.stringify(restorable));
      } catch {
        // A disabled/quota-exhausted localStorage must not break the form.
      }
    },
  };
}

const DraftScopeContext = createContext<string | null>(null);

/**
 * Keeps the draft namespace aligned with the active persisted conversation.
 * The fallback is only for isolated component previews/tests; the production
 * AI shell always supplies the remote conversation id.
 */
export function DraftScopeProvider({
  conversationId,
  children,
}: {
  conversationId: string | null | undefined;
  children: ReactNode;
}) {
  return createElement(
    DraftScopeContext.Provider,
    { value: conversationId ?? null },
    children,
  );
}

export function useDraftScope(): string {
  return useContext(DraftScopeContext) ?? "unscoped";
}

export function draftIdFor(conversationScope: string, toolCallId: string): string {
  return `${conversationScope}:${toolCallId}`;
}

/**
 * A plan draft is scoped by the conversation and the exact plan run. Including
 * the tool-call id keeps multiple plan cards in one conversation independent.
 */
export function planDraftIdFor(
  conversationScope: string,
  toolCallId: string,
  runId: string,
): string {
  return `${conversationScope}:${toolCallId}:${runId}`;
}
