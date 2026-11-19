/**
 * The single trip-access rule, shared by the API and the worker.
 *
 * Before 0012 the answer to "may this person read this trip?" was written in
 * four drifting places: `content-values.ts::assertTripVisible` (a function,
 * shared by most modules), `media.service.ts::visibilityFilter` (an independent
 * Prisma `where`), the trip list filter in `trips.service.ts`, and the AI tool
 * argument enum. Each disagreed about private trips, participants, workspace
 * owners and eventually `custom`. This module is the one implementation the
 * read paths are meant to share:
 *
 *   - `explainTripAccess` / `resolveTripAccess`: in-memory decision for a
 *     single trip whose grants and participant row are already loaded.
 *   - `tripVisibilityWhere`: the same decision expressed as a Prisma `where`
 *     fragment for list queries, where calling a function per row is not an
 *     option.
 *
 * It lives in `@roamlog/db` rather than `apps/api` so the BullMQ worker
 * (`apps/worker/src/jobs/{export,reminders}.ts`) can import the *same*
 * predicate. Importing `apps/api` from the worker is not possible: the worker
 * build pins `rootDir: "src"`, so a cross-app relative import would fail
 * `tsc -p apps/worker/tsconfig.build.json`. `apps/api/src/modules/trips/
 * trip-access.ts` re-exports this module, so the API call sites and the
 * `visibility-parity` spec keep their original import paths.
 *
 * Both halves are pinned against each other by
 * `apps/api/src/modules/trips/__tests__/visibility-parity.spec.ts`, which
 * evaluates them over the same fixtures on a real PostgreSQL schema. Changing
 * either side without the other turns that test red.
 *
 * ## Order *is* the semantics
 *
 * Steps are evaluated in this order and the first match wins. The order is
 * observable through `explainTripAccess().reason`, so a test can prove which
 * branch answered instead of only that the result was `true`:
 *
 *   1. platform override  — `platformRole === "super_admin"`
 *   2. creator            — `trip.createdById === actor.userId`
 *   3. workspace member   — trip belongs to the actor's workspace *and* uses a
 *                           workspace-scoped tier (`workspace`, `public_link`)
 *   4. participant        — an `invited` or `joined` participant row
 *   5. explicit grant     — `custom` visibility and a matching user/workspace
 *                           grant
 *   6. deny
 *
 * Workspace-level grants only look at `actor.workspaceId`. That is deliberate
 * and is the reason the rule needs no "is the actor a member of the granted
 * workspace?" check: every caller resolves the actor's workspace through
 * `WorkspaceAccessService.requireMembership`, so `actor.workspaceId` is a
 * workspace the actor is an active member of. A grant can therefore never be
 * matched on a workspace the actor merely guessed — the id comes from their own
 * membership row, not from the request.
 */

/** Participant states that grant read access. A `declined` invitee has none. */
export const PARTICIPANT_ACCESS_STATUSES = ["invited", "joined"] as const;

/**
 * Visibility tiers that are readable by every member of the owning workspace.
 *
 * `public_link` is in this list on purpose. It is the anonymous share-link tier
 * — strictly *more* open than `workspace` — so hiding it from the workspace's
 * own members would mean a member sees the trip in the list (`trips.service`
 * lists `workspace` and `public_link` alike) and then gets a 404 on the detail
 * page. The pre-0012 function and the pre-0012 media filter both treated
 * `public_link` as workspace-readable, and 0012 does not change the share-link
 * payload (design §7: sharing is untouched). Only `private` narrows below the
 * workspace, and only `custom` replaces "the workspace" with an explicit list.
 */
export const WORKSPACE_SHARED_VISIBILITIES = ["workspace", "public_link"] as const;

export type TripAccessReason =
  | "creator"
  | "workspace_member"
  | "participant"
  | "grant_user"
  | "grant_workspace"
  | "platform_override"
  | "visibility_private"
  | "no_grant";

export interface TripAccessActor {
  userId: string;
  /** The workspace the request is scoped to; always one the actor is a member of. */
  workspaceId: string;
  platformRole: string;
}

export interface TripAccessInput {
  actor: TripAccessActor;
  trip: {
    id: string;
    workspaceId: string;
    createdById: string;
    visibility: string;
  };
  /** The actor's own participant row for this trip, or `null` when it has none. */
  participation: { status: string } | null;
  grants: ReadonlyArray<{ workspaceId: string | null; userId: string | null }>;
}

export interface TripAccessExplanation {
  allowed: boolean;
  reason: TripAccessReason;
}

