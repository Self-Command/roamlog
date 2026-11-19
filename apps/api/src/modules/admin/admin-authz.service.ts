import { Inject, Injectable } from "@nestjs/common";
import {
  ADMIN_ACTIONS,
  PLATFORM_ROLE_ACTIONS,
  PLATFORM_ROLES,
  isGrantableAdminAction,
  type PlatformRole,
} from "@roamlog/contracts";

import { PinoLoggerService } from "../observability/pino-logger.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

/** Injection token for the runtime authorization seam (guard and services). */
export const ADMIN_AUTHZ_PORT = Symbol("ADMIN_AUTHZ_PORT");

/**
 * In-process cache TTL for effective platform actions. A different API instance
 * that did not handle the `PATCH /v1/admin/permissions` request converges within
 * this window.
 */
export const ADMIN_AUTHZ_CACHE_TTL_MS = 30_000;

const FALLBACK_WARN_THROTTLE_MS = 60_000;

/**
 * Runtime source of truth for platform authorization.
 *
 * Kept as an interface so the guard can be tested with a stub, and so an
 * alternative implementation could be swapped without touching route code.
 */
export interface AdminAuthzPort {
  getEffectiveActions(role: PlatformRole): Promise<ReadonlySet<string>>;
  invalidate(role?: PlatformRole): void;
}

export interface StoredPermissionOverride {
  role: string;
  action: string;
  granted: boolean;
}

interface CachedActions {
  actions: ReadonlySet<string>;
  expiresAt: number;
}

/**
 * Effective actions = the compiled matrix, then the stored diff.
 *
 * Rules, in order:
 * - Unknown roles get nothing.
 * - `super_admin` always keeps the full code surface: a stored `granted=false`
 *   row must never weaken the platform owner.
 * - `user` never gets an admin action: a stored `granted=true` row must never
 *   let a normal account into the Admin API.
 * - A row can only move a *grantable* action. The write path already rejects
 *   security-sensitive changes; this read-side allowlist means a corrupt row
 *   (manual SQL, old release, restored dump) still cannot widen the surface.
 * - Duplicate rows for one (role, action) pair are applied in order, so the last
 *   row wins. The query orders by `updatedAt` ascending to make that stable.
 */
export function effectiveActionsFromOverrides(
  role: PlatformRole,
  overrides: readonly StoredPermissionOverride[],
): ReadonlySet<string> {
  if (!PLATFORM_ROLES.includes(role)) {
    return new Set<string>();
  }
  if (role === "super_admin") {
    return new Set<string>(ADMIN_ACTIONS);
  }
  if (role === "user") {
    return new Set<string>();
  }

  const granted = new Set<string>(PLATFORM_ROLE_ACTIONS[role]);
  for (const override of overrides) {
    if (override.role !== role) {
      continue;
    }
    if (!isGrantableAdminAction(override.action)) {
      continue;
    }
    if (override.granted) {
      granted.add(override.action);
    } else {
      granted.delete(override.action);
    }
  }
  return granted;
}

@Injectable()
export class AdminAuthzService implements AdminAuthzPort {
  private readonly cache = new Map<PlatformRole, CachedActions>();
  private pendingOverrides: Promise<readonly StoredPermissionOverride[]> | undefined;
  private lastFallbackWarnAt = 0;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PinoLoggerService) private readonly logger: PinoLoggerService,
  ) {}

  async getEffectiveActions(role: PlatformRole): Promise<ReadonlySet<string>> {
    // The two invariants are code-defined and never require a database read.
    if (role === "super_admin" || role === "user") {
      return effectiveActionsFromOverrides(role, []);
    }

    const cached = this.cache.get(role);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.actions;
    }

    let overrides: readonly StoredPermissionOverride[];
    try {
      overrides = await this.loadOverrides();
    } catch (error) {
      // Authorization must not fall over because the override table is flaky.
      // Degrade to the compiled matrix (the stricter, code-owned default) and
      // never cache the degraded answer: the next request retries the database.
      this.cache.delete(role);
      this.warnFallback(error);
      return effectiveActionsFromOverrides(role, []);
    }

    const actions = effectiveActionsFromOverrides(role, overrides);
    this.cache.set(role, {
      actions,
      expiresAt: Date.now() + ADMIN_AUTHZ_CACHE_TTL_MS,
    });
    return actions;
  }

  /** Called by `AdminPermissionsService.update` after a successful commit. */
  invalidate(role?: PlatformRole): void {
    if (role === undefined) {
      this.cache.clear();
      return;
    }
    this.cache.delete(role);
  }

  private loadOverrides(): Promise<readonly StoredPermissionOverride[]> {
    // One in-flight read per process: concurrent requests for different roles
    // share the same database round-trip.
    this.pendingOverrides ??= (async () => {
      // A Prisma client without the generated delegate (stale client, mocked
      // test module, partial deployment) is treated like an unavailable table:
      // degrade to the code matrix instead of turning every Admin route into a
      // 500.
      const delegate = this.prisma.client?.platformRoleOverride;
      if (!delegate) {
        throw new Error("PlatformRoleOverride Prisma delegate is unavailable");
      }
      const rows = await delegate.findMany({
        select: { role: true, action: true, granted: true },
        orderBy: { updatedAt: "asc" },
      });
      return rows.map((row) => ({
        role: String(row.role),
        action: row.action,
        granted: row.granted,
      }));
    })().finally(() => {
      this.pendingOverrides = undefined;
    });
    return this.pendingOverrides;
  }

  private warnFallback(error: unknown): void {
    const now = Date.now();
    if (now - this.lastFallbackWarnAt < FALLBACK_WARN_THROTTLE_MS) {
      return;
    }
    this.lastFallbackWarnAt = now;
    this.logger.warn(
      {
        event: "admin.authz.override_unavailable",
        fallback: "code_matrix",
        ...(error instanceof Error ? { reason: error.name } : {}),
      },
      "admin authorization fell back to the compiled permission matrix",
    );
  }
}