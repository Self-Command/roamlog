import { Catch, HttpException, HttpStatus } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { problemDetails, ProblemDetailsSchema, type ProblemDetails } from "@roamlog/contracts";
import type { Request, Response } from "express";

import { PinoLoggerService } from "../../modules/observability/pino-logger.service.js";
import { SentryService } from "../../modules/observability/sentry.service.js";

const STATUS_CODES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "BAD_REQUEST",
  [HttpStatus.UNAUTHORIZED]: "UNAUTHORIZED",
  [HttpStatus.FORBIDDEN]: "FORBIDDEN",
  [HttpStatus.NOT_FOUND]: "NOT_FOUND",
  [HttpStatus.CONFLICT]: "CONFLICT",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "VALIDATION_ERROR",
  [HttpStatus.TOO_MANY_REQUESTS]: "RATE_LIMITED",
  [HttpStatus.INTERNAL_SERVER_ERROR]: "INTERNAL_SERVER_ERROR",
  [HttpStatus.SERVICE_UNAVAILABLE]: "SERVICE_UNAVAILABLE",
};

const VALID_CODE = /^[A-Z][A-Z0-9_]*$/;

type ExceptionPayload = Record<string, unknown>;

function recordPayload(value: unknown): ExceptionPayload | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as ExceptionPayload)
    : undefined;
}

function text(value: unknown, maxLength = 2_000): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function defaultCode(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? "SERVER_ERROR" : "REQUEST_ERROR");
}

function requestInstance(request: Request): string {
  const [path] = request.originalUrl.split("?");
  return path || request.path;
}

function normalizedCode(value: unknown, status: number): string {
  const candidate = text(value, 80);
  return candidate && VALID_CODE.test(candidate) ? candidate : defaultCode(status);
}

function normalizedErrors(payload: ExceptionPayload | undefined) {
  const rawErrors = payload?.errors;
  const messages = payload?.message;
  const entries = Array.isArray(rawErrors)
    ? rawErrors
    : Array.isArray(messages)
      ? messages.map((message) => ({ message }))
      : [];

  return entries.flatMap((entry) => {
    if (typeof entry === "string") {
      const message = text(entry);
      return message ? [{ code: "INVALID_INPUT", message }] : [];
    }

    const record = recordPayload(entry);
    const message = text(record?.message) ?? text(entry);
    if (!message) {
      return [];
    }

    const field = text(record?.field, 200);
    return [
      {
        ...(field ? { field } : {}),
        code: normalizedCode(record?.code, HttpStatus.UNPROCESSABLE_ENTITY),
        message,
      },
    ];
  });
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: PinoLoggerService,
    private readonly sentry: SentryService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload =
      exception instanceof HttpException ? recordPayload(exception.getResponse()) : undefined;
    const code = normalizedCode(payload?.code, status);
    const title = text(payload?.title, 120);
    const suppliedDetail = text(payload?.detail) ?? text(payload?.message);
    const detail = status >= 500 ? undefined : suppliedDetail;
    const errors = normalizedErrors(payload);
    const instance = requestInstance(request);

    let body: ProblemDetails;
    try {
      body = problemDetails({
        status,
        code,
        ...(title ? { title } : {}),
        ...(detail ? { detail } : {}),
        instance,
        errors,
      });
    } catch {
      body = ProblemDetailsSchema.parse({
        type: "https://roamlog.app/errors/internal-server-error",
        title: "Internal Server Error",
        status: 500,
        code: "INTERNAL_SERVER_ERROR",
        instance,
        errors: [],
      });
    }

    const logContext = {
      err: exception,
      requestId: request.requestId,
      method: request.method,
      path: request.path,
      statusCode: status,
      code,
    };

    if (status >= 500) {
      this.logger.error(logContext, "http.request_failed");
      this.sentry.captureException(exception, {
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        statusCode: status,
      });
    } else {
      this.logger.warn(logContext, "http.request_rejected");
    }

    if (response.headersSent) {
      return;
    }

    response.status(status).type("application/problem+json").send(body);
  }
}
