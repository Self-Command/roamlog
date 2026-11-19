import type {
  AccountStatus,
  AuditActorType,
  EmailStatus,
  MediaStatus,
  ModerationActionKind,
  PlatformRole,
  ReportReason,
  ReportStatus,
  ReportTargetType,
  TripStatus,
  TripVisibility,
  WorkspacePlan,
  WorkspaceRole,
} from "@roamlog/contracts";

/**
 * Centralized Chinese labels for values that cross the Admin API boundary.
 * The object keys are API/database enum values and must never be translated or
 * renamed; only the display values change.
 */
export const PLATFORM_ROLE_LABELS = {
  user: "用户",
  support: "支持人员",
  analyst: "分析员",
  admin: "管理员",
  super_admin: "超级管理员",
} satisfies Record<PlatformRole, string>;

/** Roles that can enter the admin console (`AdminConsoleRole`). */
export const ADMIN_ROLE_LABELS = {
  support: PLATFORM_ROLE_LABELS.support,
  analyst: PLATFORM_ROLE_LABELS.analyst,
  admin: PLATFORM_ROLE_LABELS.admin,
  super_admin: PLATFORM_ROLE_LABELS.super_admin,
} satisfies Record<Exclude<PlatformRole, "user">, string>;

export const ACCOUNT_STATUS_LABELS = {
  active: "启用",
  suspended: "已停用",
  deleted: "已删除",
} satisfies Record<AccountStatus, string>;

export const WORKSPACE_PLAN_LABELS = {
  free: "免费版",
  pro: "专业版",
  team: "团队版",
} satisfies Record<WorkspacePlan, string>;

export const WORKSPACE_ROLE_LABELS = {
  owner: "所有者",
  admin: "管理员",
  editor: "编辑者",
  viewer: "访客",
} satisfies Record<WorkspaceRole, string>;

export const TRIP_STATUS_LABELS = {
  wishlist: "愿望",
  planning: "计划中",
  upcoming: "即将出发",
  active: "在途中",
  completed: "已归来",
} satisfies Record<TripStatus, string>;

export const TRIP_VISIBILITY_LABELS = {
  workspace: "工作区可见",
  private: "私密",
  public_link: "公开链接",
  custom: "自定义",
} satisfies Record<TripVisibility, string>;

export const WORKSPACE_DENSITY_LABELS = {
  comfortable: "舒适",
  compact: "紧凑",
} as const;

export const EMAIL_STATUS_LABELS = {
  queued: "排队中",
  sent: "已发送",
  delivered: "已送达",
  bounced: "退信",
  complained: "投诉",
  failed: "失败",
} satisfies Record<EmailStatus, string>;

export const MEDIA_STATUS_LABELS = {
  pending: "待处理",
  processing: "处理中",
  ready: "就绪",
  failed: "失败",
} satisfies Record<MediaStatus, string>;

export const REPORT_STATUS_LABELS = {
  open: "待处理",
  in_review: "处理中",
  resolved: "已裁决",
  dismissed: "已驳回",
} satisfies Record<ReportStatus, string>;

export const REPORT_TARGET_TYPE_LABELS = {
  trip: "旅行",
  entry: "日志",
  comment: "评论",
  media: "媒体",
} satisfies Record<ReportTargetType, string>;

export const REPORT_REASON_LABELS = {
  spam: "垃圾广告",
  harassment: "骚扰 / 人身攻击",
  private_info: "泄露隐私",
  illegal: "违法内容",
  other: "其他",
} satisfies Record<ReportReason, string>;

export const MODERATION_ACTION_LABELS = {
  remove: "下架内容",
  restore: "恢复内容",
  warn: "警告作者",
  dismiss: "驳回举报",
} satisfies Record<ModerationActionKind, string>;

export const AUDIT_ACTOR_TYPE_LABELS = {
  user: "用户",
  admin: "管理员",
  system: "系统",
} satisfies Record<AuditActorType, string>;

/** Audit target types are free-form strings in the contract, so unknown values stay raw. */
export const AUDIT_TARGET_TYPE_LABELS = {
  user: "用户",
  workspace: "工作区",
  workspace_invitation: "工作区邀请",
  trip: "旅行",
  entry: "日志",
  comment: "评论",
  media: "媒体",
  feature_flag: "功能开关",
  email_log: "邮件日志",
  setting: "设置",
  queue: "队列",
  job: "任务",
} as const;

export function auditTargetTypeLabel(value: string): string {
  return AUDIT_TARGET_TYPE_LABELS[value as keyof typeof AUDIT_TARGET_TYPE_LABELS] ?? value;
}

export const HEALTH_STATUS_LABELS = {
  up: "正常",
  degraded: "降级",
  down: "不可用",
} as const;

export const WORKER_STATUS_LABELS = {
  up: "健康",
  degraded: "降级",
  down: "不可用",
} as const;

export const QUEUE_STATE_LABELS = {
  paused: "已暂停",
  needs_review: "需复核",
  processing: "处理中",
  backlog: "待处理",
  idle: "空闲",
} as const;

export const MIGRATION_STATUS_LABELS = {
  applied: "已应用",
  pending: "待应用",
} as const;

export const INVITATION_STATUS_LABELS = {
  accepted: "已接受",
  revoked: "已撤销",
  pending: "待处理",
} as const;

export const EMAIL_VERIFICATION_STATUS_LABELS = {
  verified: "已验证",
  pending: "待验证",
} as const;

export const DATA_SOURCE_STATUS_LABELS = {
  ready: "就绪",
  loading: "加载中",
  error: "错误",
} as const;

export const JOB_STATUS_LABELS = {
  completed: "已完成",
  failed: "失败",
} as const;

export const ENVIRONMENT_LABELS = {
  production: "生产环境",
  staging: "预发布环境",
  development: "开发环境",
  local: "本地环境",
} as const;

export const SEARCH_RESULT_TYPE_LABELS = {
  page: "页面",
  user: "用户",
  workspace: "工作区",
} as const;
