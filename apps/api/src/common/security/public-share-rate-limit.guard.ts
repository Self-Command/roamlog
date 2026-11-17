import { Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request, Response } from "express";

import { applyRateLimitDecision, rateLimitIdentity, rejectRateLimited } from "./rate-limit-http.js";
import { RateLimitService } from "./rate-limit.service.js";

@Injectable()
export class PublicShareRateLimitGuard implements CanActivate {
  constructor(@Inject(RateLimitService) private readonly rateLimits: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const identity = rateLimitIdentity(request);

    const readDecision = await this.rateLimits.consume("publicShareRead", identity);
    applyRateLimitDecision(response, readDecision);
    if (!readDecision.allowed) {
      rejectRateLimited(response, readDecision, "publicShareRead");
    }

    if (hasPasswordAttempt(request)) {
      const passwordDecision = await this.rateLimits.consume("publicSharePassword", identity);
      applyRateLimitDecision(response, passwordDecision);
      if (!passwordDecision.allowed) {
        rejectRateLimited(response, passwordDecision, "publicSharePassword");
      }
    }
    return true;
  }
}

function hasPasswordAttempt(request: Request): boolean {
  const query = request.query;
  return (
    typeof query === "object" &&
    query !== null &&
    Object.prototype.hasOwnProperty.call(query, "password")
  );
}
