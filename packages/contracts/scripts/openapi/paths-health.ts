import type { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";

import * as c from "../../src/index";
import { registerOperation } from "./helpers";

export function registerHealthPaths(registry: OpenAPIRegistry): void {
  registerOperation(registry, {
    method: "get",
    path: "/v1/health",
    operationId: "getHealth",
    tag: "Health",
    summary: "Liveness check",
    response: c.HealthResponseSchema,
    public: true,
    errors: [500, 503],
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/ready",
    operationId: "getReady",
    tag: "Health",
    summary: "Readiness check for PostgreSQL, Redis, and object storage",
    response: c.ReadyResponseSchema,
    public: true,
    errors: [500, 503],
  });
  registerOperation(registry, {
    method: "get",
    path: "/v1/ws",
    operationId: "connectRealtime",
    tag: "Realtime",
    summary: "Open the Socket.IO namespace",
    description:
      "Socket.IO namespace handshake authenticated by the httpOnly session cookie. This OpenAPI operation documents the HTTP upgrade endpoint; typed server events live in RealtimeEventSchema.",
    responseDescription: "Socket.IO protocol upgrade.",
    status: 101,
    errors: [401, 403, 429, 500],
  });
}
