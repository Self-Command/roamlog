import { Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request, Response } from "express";

import { applyRateLimitDecision, rateLimitIdentity, rejectRateLimited } from "./rate-limit-http.js";
import { RateLimitService } from "./rate-limit.service.js";

@Injectable()
export class MediaPresignRateLimitGuard implements CanActivate {
  constructor(@Inject(RateLimitService) private readonly rateLimits: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const decision = await this.rateLimits.consume("mediaPresign", rateLimitIdentity(request));
    applyRateLimitDecision(response, decision);
    if (!decision.allowed) {
      rejectRateLimited(response, decision, "mediaPresign");
    }
    return true;
  }
}
