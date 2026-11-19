import { z } from "zod";

export const WORKSPACE_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export const WorkspaceRoleSchema = z.enum(WORKSPACE_ROLES);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const PLATFORM_ROLES = ["user", "support", "analyst", "admin", "super_admin"] as const;
export const PlatformRoleSchema = z.enum(PLATFORM_ROLES);
export type PlatformRole = z.infer<typeof PlatformRoleSchema>;

export const WORKSPACE_ACTIONS = [
  "me:read",
  "me:update",
  "me:delete",
  "me:export",
  "session:read",
  "session:revoke",
  "notification:read",
  "notification:read-all",
  "notification-preference:read",
  "notification-preference:update",
  "realtime:connect",
  "workspace:read",
  "workspace:create",
  "workspace:update",
  "workspace:delete",
  "workspace:transfer-ownership",
  "workspace:view-audit",
  "workspace:view-activity",
  "member:read",
  "member:update-role",
  "member:suspend",
  "member:remove",
  "member:leave",
  "member:manage-admin",
  "member:remove-admin",
  "member:update-owner",
  "member:remove-owner",
  "member:grant-owner",
  "invitation:read",
  "invitation:create",
  "invitation:create-admin",
  "invitation:revoke",
  "invitation:accept",
  "trip:read",
  "trip:create",
  "trip:update",
  "trip:delete",
  "trip:duplicate",
  "trip:set-cover",
  "participant:read",
  "participant:add",
  "participant:remove",
  "stop:read",
  "stop:create",
  "stop:update",
  "stop:delete",
  "stop:reorder",
  "itinerary:read",
  "itinerary:create",
  "itinerary:update",
  "itinerary:delete",
  "itinerary:reorder",
  "entry:read",
  "entry:create",
  "entry:update",
  "entry:delete",
  "entry:favorite",
  "revision:read",
  "revision:restore",
  "comment:read",
  "comment:create",
  "comment:update",
  "comment:delete",
  "comment:resolve",
  "comment:unresolve",
  "mention:read",
  "mention:create",
  "media:read",
  "media:presign",
  "media:complete",
  "media:update",
  "media:delete",
  "expense:read",
  "expense:create",
  "expense:update",
  "expense:delete",
  "budget:read",
  "budget:settle-up",
  "packing:read",
  "packing:create",
  "packing:update",
  "packing:delete",
  "packing:reorder",
  "packing:bulk",
  "share-link:read",
  "share-link:create",
  "share-link:revoke",
  "export:create",
  "export:read",
  "export:delete",
  "search:read",
  "activity:read",
] as const;
export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];

