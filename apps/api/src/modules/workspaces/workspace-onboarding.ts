import { WorkspaceSettingsSchema, type Workspace } from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import type { AuditService } from "../audit/audit.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { presentWorkspace } from "./workspace-presenter.js";
import {
  assertVerifiedEmail,
  isUniqueConstraintError,
  workspaceSelect,
} from "./workspace-records.js";

export interface OnboardingDependencies {
  prisma: PrismaService;
  audit: AuditService;
}

export async function ensureDefaultWorkspace(
  dependencies: OnboardingDependencies,
  actor: AuthenticatedActor,
): Promise<Workspace | null> {
  assertVerifiedEmail(actor);
  const { prisma, audit } = dependencies;
  const existing = await prisma.client.workspace.findFirst({
    where: { ownerId: actor.user.id },
    select: { id: true },
  });
  if (existing) {
    return null;
  }

  const settings = WorkspaceSettingsSchema.parse({});
  const slug = `travel-archive-${actor.user.id.replaceAll("-", "").slice(-12)}`;

  try {
    return await prisma.client.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`onboarding:${actor.user.id}`}))
      `;
      const raced = await transaction.workspace.findFirst({
        where: { ownerId: actor.user.id },
        select: { id: true },
      });
      if (raced) {
        return null;
      }

      const workspace = await transaction.workspace.create({
        data: {
          name: `${actor.user.name} 的旅行档案`,
          slug,
          ownerId: actor.user.id,
          defaultCurrency: "CNY",
          timezone: actor.user.timezone,
          weekStartsOn: 1,
          settings,
        },
        select: workspaceSelect,
      });
      await transaction.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: actor.user.id,
          role: "owner",
          status: "active",
        },
      });
      await audit.record(
        {
          actorId: actor.user.id,
          actorType: "user",
          action: "workspace.onboarded",
          targetType: "workspace",
          targetId: workspace.id,
          workspaceId: workspace.id,
          ip: actor.ip ?? undefined,
          userAgent: actor.userAgent ?? undefined,
        },
        transaction,
      );
      return presentWorkspace(workspace);
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return null;
    }
    throw error;
  }
}
