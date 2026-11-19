import { describe, expect, it } from "vitest";

import {
  AdminReportDetailSchema,
  AdminReportItemSchema,
  AdminReportQuerySchema,
  CreateReportRequestSchema,
  REPORT_ERROR_CODES,
  ReportReasonSchema,
  ReportTargetTypeSchema,
  ResolveReportRequestSchema,
} from "../api/reports";

const REPORT_ID = "01942f30-1200-7000-8000-000000000901";
const TARGET_ID = "01942f30-1200-7000-8000-000000000902";
const WORKSPACE_ID = "01942f30-1200-7000-8000-000000000903";
const USER_ID = "01942f30-1200-7000-8000-000000000904";

const snapshot = {
  type: "trip" as const,
  id: TARGET_ID,
  title: "Kyoto in November",
  authorId: USER_ID,
  authorName: "Owner",
  workspaceId: WORKSPACE_ID,
  workspaceName: "Studio",
  deletedAt: null,
  moderatedAt: null,
};

const reportItem = {
  id: REPORT_ID,
  workspaceId: WORKSPACE_ID,
  targetType: "trip" as const,
  targetId: TARGET_ID,
  reason: "spam" as const,
  detail: "重复广告",
  reporterId: USER_ID,
  status: "open" as const,
  resolvedById: null,
  resolvedAt: null,
  resolutionNote: null,
  createdAt: "2026-11-19T08:00:00.000Z",
  target: snapshot,
  reportCount: 2,
  lastReportedAt: "2026-11-19T08:05:00.000Z",
};

describe("report contracts", () => {
  it("accepts every documented reason and target type", () => {
    for (const reason of ["spam", "harassment", "private_info", "illegal", "other"]) {
      expect(ReportReasonSchema.parse(reason)).toBe(reason);
    }
    for (const targetType of ["trip", "entry", "comment", "media"]) {
      expect(ReportTargetTypeSchema.parse(targetType)).toBe(targetType);
    }
  });

  it("rejects unknown reason and target type values", () => {
    expect(ReportReasonSchema.safeParse("copyright").success).toBe(false);
    expect(ReportTargetTypeSchema.safeParse("workspace").success).toBe(false);
    expect(
      CreateReportRequestSchema.safeParse({
        targetType: "trip",
        targetId: TARGET_ID,
        reason: "copyright",
      }).success,
    ).toBe(false);
  });

  it("trims and caps the optional detail", () => {
    expect(
      CreateReportRequestSchema.parse({
        targetType: "comment",
        targetId: TARGET_ID,
        reason: "harassment",
        detail: "  人身攻击  ",
      }),
    ).toMatchObject({ detail: "人身攻击" });

    expect(
      CreateReportRequestSchema.safeParse({
        targetType: "comment",
        targetId: TARGET_ID,
        reason: "harassment",
        detail: "x".repeat(1001),
      }).success,
    ).toBe(false);
  });

  it("parses the admin queue query and rejects non-whitelisted sorts", () => {
    expect(
      AdminReportQuerySchema.parse({
        status: "open",
        targetType: "media",
        reason: "spam",
        workspaceId: WORKSPACE_ID,
        from: "2026-11-01",
        to: "2026-11-19",
        q: "kyoto",
        sort: "createdAt:desc",
        limit: "20",
      }),
    ).toMatchObject({ status: "open", limit: 20 });
    expect(AdminReportQuerySchema.safeParse({ sort: "detail:asc" }).success).toBe(false);
  });

  it("parses a detail payload with snapshot, sibling reports and action history", () => {
    const detail = AdminReportDetailSchema.parse({
      report: reportItem,
      reports: [reportItem],
      actions: [
        {
          id: "01942f30-1200-7000-8000-000000000905",
          reportId: REPORT_ID,
          actorId: USER_ID,
          action: "warn",
          note: null,
          createdAt: "2026-11-19T09:00:00.000Z",
        },
      ],
    });
    expect(detail.report.target.title).toBe("Kyoto in November");
    expect(detail.actions[0]?.action).toBe("warn");
    // A missing snapshot must fail: the queue renders it, from API data only.
    expect(
      AdminReportItemSchema.safeParse({ ...reportItem, target: undefined }).success,
    ).toBe(false);
  });

  it("maps every resolve action and keeps the error codes stable", () => {
    for (const action of ["remove", "restore", "warn", "dismiss"]) {
      expect(ResolveReportRequestSchema.parse({ action }).action).toBe(action);
    }
    expect(ResolveReportRequestSchema.safeParse({ action: "delete" }).success).toBe(false);
    expect(Object.values(REPORT_ERROR_CODES)).toEqual([
      "REPORT_DUPLICATE",
      "REPORT_TARGET_NOT_FOUND",
      "REPORT_ALREADY_RESOLVED",
      "REPORT_REASON_INVALID",
    ]);
  });
});