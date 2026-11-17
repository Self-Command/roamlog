import { HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";

import type { RateLimitDecision, RateLimitPolicy } from "./rate-limit.service.js";

export function rateLimitIdentity(request: Request): string {
  return request.ip?.trim() || request.socket.remoteAddress?.trim() || "unknown";
}

export function applyRateLimitDecision(response: Response, decision: RateLimitDecision): void {
  response.setHeader("RateLimit-Limit", String(decision.limit));
  response.setHeader("RateLimit-Remaining", String(decision.remaining));
  response.setHeader("RateLimit-Reset", String(decision.retryAfterSeconds));
  if (decision.degraded) {
    response.setHeader("X-RateLimit-Degraded", "true");
  }
  if (!decision.allowed) {
    response.setHeader("Retry-After", String(decision.retryAfterSeconds));
  }
}

export function rejectRateLimited(
  response: Response,
  decision: RateLimitDecision,
  policy: RateLimitPolicy,
): never {
  applyRateLimitDecision(response, decision);
  throw new HttpException(
    {
      code: "RATE_LIMITED",
      message: "Too many requests. Retry after the indicated delay.",
      policy,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
