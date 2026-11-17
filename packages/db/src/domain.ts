export interface WorkspaceScope {
  workspaceId: string;
}

export interface TripScope extends WorkspaceScope {
  tripId: string;
}

export function workspaceScope(workspaceId: string): WorkspaceScope {
  return { workspaceId };
}

export function tripScope(
  workspaceId: string,
  tripId: string,
): TripScope {
  return { workspaceId, tripId };
}

export function activeMemberWhere(workspaceId: string, userId: string) {
  return {
    workspaceId,
    userId,
    status: "active" as const,
  };
}

export function visibleTripWhere(workspaceId: string, userId: string) {
  return {
    workspaceId,
    deletedAt: null,
    OR: [
      { visibility: "workspace" as const },
      { createdById: userId, visibility: "private" as const },
      {
        visibility: "private" as const,
        workspace: {
          members: {
            some: {
              userId,
              status: "active" as const,
              role: { in: ["owner" as const, "admin" as const] },
            },
          },
        },
      },
    ],
  };
}

export const domainSelectors = {
  workspaceScope,
  tripScope,
  activeMemberWhere,
  visibleTripWhere,
} as const;
