"use client";

import { useAui, useAuiState } from "@assistant-ui/react";
import { useEffect, useRef } from "react";

import { fetchAiStreamStatus } from "../../lib/api/ai";
import { createAiResumeStream } from "./chat-model-adapter";

/**
 * Port of vercel/chatbot `hooks/use-auto-resume.ts:15-43` (Apache-2.0).
 *
 * Upstream resumes when the last loaded message is a user turn. assistant-ui
 * exposes that as `ThreadRuntime.resumeRun`, which needs a stream factory.
 * The probe is necessary because a blank producer must not create an empty
 * assistant bubble; the server only reports active when the Redis sentinel and
 * the durable `AiStream` row both exist.
 */
export function useAutoResume({
  workspaceId,
  conversationId,
  enabled = true,
}: {
  workspaceId: string;
  conversationId: string | null;
  enabled?: boolean;
}): void {
  const aui = useAui();
  const isLoading = useAuiState((state) => state.thread.isLoading);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const lastId = useAuiState((state) => state.thread.messages.at(-1)?.id ?? null);
  const lastRole = useAuiState((state) => state.thread.messages.at(-1)?.role ?? null);
  const checked = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !conversationId || isLoading || isRunning || !lastId || lastRole !== "user") {
      return;
    }

    const key = `${conversationId}:${lastId}`;
    if (checked.current === key) return;
    checked.current = key;

    const controller = new AbortController();
    let disposed = false;

    async function resume(): Promise<void> {
      try {
        const status = await fetchAiStreamStatus(workspaceId, conversationId!, controller.signal);
        if (disposed || !status.active) return;
        aui.thread.resumeRun({
          parentId: lastId,
          runConfig: {},
          stream: createAiResumeStream({
            workspaceId,
            conversationId: conversationId!,
          }),
        });
      } catch {
        // A probe failure is non-fatal: the page still loads persisted history.
        // Allow a later remount to try again instead of poisoning this thread.
        if (checked.current === key) checked.current = null;
      }
    }

    void resume();
    return () => {
      disposed = true;
      controller.abort();
    };
  }, [aui, conversationId, enabled, isLoading, isRunning, lastId, lastRole, workspaceId]);
}
