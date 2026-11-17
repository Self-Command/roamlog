import { Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request, Response } from "express";

import { applyRateLimitDecision, rateLimitIdentity, rejectRateLimited } from "./rate-limit-http.js";
import { RateLimitService } from "./rate-limit.service.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class AuthMutationRateLimitGuard implements CanActivate {
  constructor(@Inject(RateLimitService) private readonly rateLimits: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    const response = http.getResponse<Response>();
    const decision = await this.rateLimits.consume("authMutation", rateLimitIdentity(request));
    applyRateLimitDecision(response, decision);
    if (!decision.allowed) {
      rejectRateLimited(response, decision, "authMutation");
    }
    return true;
  }
}
