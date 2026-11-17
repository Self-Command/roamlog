import { randomUUID } from "node:crypto";

import type { RequestHandler } from "express";
import type { Logger } from "pino";
import pinoHttp from "pino-http";

type ObservableRequest = {
  requestId?: string;
  userId?: string;
  workspaceId?: string;
  method?: string;
  url?: string;
  remoteAddress?: string;
  headers?: Record<string, string | string[] | undefined>;
};

export function redactRequestUrlForLog(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }

  try {
    const parsed = new URL(value, "http://roamlog.invalid");
    if (/^\/v1\/invitations\/[^/]+\/accept\/?$/.test(parsed.pathname)) {
      return "/v1/invitations/[redacted]/accept";
    }
    if (parsed.pathname === "/v1/auth" || parsed.pathname.startsWith("/v1/auth/")) {
      return parsed.pathname;
    }
    return value;
  } catch {
    return "[redacted-url]";
  }
}

export function createHttpLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (request) => (request as ObservableRequest).requestId ?? randomUUID(),
    customProps: (request) => {
      const observable = request as ObservableRequest;
      return {
        requestId: observable.requestId,
        userId: observable.userId,
        workspaceId: observable.workspaceId,
      };
    },
    customLogLevel: (request, response, error) => {
      if (error || response.statusCode >= 500) {
        if (request.url === "/v1/ready" && response.statusCode === 503) {
          return "warn";
        }
        return "error";
      }
      if (response.statusCode >= 400) {
        return "warn";
      }
      return "info";
    },
    serializers: {
      req(request) {
        const observable = request as ObservableRequest;
        return {
          id: observable.requestId,
          method: observable.method,
          url: redactRequestUrlForLog(observable.url),
          remoteAddress: observable.remoteAddress,
          userAgent: observable.headers?.["user-agent"],
        };
      },
      res(response) {
        return {
          statusCode: response.statusCode,
        };
      },
    },
    autoLogging: {
      ignore: (request) => request.url === "/v1/metrics",
    },
  }) as unknown as RequestHandler;
}
