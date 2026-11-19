import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";
import { resolveRegisteredSchema } from "./schemas";

/**
 * The AI surface is deliberately two-phase: `chat` plans with read-only tools and
 * never writes, `execute` applies the confirmed subset. Both are documented as
 * separate operations so generated clients cannot conflate them.
 *
 * `chat/stream` is the streaming sibling of `chat`; the legacy JSON endpoints
 * stay registered unchanged so old clients keep a working contract.
 */
const AiRunParamsSchema = c.WorkspaceParamsSchema.extend({ runId: c.AiRunIdSchema });

const AiConversationParamsSchema = c.WorkspaceParamsSchema.extend({
  conversationId: c.UuidV7Schema,
});

const AiConversationMessageParamsSchema = AiConversationParamsSchema.extend({
  clientId: z.string().min(1).max(64),
});

function problemResponse(description: string) {
  return {
    description,
    content: {
      "application/problem+json": {
        schema: resolveRegisteredSchema(c.ProblemDetailsSchema),
      },
    },
  };
}

export function registerAiPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces/{workspaceId}/ai/chat",
    operationId: "createAiChat",
    tag: "AI",
    summary: "Plan a trip conversationally using read-only tools",
    description:
      "Runs the model tool loop with read-only tools only and returns a run id plus the write calls it would make. Nothing is persisted.",
    params: c.WorkspaceParamsSchema,
    body: c.AiChatRequestSchema,
    response: c.AiChatResponseSchema,
    errors: [403, 422, 429, 503],
  });

  // Streaming chat. The HTTP response is a `text/event-stream`, so the body is
  // documented as a string and the frame/event contract lives in the
  // description; every `data:` payload is validated by `AiStreamEventSchema`
  // (`packages/contracts/src/api/ai.ts`). Pre-flush failures stay RFC 7807.
  registry.registerPath({
    method: "post",
    path: "/v1/workspaces/{workspaceId}/ai/chat/stream",
    operationId: "streamAiChat",
    tags: ["AI"],
    summary: "Stream one AI chat turn as Server-Sent Events",
    description:
      "Runs the model tool loop and returns a v1 SSE stream. " +
      "Each frame is `id: <n>` + `event: <type>` + `data: <single-line JSON>` followed by a blank line. " +
      "The frozen event protocol has exactly six events, all validated by `AiStreamEventSchema`: " +
      "`meta` (always first; contract version `v: 1`, conversationId, userMessageId, assistantMessageId, provider {protocol,model}), " +
      "`text.delta` ({ delta }), `plan` ({ runId, message, plannedCalls, readOnlyTrace, warnings?, expiresAt }), " +
      "`usage` ({ usage }), `error` ({ code, message, retryable, runId? }) and " +
      "`done` ({ messageId, finishReason: stop|tool-calls|length|aborted|error, usage? }). " +
      "`done` is exactly once and always the last frame; `error` is always followed by `done` with `finishReason: \"error\"`. " +
      "Heartbeats are SSE comment frames (`: hb <ISO8601>`). " +
      "Errors before the first frame (validation, auth, quota, another active stream) are RFC 7807 problem details.",
    request: {
      params: resolveRegisteredSchema(c.WorkspaceParamsSchema),
      body: {
        required: true,
        content: {
          "application/json": {
            schema: resolveRegisteredSchema(c.AiChatRequestSchema),
          },
        },
      },
    },
    responses: {
      200: {
        description:
          "Server-Sent Events stream. Event payloads conform to `AiStreamEventSchema`; the SSE body itself is a text stream.",
        content: {
          "text/event-stream": {
            schema: { type: "string" },
          },
        },
      },
      400: problemResponse("The request body or workspace id fails schema validation."),
      401: problemResponse("Authentication is required."),
      403: problemResponse("The caller is not allowed to start a chat in this Workspace."),
      409: problemResponse(
        "AI_CONVERSATION_BUSY: another stream is already active for this conversation.",
      ),
      429: problemResponse("The caller exceeded the AI rate limit or daily quota (AI_QUOTA)."),
      503: problemResponse(
        "AI_NOT_CONFIGURED: the Workspace AI provider is not configured or unavailable.",
      ),
    },
  });

  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces/{workspaceId}/ai/runs/{runId}/execute",
    operationId: "executeAiRun",
    tag: "AI",
    summary: "Execute the confirmed tool calls of an AI plan",
    description:
      "Applies the submitted subset of the planned calls in order. A failure does not roll back earlier calls; the per-call results report what happened.",
    params: AiRunParamsSchema,
    body: c.AiRunExecuteRequestSchema,
    response: c.AiRunExecuteResponseSchema,
    idempotent: true,
    errors: [403, 404, 409, 422, 429],
  });

  // Rewriting is the only AI operation that produces prose for the user's own
  // selection. It is a single request/response (no run, no tools) because the
  // client shows the result as an in-place diff and the user accepts or rejects
  // it locally; `status: 200` reflects "computed", not "created".
  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces/{workspaceId}/ai/rewrite",
    operationId: "rewriteAiSelection",
    tag: "AI",
    summary: "Rewrite a text selection with one of the closed instructions",
    description:
      "Rewrites the submitted selection and returns the new text plus the echoed `selectionHash`, the model and the token usage. " +
      "The operation is chosen from a fixed enum; there is no free-text instruction field. " +
      "`selectionHash` is the SHA-256 of `text` and is rejected on mismatch, so a stale preview can never overwrite a different selection. " +
      "Nothing is persisted: the client replaces the selection and saves through the normal journal entry endpoint with `version`.",
    params: c.WorkspaceParamsSchema,
    body: c.AiRewriteRequestSchema,
    response: c.AiRewriteResponseSchema,
    status: 200,
    errors: [400, 401, 403, 422, 429, 502, 503],
  });

  /* ------------------------------------------------------------------------ */
  /* Conversation persistence (§2.5): 7 conversation endpoints, 3 message     */
  /* endpoints and title generation.                                          */
  /* ------------------------------------------------------------------------ */

  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}/ai/conversations",
    operationId: "listAiConversations",
    tag: "AI",
    summary: "List AI conversations in a Workspace",
    description:
      "Lists `status=regular` conversations for the current user, ordered by `lastMessageAt DESC`. " +
      "`limit` defaults to 30 and is capped at 100; `cursor` is the base64 composite cursor of `lastMessageAt` + `id`.",
    params: c.WorkspaceParamsSchema,
    query: c.AiConversationListQuerySchema,
    response: c.AiConversationListResponseSchema,
  });

  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces/{workspaceId}/ai/conversations",
    operationId: "createAiConversation",
    tag: "AI",
    summary: "Create an empty AI conversation",
    description:
      "Creates an empty conversation for the current user (`RemoteThreadListAdapter.initialize`). An optional initial title is accepted; otherwise the title stays null until the first message produces a placeholder.",
    params: c.WorkspaceParamsSchema,
    body: c.CreateAiConversationRequestSchema,
    response: c.AiConversationSchema,
  });

  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}/ai/conversations/{conversationId}",
    operationId: "getAiConversation",
    tag: "AI",
    summary: "Get AI conversation metadata",
    params: AiConversationParamsSchema,
    response: c.AiConversationSchema,
  });

  registerOperation(registry, {
    method: "patch",
    path: "/v1/workspaces/{workspaceId}/ai/conversations/{conversationId}",
    operationId: "updateAiConversation",
    tag: "AI",
    summary: "Rename an AI conversation",
    description:
      "Changes the title and sets `titleSource=manual`, so asynchronous title generation never overwrites a user rename.",
    params: AiConversationParamsSchema,
    body: c.UpdateAiConversationRequestSchema,
    response: c.AiConversationSchema,
  });

  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces/{workspaceId}/ai/conversations/{conversationId}/archive",
    operationId: "archiveAiConversation",
    tag: "AI",
    summary: "Archive an AI conversation",
    params: AiConversationParamsSchema,
    response: c.AiConversationSchema,
    status: 200,
  });

  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces/{workspaceId}/ai/conversations/{conversationId}/unarchive",
    operationId: "unarchiveAiConversation",
    tag: "AI",
    summary: "Unarchive an AI conversation",
    params: AiConversationParamsSchema,
    response: c.AiConversationSchema,
    status: 200,
  });

  registerOperation(registry, {
    method: "delete",
    path: "/v1/workspaces/{workspaceId}/ai/conversations/{conversationId}",
    operationId: "deleteAiConversation",
    tag: "AI",
    summary: "Soft-delete an AI conversation",
    description:
      "Marks the conversation deleted without removing its messages; the row is excluded from every subsequent read.",
    params: AiConversationParamsSchema,
    response: c.MessageResponseSchema,
    status: 200,
  });

  registerOperation(registry, {
    method: "get",
    path: "/v1/workspaces/{workspaceId}/ai/conversations/{conversationId}/messages",
    operationId: "listAiConversationMessages",
    tag: "AI",
    summary: "Load a conversation's message history",
    description:
      "Returns the flat `{ parentId, message }[]` branch plus `headId` (`ThreadHistoryAdapter.load`). " +
      "`message.content` is the stored assistant-ui `ThreadMessageLike` JSONB and is intentionally not enumerated by the contract.",
    params: AiConversationParamsSchema,
    response: c.AiConversationMessagesResponseSchema,
  });

  registerOperation(registry, {
    method: "put",
    path: "/v1/workspaces/{workspaceId}/ai/conversations/{conversationId}/messages/{clientId}",
    operationId: "upsertAiConversationMessage",
    tag: "AI",
    summary: "Idempotently append or update one message",
    description:
      "Upserts by the client-generated message id (`clientId`). A retried request returns the existing row instead of duplicating history.",
    params: AiConversationMessageParamsSchema,
    body: c.UpsertAiMessageRequestSchema,
    response: c.AiThreadMessageSchema,
    status: 200,
  });

  registerOperation(registry, {
    method: "delete",
    path: "/v1/workspaces/{workspaceId}/ai/conversations/{conversationId}/messages",
    operationId: "deleteAiConversationMessages",
    tag: "AI",
    summary: "Delete specific messages from a conversation",
    params: AiConversationParamsSchema,
    body: c.DeleteAiMessagesRequestSchema,
    response: c.MessageResponseSchema,
    status: 200,
  });

  registerOperation(registry, {
    method: "post",
    path: "/v1/workspaces/{workspaceId}/ai/conversations/{conversationId}/title/generate",
    operationId: "generateAiConversationTitle",
    tag: "AI",
    summary: "Generate a conversation title from the first user message",
    description:
      "Runs the small-model title summariser and returns `{ title }`. Idempotent while `titleSource=model`; `titleSource=manual` is never overwritten.",
    params: AiConversationParamsSchema,
    response: c.AiConversationTitleResponseSchema,
    status: 200,
  });
}
