import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

/**
 * The AI surface is deliberately two-phase: `chat` plans with read-only tools and
 * never writes, `execute` applies the confirmed subset. Both are documented as
 * separate operations so generated clients cannot conflate them.
 */
const AiRunParamsSchema = c.WorkspaceParamsSchema.extend({ runId: c.AiRunIdSchema });

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
}