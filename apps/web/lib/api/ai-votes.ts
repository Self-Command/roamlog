import {
  AiMessageVoteSchema,
  AiMessageVotesResponseSchema,
  type AiMessageVote,
} from "@roamlog/contracts";

function votePath(workspaceId: string, conversationId: string, suffix = ""): string {
  return `/v1/workspaces/${encodeURIComponent(workspaceId)}/ai/conversations/${encodeURIComponent(conversationId)}${suffix}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

export async function listAiMessageVotes(
  workspaceId: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<readonly AiMessageVote[]> {
  const response = await fetch(votePath(workspaceId, conversationId, "/votes"), {
    credentials: "include",
    signal,
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`AI votes request failed with HTTP ${response.status}.`);
  }
  return AiMessageVotesResponseSchema.parse(body);
}

export async function setAiMessageVote(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  type: "up" | "down",
): Promise<AiMessageVote> {
  const response = await fetch(
    votePath(
      workspaceId,
      conversationId,
      `/messages/${encodeURIComponent(messageId)}/vote`,
    ),
    {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type }),
    },
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(`AI vote request failed with HTTP ${response.status}.`);
  }
  return AiMessageVoteSchema.parse(body);
}
