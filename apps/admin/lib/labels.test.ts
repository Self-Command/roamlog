import { describe, expect, it } from "vitest";

import {
  ACCOUNT_STATUS_LABELS,
  ADMIN_ROLE_LABELS,
  AUDIT_ACTOR_TYPE_LABELS,
  EMAIL_STATUS_LABELS,
  auditTargetTypeLabel,
  MEDIA_STATUS_LABELS,
  PLATFORM_ROLE_LABELS,
  REPORT_STATUS_LABELS,
  TRIP_STATUS_LABELS,
  TRIP_VISIBILITY_LABELS,
  WORKSPACE_DENSITY_LABELS,
  WORKSPACE_PLAN_LABELS,
  WORKSPACE_ROLE_LABELS,
} from "./labels";

describe("admin enum labels", () => {
  it("keeps API enum keys and localizes account and plan labels", () => {
    expect(Object.keys(ACCOUNT_STATUS_LABELS)).toEqual(["active", "suspended", "deleted"]);
    expect(ACCOUNT_STATUS_LABELS).toEqual({
      active: "启用",
      suspended: "已停用",
      deleted: "已删除",
    });
    expect(Object.keys(WORKSPACE_PLAN_LABELS)).toEqual(["free", "pro", "team"]);
    expect(WORKSPACE_PLAN_LABELS).toEqual({
      free: "免费版",
      pro: "专业版",
      team: "团队版",
    });
  });

  it("localizes every platform and workspace role", () => {
    expect(PLATFORM_ROLE_LABELS).toEqual({
      user: "用户",
      support: "支持人员",
      analyst: "分析员",
      admin: "管理员",
      super_admin: "超级管理员",
    });
    expect(ADMIN_ROLE_LABELS).toEqual({
      support: "支持人员",
      analyst: "分析员",
      admin: "管理员",
      super_admin: "超级管理员",
    });
    expect(WORKSPACE_ROLE_LABELS).toEqual({
      owner: "所有者",
      admin: "管理员",
      editor: "编辑者",
      viewer: "访客",
    });
  });

  it("localizes delivery, media and moderation statuses", () => {
    expect(EMAIL_STATUS_LABELS.queued).toBe("排队中");
    expect(EMAIL_STATUS_LABELS.delivered).toBe("已送达");
    expect(EMAIL_STATUS_LABELS.failed).toBe("失败");
    expect(MEDIA_STATUS_LABELS.ready).toBe("就绪");
    expect(MEDIA_STATUS_LABELS.processing).toBe("处理中");
    expect(REPORT_STATUS_LABELS.in_review).toBe("处理中");
    expect(AUDIT_ACTOR_TYPE_LABELS.admin).toBe("管理员");
    expect(auditTargetTypeLabel("feature_flag")).toBe("功能开关");
    expect(auditTargetTypeLabel("unknown_target")).toBe("unknown_target");
    expect(TRIP_STATUS_LABELS.active).toBe("在途中");
    expect(TRIP_VISIBILITY_LABELS.public_link).toBe("公开链接");
    expect(WORKSPACE_DENSITY_LABELS.comfortable).toBe("舒适");
  });
});