export const RESOURCE_KINDS = [
  "account",
  "session",
  "notification",
  "workspace",
  "member",
  "invitation",
  "trip",
  "participant",
  "stop",
  "itinerary",
  "itinerary_item",
  "journal_entry",
  "revision",
  "comment",
  "mention",
  "media",
  "expense",
  "budget",
  "packing",
  "packing_item",
  "share_link",
  "export",
  "search",
  "activity",
  "audit",
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

const workspaceActionSet = new Set<string>(WORKSPACE_ACTIONS);
const resourceKindSet = new Set<string>(RESOURCE_KINDS);

function resources(...values: ResourceKind[]): ReadonlySet<ResourceKind> {
  return new Set(values);
}

const ACTION_RESOURCES: Record<WorkspaceAction, ReadonlySet<ResourceKind>> = {
  "me:read": resources("account"),
  "me:update": resources("account"),
  "me:delete": resources("account"),
  "me:export": resources("account"),
  "session:read": resources("account", "session"),
  "session:revoke": resources("account", "session"),
  "notification:read": resources("account", "notification"),
  "notification:read-all": resources("account", "notification"),
  "notification-preference:read": resources("account", "notification"),
  "notification-preference:update": resources("account", "notification"),
  "realtime:connect": resources("account", "workspace"),
  "workspace:read": resources("workspace"),
  "workspace:create": resources("workspace", "account"),
  "workspace:update": resources("workspace"),
  "workspace:delete": resources("workspace"),
  "workspace:transfer-ownership": resources("workspace"),
  "workspace:view-audit": resources("workspace", "audit"),
  "workspace:view-activity": resources("workspace", "activity"),
  "member:read": resources("member", "workspace"),
  "member:update-role": resources("member"),
  "member:suspend": resources("member"),
  "member:remove": resources("member"),
  "member:leave": resources("member", "workspace"),
  "member:manage-admin": resources("member"),
  "member:remove-admin": resources("member"),
  "member:update-owner": resources("member"),
  "member:remove-owner": resources("member"),
  "member:grant-owner": resources("member"),
  "invitation:read": resources("invitation", "workspace"),
  "invitation:create": resources("invitation", "workspace"),
  "invitation:create-admin": resources("invitation", "workspace"),
  "invitation:revoke": resources("invitation", "workspace"),
  "invitation:accept": resources("invitation", "account"),
  "trip:read": resources("trip"),
  "trip:create": resources("trip"),
  "trip:update": resources("trip"),
  "trip:delete": resources("trip"),
  "trip:duplicate": resources("trip"),
  "trip:set-cover": resources("trip", "media"),
  "participant:read": resources("participant", "trip"),
  "participant:add": resources("participant", "trip"),
  "participant:remove": resources("participant", "trip"),
  "stop:read": resources("stop", "trip"),
  "stop:create": resources("stop", "trip"),
  "stop:update": resources("stop", "trip"),
  "stop:delete": resources("stop", "trip"),
  "stop:reorder": resources("stop", "trip"),
  "itinerary:read": resources("itinerary", "trip"),
  "itinerary:create": resources("itinerary", "trip"),
  "itinerary:update": resources("itinerary", "trip"),
  "itinerary:delete": resources("itinerary", "trip"),
  "itinerary:reorder": resources("itinerary", "trip"),
  "entry:read": resources("journal_entry", "trip", "workspace"),
  "entry:create": resources("journal_entry", "trip"),
  "entry:update": resources("journal_entry", "trip"),
  "entry:delete": resources("journal_entry", "trip"),
  "entry:favorite": resources("journal_entry", "trip"),
  "revision:read": resources("revision", "journal_entry"),
  "revision:restore": resources("revision", "journal_entry"),
  "comment:read": resources("comment", "trip", "journal_entry", "itinerary_item"),
  "comment:create": resources("comment", "trip", "journal_entry", "itinerary_item"),
  "comment:update": resources("comment"),
  "comment:delete": resources("comment"),
  "comment:resolve": resources("comment", "trip", "journal_entry", "itinerary_item"),
  "comment:unresolve": resources("comment", "trip", "journal_entry", "itinerary_item"),
  "mention:read": resources("mention", "comment"),
  "mention:create": resources("mention", "comment", "trip"),
  "media:read": resources("media", "trip", "workspace"),
  "media:presign": resources("media", "trip", "workspace"),
  "media:complete": resources("media", "trip", "workspace"),
  "media:update": resources("media"),
  "media:delete": resources("media"),
  "expense:read": resources("expense", "trip"),
  "expense:create": resources("expense", "trip"),
  "expense:update": resources("expense", "trip"),
  "expense:delete": resources("expense", "trip"),
  "budget:read": resources("budget", "trip"),
  "budget:settle-up": resources("budget", "trip"),
  "packing:read": resources("packing", "packing_item", "trip"),
  "packing:create": resources("packing", "packing_item", "trip"),
  "packing:update": resources("packing", "packing_item", "trip"),
  "packing:delete": resources("packing", "packing_item", "trip"),
  "packing:reorder": resources("packing", "packing_item", "trip"),
  "packing:bulk": resources("packing", "packing_item", "trip"),
  "share-link:read": resources("share_link", "trip"),
  "share-link:create": resources("share_link", "trip"),
  "share-link:revoke": resources("share_link", "trip"),
  "export:create": resources("export", "account", "workspace", "trip"),
  "export:read": resources("export", "account", "workspace", "trip"),
  "export:delete": resources("export", "account", "workspace", "trip"),
  "search:read": resources("search", "workspace"),
  "activity:read": resources("activity", "workspace", "trip"),
};

const readOnlyActions: WorkspaceAction[] = [
  "me:read",
  "session:read",
  "notification:read",
  "notification-preference:read",
  "realtime:connect",
  "workspace:read",
  "workspace:create",
  "workspace:view-activity",
  "member:read",
  "invitation:accept",
  "trip:read",
  "participant:read",
  "stop:read",
  "itinerary:read",
  "entry:read",
  "revision:read",
  "comment:read",
  "mention:read",
  "media:read",
  "expense:read",
  "budget:read",
  "budget:settle-up",
  "packing:read",
  "export:create",
  "export:read",
  "export:delete",
  "search:read",
  "activity:read",
];

const commentActions: WorkspaceAction[] = [
  "comment:create",
  "comment:update",
  "comment:delete",
  "comment:resolve",
  "comment:unresolve",
  "mention:create",
];

const personalWriteActions: WorkspaceAction[] = [
  "me:update",
  "me:delete",
  "me:export",
  "session:revoke",
  "notification:read",
  "notification:read-all",
  "notification-preference:read",
  "notification-preference:update",
];

const contentWriteActions: WorkspaceAction[] = [
  "trip:create",
  "trip:update",
  "trip:delete",
  "trip:duplicate",
  "trip:set-cover",
  "participant:add",
  "participant:remove",
  "stop:create",
  "stop:update",
  "stop:delete",
  "stop:reorder",
  "itinerary:create",
  "itinerary:update",
  "itinerary:delete",
  "itinerary:reorder",
  "entry:create",
  "entry:update",
  "entry:delete",
  "entry:favorite",
  "revision:restore",
  "media:presign",
  "media:complete",
  "media:update",
  "media:delete",
  "expense:create",
  "expense:update",
  "expense:delete",
  "packing:create",
  "packing:update",
  "packing:delete",
  "packing:reorder",
  "packing:bulk",
  "share-link:read",
  "share-link:create",
  "share-link:revoke",
];

const administrationActions: WorkspaceAction[] = [
  "workspace:update",
  "workspace:view-audit",
  "member:update-role",
  "member:suspend",
  "member:remove",
  "invitation:read",
  "invitation:create",
  "invitation:revoke",
];

const ownerActions: WorkspaceAction[] = [
  "workspace:delete",
  "workspace:transfer-ownership",
  "member:manage-admin",
  "member:remove-admin",
  "invitation:create-admin",
];

const workspaceRoleActions: Record<WorkspaceRole, ReadonlySet<WorkspaceAction>> = {
  viewer: new Set([...readOnlyActions, ...commentActions]),
  editor: new Set([
    ...readOnlyActions,
    ...commentActions,
    ...personalWriteActions,
    ...contentWriteActions,
  ]),
  admin: new Set([
    ...readOnlyActions,
    ...commentActions,
    ...personalWriteActions,
    ...contentWriteActions,
    ...administrationActions,
    "member:leave",
  ]),
  owner: new Set([
    ...readOnlyActions,
    ...commentActions,
    ...personalWriteActions,
    ...contentWriteActions,
    ...administrationActions,
    ...ownerActions,
  ]),
};

export function can(role: string, action: string, resource: string): boolean {
  if (!workspaceActionSet.has(action) || !resourceKindSet.has(resource)) {
    return false;
  }
  if (!WORKSPACE_ROLES.includes(role as WorkspaceRole)) {
    return false;
  }

  const knownAction = action as WorkspaceAction;
  const knownResource = resource as ResourceKind;
  return (
    ACTION_RESOURCES[knownAction].has(knownResource) &&
    workspaceRoleActions[role as WorkspaceRole].has(knownAction)
  );
}

export const ADMIN_ACTIONS = [
  "admin:metrics:read",
  "admin:users:read",
  "admin:users:suspend",
  "admin:users:restore",
  "admin:users:delete",
  "admin:users:force-logout",
  "admin:users:reset-2fa",
  "admin:users:change-role",
  "admin:workspaces:read",
  "admin:workspaces:suspend",
  "admin:workspaces:restore",
  "admin:workspaces:delete",
  "admin:content:read",
  "admin:content:delete",
  "admin:content:restore",
  "admin:media:read",
  "admin:media:delete",
  "admin:audit:read",
  "admin:audit:export",
  "admin:flags:read",
  "admin:flags:update",
  "admin:emails:read",
  "admin:emails:resend",
  "admin:jobs:read",
  "admin:jobs:retry",
  "admin:jobs:manage",
  "admin:system:read",
  "admin:settings:read",
  "admin:settings:write",
  "admin:users:update",
  "admin:permissions:read",
  "admin:permissions:write",
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

const adminActionSet = new Set<string>(ADMIN_ACTIONS);

const supportActions: AdminAction[] = [
  "admin:metrics:read",
  "admin:users:read",
  "admin:users:suspend",
  "admin:users:restore",
  "admin:users:force-logout",
  "admin:workspaces:read",
  "admin:workspaces:suspend",
  "admin:workspaces:restore",
  "admin:audit:read",
  "admin:emails:read",
  "admin:emails:resend",
  "admin:jobs:read",
];

const analystActions: AdminAction[] = [
  "admin:metrics:read",
  "admin:users:read",
  "admin:workspaces:read",
  "admin:audit:read",
  "admin:audit:export",
  "admin:emails:read",
  "admin:jobs:read",
];

const adminActions: AdminAction[] = [
  ...supportActions,
  ...analystActions,
  "admin:users:delete",
  "admin:users:reset-2fa",
  "admin:workspaces:delete",
  "admin:content:read",
  "admin:content:delete",
  "admin:content:restore",
  "admin:media:read",
  "admin:media:delete",
  "admin:flags:read",
  "admin:jobs:retry",
  "admin:system:read",
];

const platformRoleActions: Record<PlatformRole, ReadonlySet<AdminAction>> = {
  user: new Set(),
  support: new Set(supportActions),
  analyst: new Set(analystActions),
  admin: new Set(adminActions),
  super_admin: new Set(ADMIN_ACTIONS),
};

export function canPlatform(role: string, action: string): boolean {
  if (!PLATFORM_ROLES.includes(role as PlatformRole) || !adminActionSet.has(action)) {
    return false;
  }
  return platformRoleActions[role as PlatformRole].has(action as AdminAction);
}

/**
 * Code-owned role → action matrix, in stable `ADMIN_ACTIONS` order.
 *
 * This is the single source of truth the Admin permission-matrix endpoint reads;
 * database overrides are layered on top of it and never replace it. Do not copy
 * these role lists into another module: derive UI and API output from here.
 */
export const PLATFORM_ROLE_ACTIONS: Record<PlatformRole, readonly AdminAction[]> = {
  user: ADMIN_ACTIONS.filter((action) => platformRoleActions.user.has(action)),
  support: ADMIN_ACTIONS.filter((action) => platformRoleActions.support.has(action)),
  analyst: ADMIN_ACTIONS.filter((action) => platformRoleActions.analyst.has(action)),
  admin: ADMIN_ACTIONS.filter((action) => platformRoleActions.admin.has(action)),
  super_admin: ADMIN_ACTIONS.filter((action) => platformRoleActions.super_admin.has(action)),
};

/**
 * Human-readable descriptions for the permission matrix. The action list itself
 * is derived from `ADMIN_ACTIONS`; this map only adds labels.
 */
export const ADMIN_ACTION_DESCRIPTIONS: Record<AdminAction, string> = {
  "admin:metrics:read": "读取平台指标与趋势",
  "admin:users:read": "读取用户列表与详情",
  "admin:users:suspend": "暂停用户账户",
  "admin:users:restore": "恢复用户账户",
  "admin:users:delete": "软删除用户账户",
  "admin:users:force-logout": "强制撤销用户会话",
  "admin:users:reset-2fa": "重置用户双因素认证",
  "admin:users:change-role": "修改用户平台角色",
  "admin:workspaces:read": "读取工作区列表与详情",
  "admin:workspaces:suspend": "暂停工作区",
  "admin:workspaces:restore": "恢复工作区",
  "admin:workspaces:delete": "软删除工作区",
  "admin:content:read": "读取审核内容",
  "admin:content:delete": "下架内容",
  "admin:content:restore": "恢复内容",
  "admin:media:read": "读取媒体资产",
  "admin:media:delete": "删除媒体资产",
  "admin:audit:read": "读取审计日志",
  "admin:audit:export": "导出审计日志",
  "admin:flags:read": "读取功能开关",
  "admin:flags:update": "创建、修改与删除功能开关",
  "admin:emails:read": "读取邮件投递记录",
  "admin:emails:resend": "重发邮件",
  "admin:jobs:read": "读取队列任务",
  "admin:jobs:retry": "重试失败任务",
  "admin:jobs:manage": "暂停、恢复与清空队列",
  "admin:system:read": "读取系统健康状态",
  "admin:settings:read": "读取平台设置",
  "admin:settings:write": "写入平台设置",
  "admin:users:update": "编辑用户资料（姓名、邮箱、语言与时区）",
  "admin:permissions:read": "读取平台权限矩阵",
  "admin:permissions:write": "修改平台权限矩阵覆盖层",
};

/**
 * Security-sensitive actions that the permission-matrix UI must never grant.
 * The platform-only permission actions and profile-edit action stay here too, so
 * the matrix can never widen the super_admin-only surface.
 */
export const NON_GRANTABLE_ADMIN_ACTIONS: readonly string[] = [
  "admin:users:delete",
  "admin:users:change-role",
  "admin:users:reset-2fa",
  "admin:users:update",
  "admin:settings:write",
  "admin:workspaces:transfer",
  "admin:permissions:read",
  "admin:permissions:write",
];

const nonGrantableActionSet = new Set<string>(NON_GRANTABLE_ADMIN_ACTIONS);

export function isGrantableAdminAction(action: string): boolean {
  return adminActionSet.has(action) && !nonGrantableActionSet.has(action);
}

export const ADMIN_GRANTABLE_ACTIONS: readonly AdminAction[] =
  ADMIN_ACTIONS.filter(isGrantableAdminAction);
