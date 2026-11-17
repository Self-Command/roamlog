import type { CookieOptions } from "express";

import type { AppConfigService } from "./app-config.service.js";

export const SESSION_COOKIE_NAME = "roamlog.session_token";
export const SESSION_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function createSessionCookieOptions(config: AppConfigService): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction || config.apiUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    priority: "high",
    ...(config.sessionCookieDomain ? { domain: config.sessionCookieDomain } : {}),
  };
}
