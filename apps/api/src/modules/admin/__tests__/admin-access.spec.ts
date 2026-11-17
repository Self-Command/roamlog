import { ForbiddenException } from "@nestjs/common";
import { canPlatform } from "@roamlog/contracts";
import { describe, expect, it } from "vitest";

import {
  assertAdminAction,
  assertPlatformAction,
} from "../admin-access.js";
import { AdminGuard } from "../admin.guard.js";
import { ADMIN_PERMISSION_METADATA } from "../admin.decorator.js";
import { makeActor, USER_OWNER_ID } from "../../../../test/identity-fixtures.js";

describe("platform admin access", () => {
  it("matches the contract role matrix for destructive and system actions", () => {
    expect(canPlatform("support", "admin:users:suspend")).toBe(true);
    expect(canPlatform("support", "admin:users:delete")).toBe(false);
    expect(canPlatform("support", "admin:jobs:retry")).toBe(false);

    expect(canPlatform("analyst", "admin:metrics:read")).toBe(true);
    expect(canPlatform("analyst", "admin:audit:export")).toBe(true);
    expect(canPlatform("analyst", "admin:workspaces:suspend")).toBe(false);

    expect(canPlatform("admin", "admin:content:delete")).toBe(true);
    expect(canPlatform("admin", "admin:jobs:retry")).toBe(true);
    expect(canPlatform("admin", "admin:jobs:manage")).toBe(false);
    expect(canPlatform("admin", "admin:flags:update")).toBe(false);
    expect(canPlatform("admin", "admin:users:change-role")).toBe(false);

    expect(canPlatform("super_admin", "admin:jobs:manage")).toBe(true);
    expect(canPlatform("super_admin", "admin:flags:update")).toBe(true);
    expect(canPlatform("super_admin", "admin:users:change-role")).toBe(true);
  });

  it("rejects a normal user from every admin action", () => {
    expect(canPlatform("user", "admin:metrics:read")).toBe(false);
    expect(() => assertPlatformAction(makeActor().user, "admin:metrics:read")).toThrow(
      ForbiddenException,
    );
  });

  it("names the denied action in the problem details", () => {
    try {
      assertAdminAction(makeActor(USER_OWNER_ID, { platformRole: "support" }), "admin:users:delete");
      throw new Error("expected a ForbiddenException");
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      const response = (error as ForbiddenException).getResponse() as Record<string, unknown>;
      expect(response.code).toBe("ADMIN_ACTION_FORBIDDEN");
      expect(response.action).toBe("admin:users:delete");
    }
  });
});

describe("AdminGuard", () => {
  function contextFor(role: "user" | "support" | "analyst" | "admin" | "super_admin", action: string) {
    const handler = function handler() {
      return undefined;
    };
    Reflect.defineMetadata(ADMIN_PERMISSION_METADATA, action, handler);

    return {
      getHandler: () => handler,
      getClass: () => class TestController {},
      switchToHttp: () => ({
        getRequest: () => ({
          user: makeActor(USER_OWNER_ID, { platformRole: role }).user,
        }),
      }),
    } as never;
  }

  it("allows support to read metrics but not delete users", () => {
    const guard = new AdminGuard();

    expect(guard.canActivate(contextFor("support", "admin:metrics:read"))).toBe(true);
    expect(() => guard.canActivate(contextFor("support", "admin:users:delete"))).toThrow(
      ForbiddenException,
    );
  });

  it("allows admin to retry jobs but not update feature flags", () => {
    const guard = new AdminGuard();

    expect(guard.canActivate(contextFor("admin", "admin:jobs:retry"))).toBe(true);
    expect(() => guard.canActivate(contextFor("admin", "admin:flags:update"))).toThrow(
      ForbiddenException,
    );
  });

  it("allows super_admin to manage queues and update flags", () => {
    const guard = new AdminGuard();

    expect(guard.canActivate(contextFor("super_admin", "admin:jobs:manage"))).toBe(true);
    expect(guard.canActivate(contextFor("super_admin", "admin:flags:update"))).toBe(true);
  });

  it("rejects unauthenticated callers", () => {
    const guard = new AdminGuard();
    const handler = function handler() {
      return undefined;
    };
    Reflect.defineMetadata(ADMIN_PERMISSION_METADATA, "admin:metrics:read", handler);

    expect(() =>
      guard.canActivate({
        getHandler: () => handler,
        getClass: () => class TestController {},
        switchToHttp: () => ({ getRequest: () => ({}) }),
      } as never),
    ).toThrow();
  });
});
