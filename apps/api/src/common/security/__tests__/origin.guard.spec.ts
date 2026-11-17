import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import type { AppConfigService } from "../../../config/app-config.service.js";
import { OriginGuard } from "../origin.guard.js";

interface RequestLike {
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

function context(request: RequestLike): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function config(isProduction: boolean): AppConfigService {
  return {
    isProduction,
    appUrl: "https://app.roamlog.test",
    adminUrl: "https://admin.roamlog.test",
    apiUrl: "https://api.roamlog.test",
    betterAuthUrl: "https://api.roamlog.test",
    corsOrigins: ["https://app.roamlog.test", "https://admin.roamlog.test"],
  } as unknown as AppConfigService;
}

describe.each([false, true])("OriginGuard (production=%s)", (production) => {
  const guard = new OriginGuard(config(production));

  it("allows configured browser origins and browser Referer values", () => {
    expect(
      guard.canActivate(
        context({
          method: "POST",
          headers: { origin: "https://app.roamlog.test" },
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        context({
          method: "PATCH",
          headers: { referer: "https://admin.roamlog.test/workspaces/1" },
        }),
      ),
    ).toBe(true);
  });

  it("allows non-browser requests that provide neither Origin nor Referer", () => {
    expect(
      guard.canActivate(
        context({
          method: "POST",
          headers: {},
        }),
      ),
    ).toBe(true);
  });

  it("rejects a disallowed Origin or Referer with CSRF_ORIGIN_REJECTED", () => {
    for (const headers of [
      { origin: "https://evil.example" },
      { referer: "https://evil.example/path" },
      { origin: "null" },
      { origin: ["https://app.roamlog.test", "https://evil.example"] },
    ]) {
      try {
        guard.canActivate(context({ method: "DELETE", headers }));
        throw new Error("Expected OriginGuard to reject the request");
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error).toMatchObject({
          response: { code: "CSRF_ORIGIN_REJECTED" },
        });
      }
    }
  });

  it("does not apply to safe methods", () => {
    expect(
      guard.canActivate(
        context({
          method: "GET",
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toBe(true);
  });
});
