import { can, type ResourceKind, type WorkspaceAction, type WorkspaceRole } from "@roamlog/contracts";

/**
 * Capability matrix for the trip workspace.
 *
 * The source of truth is `packages/contracts/src/permissions.ts` — the same
 * `can(role, action, resource)` table the API's `RequirePermission` guard uses.
 * Nothing here invents a rule: every flag below is a literal pair from that
 * table, so the UI hides/blocks exactly what the server would answer `403` for.
 */
export interface TripCapabilities {
  readStops: boolean;
  createStop: boolean;
  updateStop: boolean;
  deleteStop: boolean;
  readEntries: boolean;
  createEntry: boolean;
  readComments: boolean;
  createComment: boolean;
  readMedia: boolean;
  presignMedia: boolean;
  deleteMedia: boolean;
  setCover: boolean;
  readExpenses: boolean;
  createExpense: boolean;
  updateExpense: boolean;
  deleteExpense: boolean;
  readBudget: boolean;
  readPacking: boolean;
  createPacking: boolean;
  updatePacking: boolean;
  deletePacking: boolean;
  readShareLinks: boolean;
  createShareLink: boolean;
  revokeShareLink: boolean;
  readParticipants: boolean;
  addParticipant: boolean;
  removeParticipant: boolean;
  readActivity: boolean;
  updateTrip: boolean;
  deleteTrip: boolean;
  duplicateTrip: boolean;
}

const NO_CAPABILITIES: TripCapabilities = {
  readStops: false,
  createStop: false,
  updateStop: false,
  deleteStop: false,
  readEntries: false,
  createEntry: false,
  readComments: false,
  createComment: false,
  readMedia: false,
  presignMedia: false,
  deleteMedia: false,
  setCover: false,
  readExpenses: false,
  createExpense: false,
  updateExpense: false,
  deleteExpense: false,
  readBudget: false,
  readPacking: false,
  createPacking: false,
  updatePacking: false,
  deletePacking: false,
  readShareLinks: false,
  createShareLink: false,
  revokeShareLink: false,
  readParticipants: false,
  addParticipant: false,
  removeParticipant: false,
  readActivity: false,
  updateTrip: false,
  deleteTrip: false,
  duplicateTrip: false,
};

export function tripCapabilities(role: WorkspaceRole | string | undefined | null): TripCapabilities {
  if (!role) return NO_CAPABILITIES;

  const allow = (action: WorkspaceAction, resource: ResourceKind): boolean =>
    can(role, action, resource);

  return {
    readStops: allow("stop:read", "stop"),
    createStop: allow("stop:create", "stop"),
    updateStop: allow("stop:update", "stop"),
    deleteStop: allow("stop:delete", "stop"),
    readEntries: allow("entry:read", "trip"),
    createEntry: allow("entry:create", "journal_entry"),
    readComments: allow("comment:read", "trip"),
    createComment: allow("comment:create", "trip"),
    readMedia: allow("media:read", "media"),
    presignMedia: allow("media:presign", "media"),
    deleteMedia: allow("media:delete", "media"),
    setCover: allow("trip:set-cover", "trip"),
    readExpenses: allow("expense:read", "expense"),
    createExpense: allow("expense:create", "expense"),
    updateExpense: allow("expense:update", "expense"),
    deleteExpense: allow("expense:delete", "expense"),
    readBudget: allow("budget:read", "budget"),
    readPacking: allow("packing:read", "packing"),
    createPacking: allow("packing:create", "packing"),
    updatePacking: allow("packing:update", "packing"),
    deletePacking: allow("packing:delete", "packing"),
    readShareLinks: allow("share-link:read", "share_link"),
    createShareLink: allow("share-link:create", "share_link"),
    revokeShareLink: allow("share-link:revoke", "share_link"),
    readParticipants: allow("participant:read", "participant"),
    addParticipant: allow("participant:add", "participant"),
    removeParticipant: allow("participant:remove", "participant"),
    readActivity: allow("activity:read", "trip"),
    updateTrip: allow("trip:update", "trip"),
    deleteTrip: allow("trip:delete", "trip"),
    duplicateTrip: allow("trip:duplicate", "trip"),
  };
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export function roleLabel(role: WorkspaceRole | string | undefined): string {
  if (role === "owner" || role === "admin" || role === "editor" || role === "viewer") {
    return ROLE_LABELS[role];
  }
  return "未知角色";
}

/**
 * `title` text for a disabled control. The requirement is that a blocked
 * action explains itself instead of silently doing nothing.
 */
export function deniedReason(role: WorkspaceRole | string | undefined, action: string): string {
  if (role === "viewer") {
    return `Viewer 只能阅读和评论，不能${action}`;
  }
  if (!role) {
    return `当前账号没有工作区角色，不能${action}`;
  }
  return `${roleLabel(role)} 角色不能${action}`;
}