/**
 * Per-account presign allowance, counted in *links* rather than requests.
 *
 * `MediaPresignRateLimitGuard` (shared security module) limits requests per IP
 * from the deployment env. This guard is the account-level rule the operator
 * edits in the admin console: `limits.uploadPerMinute` presigned links per
 * account per minute, so a batch of N files charges N. Both buckets apply — the
 * env guard is the crude per-IP shield, this one is the configurable policy.
 *
 * It must run **after** `TenantGuard` (which resolves `request.user` and
 * `request.workspaceMembership`); the identity is the user id, not the IP.
 *
 * The charge happens before the controller parses the body on purpose: the
 * point of the allowance is to bound how many signed URLs an account can mint,
 * so a malformed batch still counts as an attempt. A batch that crosses the
 * allowance is rejected whole, before any `Media` row exists.
 */

import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Response } from "express";
import { MEDIA_ERROR_CODES } from "@roamlog/contracts";

import type { AuthenticatedRequest } from "../../common/guards/actor-context.js";
import { MediaUploadLimitsService } from "./media-upload-limits.service.js";

@Injectable()
export class MediaUploadRateLimitGuard implements CanActivate {
  constructor(
    @Inject(MediaUploadLimitsService) private readonly limits: MediaUploadLimitsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    const identity = request.workspaceMembership?.userId ?? request.user?.id;
    if (!identity) {
      // Auth guards run before this one; an anonymous request is rejected there,
      // and there is nothing to charge here.
      return true;
    }

    const tokens = requestedPresignCount(request.body);
    if (tokens <= 0) {
      return true;
    }

    const limits = await this.limits.resolve();
    const allowance = await this.limits.consume(identity, tokens, limits.presignPerMinute);

    response.setHeader("RateLimit-Limit", String(allowance.limit));
    response.setHeader("RateLimit-Remaining", String(allowance.remaining));
    response.setHeader("RateLimit-Reset", String(allowance.retryAfterSeconds));
    if (allowance.degraded) {
      response.setHeader("X-RateLimit-Degraded", "true");
    }
    if (!allowance.allowed) {
      response.setHeader("Retry-After", String(allowance.retryAfterSeconds));
      throw new HttpException(
        {
          code: MEDIA_ERROR_CODES.rateLimited,
          message: "Too many uploads. Retry after the indicated delay.",
          policy: "mediaUpload",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

/**
 * How many presigned links this request would mint: one for the single-file
 * route, `files.length` for a batch. A body the schema will reject anyway counts
 * as one attempt.
 */
function requestedPresignCount(body: unknown): number {
  const files = (body as { files?: unknown } | null | undefined)?.files;
  if (!Array.isArray(files)) {
    return 1;
  }
  return Math.max(1, files.length);
}