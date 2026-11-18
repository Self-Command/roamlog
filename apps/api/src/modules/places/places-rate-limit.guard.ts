import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Response } from "express";

import type { AuthenticatedRequest } from "../../common/guards/actor-context.js";
import { PlacesRateLimiter } from "./places-rate-limiter.service.js";

/**
 * Limits `GET /v1/places/search` by authenticated user + client IP.
 *
 * Header and problem-details conventions mirror the existing rate-limit guards:
 * `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` are set on every
 * response, `Retry-After` is set when rejecting, and the rejection is a
 * `429 RATE_LIMITED` Problem Details response.
 */
@Injectable()
export class PlaceSearchRateLimitGuard implements CanActivate {
  constructor(@Inject(PlacesRateLimiter) private readonly rateLimits: PlacesRateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    const ip = request.ip?.trim() || request.socket.remoteAddress?.trim() || "unknown";
    const identity = `user:${request.user?.id ?? "anonymous"}|ip:${ip}`;
    const decision = await this.rateLimits.consume(identity);

    response.setHeader("RateLimit-Limit", String(decision.limit));
    response.setHeader("RateLimit-Remaining", String(decision.remaining));
    response.setHeader("RateLimit-Reset", String(decision.retryAfterSeconds));

    if (!decision.allowed) {
      response.setHeader("Retry-After", String(decision.retryAfterSeconds));
      throw new HttpException(
        {
          code: "RATE_LIMITED",
          message: "Too many requests. Retry after the indicated delay.",
          policy: "placeSearch",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