function hasStatus<T extends string>(
  allowed: readonly T[],
  value: string,
): value is T {
  return (allowed as readonly string[]).includes(value);
}

/**
 * The decision plus the branch that produced it.
 *
 * `reason` exists for tests and logs. It is not an authorization token: the only
 * thing callers may act on is `allowed`.
 */
export function explainTripAccess(input: TripAccessInput): TripAccessExplanation {
  const { actor, trip, participation, grants } = input;

  // 1. Platform staff keep their break-glass read (the audit trail is written by
  //    the caller, not here).
  if (actor.platformRole === "super_admin") {
    return { allowed: true, reason: "platform_override" };
  }

  // 2. The creator always reads their own trip, whatever its tier.
  if (trip.createdById === actor.userId) {
    return { allowed: true, reason: "creator" };
  }

  // 3. Workspace-scoped tiers are readable by any member of the owning
  //    workspace. Note what is *not* here: a workspace `owner`/`admin` does not
  //    get a blanket read on `private` trips. That bypass existed in the old
  //    two implementations and is intentionally dropped — `private` means the
  //    creator (plus invited participants), for admins too.
  if (
    trip.workspaceId === actor.workspaceId &&
    hasStatus(WORKSPACE_SHARED_VISIBILITIES, trip.visibility)
  ) {
    return { allowed: true, reason: "workspace_member" };
  }

  // 4. Being invited is access: an `invited` or `joined` participant row grants
  //    read access independently of the visibility tier (design §3 step 4), so a
  //    participant of a `private` trip still gets in.
  if (participation !== null && hasStatus(PARTICIPANT_ACCESS_STATUSES, participation.status)) {
    return { allowed: true, reason: "participant" };
  }

  // 5. Grants are only consulted for `custom`. A user grant recorded on a
  //    `private` trip must not widen it: `private` is creator-only and the
  //    grant row would otherwise silently become a back door. The SQL half
  //    carries the same `visibility: "custom"` guard on both clauses.
  if (trip.visibility === "custom") {
    if (grants.some((grant) => grant.userId === actor.userId)) {
      return { allowed: true, reason: "grant_user" };
    }
    if (grants.some((grant) => grant.workspaceId === actor.workspaceId)) {
      return { allowed: true, reason: "grant_workspace" };
    }
  }

  // 6. Deny. `visibility_private` is the informative case: the trip exists, the
  //    caller may even see it in a list, and the tier is what keeps them out.
  return {
    allowed: false,
    reason: trip.visibility === "private" ? "visibility_private" : "no_grant",
  };
}

/** Convenience wrapper for call sites that only need the boolean. */
export function resolveTripAccess(input: TripAccessInput): boolean {
  return explainTripAccess(input).allowed;
}

/**
 * The same rule as {@link resolveTripAccess}, expressed as a Prisma `where`
 * fragment over `Trip`.
 *
 * Use it for list surfaces (`Trip.findMany`, or a relation filter such as
 * `{ trip: tripVisibilityWhere(actor) }` for media/entries) where loading each
 * trip's grants would be an N+1. It returns `{}` for an `super_admin`, so the
 * caller's own tenancy scope stays in charge of which workspaces are searched.
 *
 * Every clause corresponds to one step of `explainTripAccess`:
 *
 *   creator              -> `{ createdById }`
 *   workspace_member      -> `{ workspaceId, visibility: { in: workspace tiers } }`
 *   participant           -> `{ participants: { some: { userId, status in } } }`
 *   grant_user            -> `{ visibility: "custom", accessGrants: { some: { userId } } }`
 *   grant_workspace       -> `{ visibility: "custom", accessGrants: { some: { workspaceId } } }`
 *
 * `visibility: "custom"` is on **both** grant clauses, matching step 5's
 * nesting. A `private` trip with a leftover user grant therefore stays hidden
 * from that user in both implementations.
 */
export function tripVisibilityWhere(actor: TripAccessActor): Record<string, unknown> {
  if (actor.platformRole === "super_admin") {
    return {};
  }

  return {
    OR: [
      { createdById: actor.userId },
      {
        workspaceId: actor.workspaceId,
        visibility: { in: [...WORKSPACE_SHARED_VISIBILITIES] },
      },
      {
        participants: {
          some: {
            userId: actor.userId,
            status: { in: [...PARTICIPANT_ACCESS_STATUSES] },
          },
        },
      },
      {
        visibility: "custom",
        accessGrants: { some: { userId: actor.userId } },
      },
      {
        visibility: "custom",
        accessGrants: { some: { workspaceId: actor.workspaceId } },
      },
    ],
  };
}
