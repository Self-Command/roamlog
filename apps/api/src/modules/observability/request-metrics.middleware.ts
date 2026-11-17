import { performance } from "node:perf_hooks";

import type { Request, RequestHandler, Response } from "express";

import type { MetricsService } from "./metrics.service.js";

type RouteAwareRequest = Request & {
  route?: {
    path?: unknown;
  };
};

function routeLabel(request: Request): string {
  const routePath = (request as RouteAwareRequest).route?.path;
  if (typeof routePath === "string" && routePath.length > 0) {
    if (routePath.endsWith("*path")) {
      return "unmatched";
    }
    if (routePath.startsWith("/v1/") || routePath === "/v1") {
      return routePath;
    }
    const prefix = request.baseUrl || "";
    return `${prefix}${routePath}`.replaceAll("//", "/");
  }

  if (["/v1/health", "/v1/ready", "/v1/metrics"].includes(request.path)) {
    return request.path;
  }

  return "unmatched";
}

export function requestMetricsMiddleware(metrics: MetricsService): RequestHandler {
  return (request: Request, response: Response, next): void => {
    if (request.path === "/v1/metrics") {
      next();
      return;
    }

    const startedAt = performance.now();
    let recorded = false;
    const record = (statusCode: number): void => {
      if (recorded) {
        return;
      }
      recorded = true;
      const durationSeconds = (performance.now() - startedAt) / 1000;
      metrics.observeHttpRequest(request.method, routeLabel(request), statusCode, durationSeconds);
    };

    response.once("finish", () => record(response.statusCode));
    response.once("close", () => {
      if (!response.writableEnded) {
        record(499);
      }
    });

    next();
  };
}
