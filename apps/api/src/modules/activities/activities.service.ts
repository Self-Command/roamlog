import { Inject, Injectable } from "@nestjs/common";
import {
  TripActivityQuerySchema,
  WorkspaceActivityQuerySchema,
  type TripActivityPage,
  type WorkspaceActivityPage,
} from "@roamlog/contracts";

import type { AuthenticatedActor } from "../../common/guards/actor-context.js";
import { cursorId, toCursorPage } from "../../common/services/cursor-page.js";
import { PermissionService } from "../../common/services/permission.service.js";
import { parseRequest } from "../../common/services/request-validation.js";
import type { WorkspaceMembershipAccess } from "../../common/services/workspace-access.service.js";
import { assertTripVisible, sortParts } from "../trips/content-values.js";
import { presentActivity } from "../trips/content-presenters.js";
import type { ContentTransaction } from "../trips/content-transaction.js";
import {
  ActivitiesRepository,
  type ActivityRecordInput,
} from "./activities.repository.js";

interface ActivityTripContext {
  id: string;
  workspaceId: string;
  visibility: string;
  createdById: string;
}

@Injectable()
export class ActivitiesService {
  constructor(
    @Inject(ActivitiesRepository) private readonly repository: ActivitiesRepository,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  async record(
    tx: ContentTransaction,
    input: ActivityRecordInput,
  ): Promise<{ id: string }> {
    const activity = await this.repository.record(tx, input);
    return { id: activity.id };
  }

  async listWorkspace(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    rawQuery: unknown,
  ): Promise<WorkspaceActivityPage> {
    this.permissions.assertCan(membership.role, "activity:read", "activity");
    const query = parseRequest(WorkspaceActivityQuerySchema, rawQuery);
    const { direction } = sortParts(query.sort, ["createdAt"], "createdAt");
    const records = await this.repository.findWorkspaceActivities({
      workspaceId: membership.workspaceId,
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.from ? { from: new Date(`${query.from}T00:00:00.000Z`) } : {}),
      ...(query.to ? { to: new Date(`${query.to}T23:59:59.999Z`) } : {}),
      ...(cursorId(query.cursor) ? { cursor: cursorId(query.cursor) } : {}),
      take: query.limit + 1,
      direction,
    });
    return toCursorPage(records, query.limit, presentActivity) as WorkspaceActivityPage;
  }

  async listTrip(
    _actor: AuthenticatedActor,
    membership: WorkspaceMembershipAccess,
    trip: ActivityTripContext,
    rawQuery: unknown,
  ): Promise<TripActivityPage> {
    this.permissions.assertCan(membership.role, "activity:read", "trip");
    assertTripVisible(membership, trip);
    const query = parseRequest(TripActivityQuerySchema, rawQuery);
    const { direction } = sortParts(query.sort, ["createdAt"], "createdAt");
    const records = await this.repository.findTripActivities({
      workspaceId: membership.workspaceId,
      tripId: trip.id,
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(cursorId(query.cursor) ? { cursor: cursorId(query.cursor) } : {}),
      take: query.limit + 1,
      direction,
    });
    return toCursorPage(records, query.limit, presentActivity) as TripActivityPage;
  }
}
