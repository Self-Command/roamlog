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
          url: observable.url,
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
