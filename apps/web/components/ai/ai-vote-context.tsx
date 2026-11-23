"use client";

import type { AiMessageVote } from "@roamlog/contracts";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { listAiMessageVotes, setAiMessageVote } from "../../lib/api/ai-votes";

export interface AiVoteContextValue {
  workspaceId: string | null;
  conversationId: string | null;
  votes: ReadonlyMap<string, boolean>;
  status: "idle" | "loading" | "ready" | "error";
  setVote: (messageId: string, type: "up" | "down") => Promise<AiMessageVote>;
}

const AiVoteContext = createContext<AiVoteContextValue>({
  workspaceId: null,
  conversationId: null,
  votes: new Map(),
  status: "idle",
  setVote: async () => {
    throw new Error("AI vote persistence is not configured for this thread.");
  },
});

export function AiVoteProvider({
  workspaceId,
  conversationId,
  children,
}: Pick<AiVoteContextValue, "workspaceId" | "conversationId"> & {
  children: ReactNode;
}) {
  const [votes, setVotes] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [status, setStatus] = useState<AiVoteContextValue["status"]>(
    workspaceId && conversationId ? "loading" : "idle",
  );

  useEffect(() => {
    if (!workspaceId || !conversationId) {
      setVotes(new Map());
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    void listAiMessageVotes(workspaceId, conversationId, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        setVotes(new Map(rows.map((row) => [row.messageId, row.isUpvoted])));
        setStatus("ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Feedback is non-blocking: a failed prefetch must not take the chat
        // down. A vote write still reports its own failure to the caller.
        setVotes(new Map());
        setStatus("error");
      });

    return () => controller.abort();
  }, [conversationId, workspaceId]);

  const setVote = useCallback(
    async (messageId: string, type: "up" | "down"): Promise<AiMessageVote> => {
      if (!workspaceId || !conversationId) {
        throw new Error("AI vote persistence is not configured for this thread.");
      }
      const row = await setAiMessageVote(workspaceId, conversationId, messageId, type);
      setVotes((current) => {
        const next = new Map(current);
        next.set(messageId, row.isUpvoted);
        next.set(row.messageId, row.isUpvoted);
        return next;
      });
      setStatus("ready");
      return row;
    },
    [conversationId, workspaceId],
  );

  const value = useMemo<AiVoteContextValue>(
    () => ({ conversationId, setVote, status, votes, workspaceId }),
    [conversationId, setVote, status, votes, workspaceId],
  );

  return <AiVoteContext.Provider value={value}>{children}</AiVoteContext.Provider>;
}

export function useAiVoteContext(): AiVoteContextValue {
  return useContext(AiVoteContext);
}
