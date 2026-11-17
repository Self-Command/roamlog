import { Inject, Injectable } from "@nestjs/common";
import { InvitationListQuerySchema, type InvitationPage } from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import { WorkspaceAccessService } from "../../common/services/workspace-access.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { INVITATION_CLOCK, defaultInvitationClock } from "./invitation-clock.js";
import { invitationSelect } from "./invitation-records.js";
import { presentInvitation } from "../workspaces/workspace-presenter.js";

@Injectable()
export class InvitationQueryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceAccessService) private readonly access: WorkspaceAccessService,
    @Inject(PermissionService)
    private readonly permissions: PermissionService = new PermissionService(),
    @Inject(INVITATION_CLOCK)
    private readonly now: () => Date = defaultInvitationClock,
  ) {}

  async list(
    actor: AuthenticatedActor,
    workspaceId: string,
    rawQuery: unknown,
  ): Promise<InvitationPage> {
    const membership = await this.access.requireMembership(actor.user.id, workspaceId);
    this.permissions.assertCan(membership.role, "invitation:read", "invitation");
    const query = parseRequest(InvitationListQuerySchema, rawQuery);
    const cursor = cursorId(query.cursor);
    const currentTime = this.now();

    const statusWhere =
      query.status === "accepted"
        ? { acceptedAt: { not: null } }
        : query.status === "revoked"
          ? { revokedAt: { not: null } }
          : query.status === "expired"
            ? { acceptedAt: null, revokedAt: null, expiresAt: { lte: currentTime } }
            : query.status === "pending"
              ? { acceptedAt: null, revokedAt: null, expiresAt: { gt: currentTime } }
              : {};
    const direction: "asc" | "desc" = query.sort?.split(":")[1] === "asc" ? "asc" : "desc";
    const orderBy: { expiresAt: "asc" | "desc" } | { createdAt: "asc" | "desc" } =
      query.sort?.startsWith("expiresAt") ? { expiresAt: direction } : { createdAt: direction };

    const records = await this.prisma.client.invitation.findMany({
      where: {
        workspaceId,
        ...statusWhere,
      },
      select: invitationSelect,
      orderBy: [orderBy, { id: "asc" }],
      take: query.limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    return toCursorPage(records, query.limit, (record) =>
      presentInvitation(record),
    ) as InvitationPage;
  }
}
