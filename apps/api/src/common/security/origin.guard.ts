import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import { AppConfigService } from "../../config/app-config.service.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      return true;
    }

    const origin = headerValue(request.headers.origin);
    const referer = headerValue(request.headers.referer);
    const candidate = origin !== undefined ? origin : referer;
    if (candidate === undefined) {
      return true;
    }

    const normalized = candidate === null ? null : normalizeOrigin(candidate);
    if (!normalized || !this.allowedOrigins().has(normalized)) {
      throw new ForbiddenException({
        code: "CSRF_ORIGIN_REJECTED",
        message: "The request Origin or Referer is not allowed.",
      });
    }
    return true;
  }

  private allowedOrigins(): Set<string> {
    const origins = new Set<string>();
    for (const value of [
      this.config.appUrl,
      this.config.adminUrl,
      this.config.apiUrl,
      this.config.betterAuthUrl,
      ...this.config.corsOrigins,
    ]) {
      const normalized = normalizeOrigin(value);
      if (normalized) {
        origins.add(normalized);
      }
    }
    return origins;
  }
}

function headerValue(value: string | string[] | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? value : null;
}

function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol) || parsed.username || parsed.password) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}
