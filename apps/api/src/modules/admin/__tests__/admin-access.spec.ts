import { ForbiddenException } from "@nestjs/common";
import { PLATFORM_ROLE_ACTIONS, canPlatform } from "@roamlog/contracts";
import { describe, expect, it } from "vitest";

import {
  assertAdminAction,
  assertPlatformAction,
} from "../admin-access.js";
import { AdminGuard } from "../admin.guard.js";
import { ADMIN_PERMISSION_METADATA } from "../admin.decorator.js";
import type { AdminAuthzPort } from "../admin-authz.service.js";
import { makeActor, USER_OWNER_ID } from "../../../../test/identity-fixtures.js";

type Role = "user" | "support" | "analyst" | "admin" | "super_admin";

/** Mirrors the pre-override behavior by serving the compiled matrix directly. */
function codeMatrixAuthz(): AdminAuthzPort {
  return {
    getEffectiveActions: async (role) => new Set(PLATFORM_ROLE_ACTIONS[role]),
    invalidate: () => undefined,
  };
}

function authzWith(role: Role, actions: readonly string[]): AdminAuthzPort {
  return {
    getEffectiveActions: async (requested) =>
      requested === role ? new Set(actions) : new Set(PLATFORM_ROLE_ACTIONS[requested]),
    invalidate: () => undefined,
  };
}

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

describe("assertAdminAction", () => {
  it("uses the effective actions attached by AdminGuard", () => {
    const support = makeActor(USER_OWNER_ID, { platformRole: "support" });

    // A granted override passes the guard, so the inner assertion must agree.
    support.platformActions = new Set(["admin:users:read", "admin:flags:update"]);
    expect(() => assertAdminAction(support, "admin:flags:update")).not.toThrow();

    // A revoked override must block the inner assertion too.
    support.platformActions = new Set(["admin:flags:update"]);
    expect(() => assertAdminAction(support, "admin:users:read")).toThrow(ForbiddenException);
  });

  it("falls back to the compiled matrix outside an Admin API request", () => {
    const support = makeActor(USER_OWNER_ID, { platformRole: "support" });

    expect(() => assertAdminAction(support, "admin:users:read")).not.toThrow();
    expect(() => assertAdminAction(support, "admin:flags:update")).toThrow(ForbiddenException);
  });
});

describe("AdminGuard", () => {
  function contextFor(role: Role, action: string) {
    const handler = function handler() {
      return undefined;
    };
    Reflect.defineMetadata(ADMIN_PERMISSION_METADATA, action, handler);
    const request: {
      user?: ReturnType<typeof makeActor>["user"];
      adminActions?: ReadonlySet<string>;
    } = {
      user: makeActor(USER_OWNER_ID, { platformRole: role }).user,
    };

    return {
      request,
      context: {
        getHandler: () => handler,
        getClass: () => class TestController {},
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as never,
    };
  }

  it("allows support to read metrics but not delete users", async () => {
    const guard = new AdminGuard(codeMatrixAuthz());

    await expect(guard.canActivate(contextFor("support", "admin:metrics:read").context)).resolves.toBe(
      true,
    );
    await expect(
      guard.canActivate(contextFor("support", "admin:users:delete").context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows admin to retry jobs but not update feature flags", async () => {
    const guard = new AdminGuard(codeMatrixAuthz());

    await expect(
      guard.canActivate(contextFor("admin", "admin:jobs:retry").context),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor("admin", "admin:flags:update").context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows super_admin to manage queues and update flags", async () => {
    const guard = new AdminGuard(codeMatrixAuthz());

    await expect(
      guard.canActivate(contextFor("super_admin", "admin:jobs:manage").context),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor("super_admin", "admin:flags:update").context),
    ).resolves.toBe(true);
  });

  it("honors a granted override and exposes the effective set downstream", async () => {
    const supportActions = [...PLATFORM_ROLE_ACTIONS.support, "admin:flags:update"];
    const guard = new AdminGuard(authzWith("support", supportActions));
    const { context, request } = contextFor("support", "admin:flags:update");

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.adminActions?.has("admin:flags:update")).toBe(true);
    expect(request.adminActions?.has("admin:users:read")).toBe(true);
  });

  it("honors a revoked override even though the code matrix grants it", async () => {
    const revoked = PLATFORM_ROLE_ACTIONS.support.filter(
      (action) => action !== "admin:users:read",
    );
    const guard = new AdminGuard(authzWith("support", revoked));

    await expect(
      guard.canActivate(contextFor("support", "admin:users:read").context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("surfaces authorization-source failures instead of allowing the request", async () => {
    const failure = new Error("authorization source unavailable");
    const guard = new AdminGuard({
      getEffectiveActions: async () => {
        throw failure;
      },
      invalidate: () => undefined,
    });

    await expect(
      guard.canActivate(contextFor("admin", "admin:metrics:read").context),
    ).rejects.toBe(failure);
  });

  it("rejects unauthenticated callers", async () => {
    const guard = new AdminGuard(codeMatrixAuthz());
    const handler = function handler() {
      return undefined;
    };
    Reflect.defineMetadata(ADMIN_PERMISSION_METADATA, "admin:metrics:read", handler);

    await expect(
      guard.canActivate({
        getHandler: () => handler,
        getClass: () => class TestController {},
        switchToHttp: () => ({ getRequest: () => ({}) }),
      } as never),
    ).rejects.toBeInstanceOf(Error);
  });
});