import { Inject, Injectable, UnprocessableEntityException } from "@nestjs/common";
import {
  ADMIN_ACTION_DESCRIPTIONS,
  ADMIN_ACTIONS,
  AdminPermissionsResponseSchema,
  PLATFORM_ROLE_ACTIONS,
  PLATFORM_ROLES,
  UpdateAdminPermissionsRequestSchema,
  isGrantableAdminAction,
  type AdminPermissionChange,
  type AdminPermissionsResponse,
  type AdminAction,
  type PlatformRole,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { AuditService } from "../audit/audit.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { assertAdminAction } from "./admin-access.js";
import { uuidV7FromString } from "./admin-ids.js";

const PLATFORM_PERMISSIONS_TARGET_ID = uuidV7FromString("platform-permissions");

interface StoredOverride {
  role: string;
  action: string;
  granted: boolean;
}

/**
 * Merge the code-owned matrix with the stored diff.
 *
 * The code matrix always wins as the default: a database row can only flip one
 * (role, action) pair, and unknown/stale actions are dropped instead of leaking
 * into authorization decisions.
 */
export function mergePermissionMatrix(
  overrides: readonly StoredOverride[],
): AdminPermissionsResponse {
  const grantedActions = new Map<PlatformRole, Set<string>>(
    PLATFORM_ROLES.map((role) => [role, new Set<string>(PLATFORM_ROLE_ACTIONS[role])]),
  );

  for (const override of overrides) {
    if (!PLATFORM_ROLES.includes(override.role as PlatformRole)) {
      continue;
    }
    if (!ADMIN_ACTIONS.includes(override.action as AdminAction)) {
      continue;
    }
    const actions = grantedActions.get(override.role as PlatformRole);
    if (!actions) {
      continue;
    }
    if (override.granted) {
      actions.add(override.action);
    } else {
      actions.delete(override.action);
    }
  }

  return AdminPermissionsResponseSchema.parse({
    roles: PLATFORM_ROLES.map((role) => ({
      role,
      actions: ADMIN_ACTIONS.filter((action) => grantedActions.get(role)?.has(action)),
    })),
    actions: ADMIN_ACTIONS.map((action) => ({
      action,
      description: ADMIN_ACTION_DESCRIPTIONS[action],
      grantable: isGrantableAdminAction(action),
    })),
  });
}

@Injectable()
export class AdminPermissionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async get(actor: AuthenticatedActor): Promise<AdminPermissionsResponse> {
    assertAdminAction(actor, "admin:permissions:read");
    return this.read();
  }

  async update(actor: AuthenticatedActor, rawBody: unknown): Promise<AdminPermissionsResponse> {
    assertAdminAction(actor, "admin:permissions:write");
    const body = parseRequest(UpdateAdminPermissionsRequestSchema, rawBody);

    for (const change of body.changes) {
      if (!isGrantableAdminAction(change.action)) {
        throw new UnprocessableEntityException({
          code: "PERMISSION_NOT_GRANTABLE",
          message: "This action is security-sensitive and cannot be granted through the UI.",
          action: change.action,
        });
      }
    }

    // Last write wins for duplicated pairs so a client retry cannot apply two
    // conflicting decisions in one request.
    const changes = new Map<string, AdminPermissionChange>();
    for (const change of body.changes) {
      changes.set(`${change.role}:${change.action}`, change);
    }
    const applied = [...changes.values()];

    await this.prisma.client.$transaction(async (transaction) => {
      for (const change of applied) {
        const codeGranted = PLATFORM_ROLE_ACTIONS[change.role].includes(change.action);
        if (codeGranted === change.granted) {
          // Code already answers this pair: storing a row would be a redundant
          // copy, so drop any previous diff and fall back to the compiled matrix.
          await transaction.platformRoleOverride.deleteMany({
            where: { role: change.role, action: change.action },
          });
          continue;
        }
        await transaction.platformRoleOverride.upsert({
          where: { role_action: { role: change.role, action: change.action } },
          create: {
            role: change.role,
            action: change.action,
            granted: change.granted,
            updatedById: actor.user.id,
          },
          update: {
            granted: change.granted,
            updatedById: actor.user.id,
          },
        });
      }

      await this.audit.record(
        {
          actorId: actor.user.id,
          actorType: "admin",
          action: "admin.permissions.updated",
          targetType: "platform",
          targetId: PLATFORM_PERMISSIONS_TARGET_ID,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
          metadata: {
            changedActions: applied.map(
              (change) => `${change.role}:${change.action}:${String(change.granted)}`,
            ),
            changeCount: applied.length,
          },
        },
        transaction,
      );
    });

    return this.read();
  }

  private async read(): Promise<AdminPermissionsResponse> {
    const overrides = await this.prisma.client.platformRoleOverride.findMany({
      select: { role: true, action: true, granted: true },
    });
    return mergePermissionMatrix(overrides);
  }
}