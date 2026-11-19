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
}