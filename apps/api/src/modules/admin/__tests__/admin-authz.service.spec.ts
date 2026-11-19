import { ADMIN_ACTIONS, PLATFORM_ROLE_ACTIONS, type PlatformRole } from "@roamlog/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN_AUTHZ_CACHE_TTL_MS,
  AdminAuthzService,
  effectiveActionsFromOverrides,
  type StoredPermissionOverride,
} from "../admin-authz.service.js";

type Override = StoredPermissionOverride;

function setup(initial: Override[] = []) {
  const findMany = vi.fn().mockResolvedValue(initial);
  const prisma = { client: { platformRoleOverride: { findMany } } };
  const logger = {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    fatal: vi.fn(),
  };
  const service = new AdminAuthzService(prisma as never, logger as never);
  return { service, findMany, logger, prisma };
}

function sorted(actions: ReadonlySet<string>): string[] {
  return [...actions].sort();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("effectiveActionsFromOverrides", () => {
  it("is the compiled matrix when the override table is empty", () => {
    for (const role of ["support", "analyst", "admin"] as const) {
      expect(sorted(effectiveActionsFromOverrides(role, []))).toEqual(
        sorted(new Set(PLATFORM_ROLE_ACTIONS[role])),
      );
    }
  });

  it("adds granted rows and removes revoked rows", () => {
    const support = effectiveActionsFromOverrides("support", [
      { role: "support", action: "admin:flags:update", granted: true },
      { role: "support", action: "admin:users:suspend", granted: false },
    ]);

    expect(support.has("admin:flags:update")).toBe(true);
    expect(support.has("admin:users:suspend")).toBe(false);
    expect(support.has("admin:users:read")).toBe(true);
  });

  it("applies later rows for the same pair last", () => {
    const revokedThenGranted = effectiveActionsFromOverrides("analyst", [
      { role: "analyst", action: "admin:content:read", granted: false },
      { role: "analyst", action: "admin:content:read", granted: true },
    ]);
    const grantedThenRevoked = effectiveActionsFromOverrides("support", [
      { role: "support", action: "admin:flags:read", granted: true },
      { role: "support", action: "admin:flags:read", granted: false },
    ]);

    expect(revokedThenGranted.has("admin:content:read")).toBe(true);
    expect(grantedThenRevoked.has("admin:flags:read")).toBe(false);
  });

  it("ignores rows for security-sensitive actions in either direction", () => {
    const support = effectiveActionsFromOverrides("support", [
      { role: "support", action: "admin:users:delete", granted: true },
      { role: "support", action: "admin:permissions:write", granted: true },
    ]);
    const admin = effectiveActionsFromOverrides("admin", [
      // admin has this in code; the row must not be able to take it away.
      { role: "admin", action: "admin:users:delete", granted: false },
      { role: "admin", action: "admin:settings:write", granted: true },
    ]);

    expect(support.has("admin:users:delete")).toBe(false);
    expect(support.has("admin:permissions:write")).toBe(false);
    expect(admin.has("admin:users:delete")).toBe(true);
    expect(admin.has("admin:settings:write")).toBe(false);
  });

  it("keeps super_admin at the full code surface despite revocation rows", () => {
    const superAdmin = effectiveActionsFromOverrides("super_admin", [
      { role: "super_admin", action: "admin:flags:update", granted: false },
      { role: "super_admin", action: "admin:jobs:manage", granted: false },
    ]);

    expect(superAdmin.size).toBe(ADMIN_ACTIONS.length);
    expect(superAdmin.has("admin:flags:update")).toBe(true);
    expect(superAdmin.has("admin:jobs:manage")).toBe(true);
  });

  it("never grants an admin action to the user role", () => {
    const user = effectiveActionsFromOverrides("user", [
      { role: "user", action: "admin:metrics:read", granted: true },
      { role: "user", action: "admin:content:read", granted: true },
    ]);

    expect(user.size).toBe(0);
  });
});

describe("AdminAuthzService", () => {
  it("loads the compiled matrix plus the stored diff", async () => {
    const { service, findMany } = setup([
      { role: "support", action: "admin:flags:update", granted: true },
    ]);

    const actions = await service.getEffectiveActions("support");

    expect(actions.has("admin:flags:update")).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { role: true, action: true, granted: true },
        orderBy: { updatedAt: "asc" },
      }),
    );
  });

  it("does not hit the database for super_admin or user", async () => {
    const { service, findMany } = setup([
      { role: "super_admin", action: "admin:flags:update", granted: false },
      { role: "user", action: "admin:flags:read", granted: true },
    ]);

    expect((await service.getEffectiveActions("super_admin")).size).toBe(ADMIN_ACTIONS.length);
    expect((await service.getEffectiveActions("user")).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("serves the cached answer for 30s and then reads the new value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T00:00:00.000Z"));
    const { service, findMany } = setup();

    const first = await service.getEffectiveActions("analyst");
    expect(first.has("admin:content:read")).toBe(false);

    findMany.mockResolvedValue([
      { role: "analyst", action: "admin:content:read", granted: true },
    ] satisfies Override[]);
    const cached = await service.getEffectiveActions("analyst");
    expect(cached.has("admin:content:read")).toBe(false);
    expect(findMany).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(ADMIN_AUTHZ_CACHE_TTL_MS - 1);
    expect((await service.getEffectiveActions("analyst")).has("admin:content:read")).toBe(
      false,
    );

    vi.advanceTimersByTime(2);
    const refreshed = await service.getEffectiveActions("analyst");
    expect(refreshed.has("admin:content:read")).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("invalidate() makes the next authorization decision read fresh state", async () => {
    const { service, findMany } = setup();

    await service.getEffectiveActions("support");
    expect((await service.getEffectiveActions("support")).has("admin:flags:update")).toBe(false);

    findMany.mockResolvedValue([
      { role: "support", action: "admin:flags:update", granted: true },
    ] satisfies Override[]);

    service.invalidate();
    expect((await service.getEffectiveActions("support")).has("admin:flags:update")).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("invalidates only the requested role", async () => {
    const { service, findMany } = setup([
      { role: "support", action: "admin:flags:update", granted: true },
      { role: "analyst", action: "admin:content:read", granted: true },
    ]);
    await Promise.all([
      service.getEffectiveActions("support"),
      service.getEffectiveActions("analyst"),
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);

    service.invalidate("support");
    await service.getEffectiveActions("analyst");
    expect(findMany).toHaveBeenCalledTimes(1);

    await service.getEffectiveActions("support");
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("falls back to the compiled matrix and warns when the override table is unavailable", async () => {
    const { service, findMany, logger } = setup();
    findMany.mockRejectedValueOnce(new Error("connection refused"));

    const degraded = await service.getEffectiveActions("admin");
    expect(sorted(degraded)).toEqual(sorted(new Set(PLATFORM_ROLE_ACTIONS.admin)));
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "admin.authz.override_unavailable",
        fallback: "code_matrix",
      }),
      expect.any(String),
    );

    // The degraded answer is not cached: the next request retries and recovers.
    findMany.mockResolvedValue([
      { role: "admin", action: "admin:flags:update", granted: true },
    ] satisfies Override[]);
    const recovered = await service.getEffectiveActions("admin");
    expect(recovered.has("admin:flags:update")).toBe(true);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("falls back when the generated Prisma delegate is missing", async () => {
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
      fatal: vi.fn(),
    };
    const service = new AdminAuthzService({ client: {} } as never, logger as never);

    const actions = await service.getEffectiveActions("admin");

    expect(sorted(actions)).toEqual(sorted(new Set(PLATFORM_ROLE_ACTIONS.admin)));
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight database read across concurrent role lookups", async () => {
    let resolveRows: (rows: Override[]) => void = () => undefined;
    const findMany = vi.fn().mockReturnValue(
      new Promise<Override[]>((resolve) => {
        resolveRows = resolve;
      }),
    );
    const prisma = { client: { platformRoleOverride: { findMany } } };
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), verbose: vi.fn(), fatal: vi.fn() };
    const service = new AdminAuthzService(prisma as never, logger as never);

    const support = service.getEffectiveActions("support");
    const analyst = service.getEffectiveActions("analyst");
    expect(findMany).toHaveBeenCalledTimes(1);

    resolveRows([
      { role: "support", action: "admin:flags:update", granted: true },
      { role: "analyst", action: "admin:content:read", granted: true },
    ]);

    expect((await support).has("admin:flags:update")).toBe(true);
    expect((await analyst).has("admin:content:read")).toBe(true);
  });
});

describe("AdminAuthzService role typing", () => {
  it("accepts every platform role", async () => {
    const { service } = setup();
    const roles: PlatformRole[] = ["user", "support", "analyst", "admin", "super_admin"];

    for (const role of roles) {
      await expect(service.getEffectiveActions(role)).resolves.toBeInstanceOf(Set);
    }
  });
});