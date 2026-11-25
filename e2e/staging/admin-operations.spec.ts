import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { currentTotp } from "../live-support/fixture";
import { STAGING_API_URL, STAGING_EVIDENCE_ROOT, STAGING_ORIGIN, type StagingFixture } from "./env";
import { loadStagingFixture } from "./fixture";
import { readStagingRedisList, setStagingAdminRole } from "./request";

const EVIDENCE_DIRECTORY = `${STAGING_EVIDENCE_ROOT}/evidence`;

function writeEvidence(name: string, value: unknown): void {
  mkdirSync(EVIDENCE_DIRECTORY, { recursive: true });
  writeFileSync(`${EVIDENCE_DIRECTORY}/${name}`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loginAsSuperAdmin(page: Page, fixture: StagingFixture): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("管理员邮箱").fill(fixture.admin.email);
  await page.getByLabel("密码").fill(fixture.admin.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "两步验证" })).toBeVisible();
  await page.getByLabel("6 位验证码").fill(currentTotp(fixture.admin.totpSecret));
  await page.getByRole("button", { name: "验证并进入控制台" }).click();
  await page.waitForURL("**/admin");
}

async function jsonRequest(
  request: APIRequestContext,
  path: string,
  options: Parameters<APIRequestContext["fetch"]>[1] = {},
): Promise<{ status: number; body: unknown }> {
  const response = await request.fetch(`${STAGING_API_URL}${path}`, {
    ...options,
    headers: {
      origin: STAGING_ORIGIN,
      ...options.headers,
    },
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep the raw body so evidence remains diagnostic.
  }
  return { status: response.status(), body };
}

test.describe("Staging real-API Admin operations", () => {
  test("super_admin mutations, queue management, audit, and permission denial", async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const fixture = loadStagingFixture();
    const operations = fixture.adminOperations;
    expect(operations, "staging setup must seed Admin operation fixtures").toBeDefined();
    if (!operations) {
      return;
    }

    await loginAsSuperAdmin(page, fixture);
    await expect(page.getByRole("heading", { name: "平台总览" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("真实 Admin API")).toBeVisible();

    await page.goto("/admin/flags");
    await expect(page.getByRole("heading", { name: "功能开关" })).toBeVisible();
    const flagCard = page.getByRole("article", {
      name: `功能开关 ${operations.flagKey}`,
    });
    await expect(flagCard).toBeVisible();
    await flagCard.getByRole("switch").click();
    const rollout = flagCard.getByLabel(`${operations.flagKey} 灰度比例`);
    await rollout.focus();
    await rollout.press("Home");
    for (let step = 0; step < 7; step += 1) {
      await rollout.press("ArrowRight");
    }
    await expect(flagCard.getByText("35%", { exact: true })).toBeVisible();
    await flagCard.getByRole("button", { name: "保存配置" }).click();
    await expect(page.getByRole("status").filter({ hasText: operations.flagKey })).toContainText(
      "已保存",
    );
    const flags = await jsonRequest(page.request, "/v1/admin/flags");
    expect(flags.status).toBe(200);
    expect(flags.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: operations.flagKey,
          enabled: true,
          rolloutPercentage: 35,
        }),
      ]),
    );
    await page.screenshot({
      path: `${STAGING_EVIDENCE_ROOT}/admin-flags.png`,
      fullPage: true,
    });
    const resetFlag = await jsonRequest(
      page.request,
      `/v1/admin/flags/${encodeURIComponent(operations.flagKey)}`,
      {
        method: "PATCH",
        data: { enabled: false, rolloutPercentage: 0 },
      },
    );
    expect(resetFlag.status).toBe(200);

    await page.goto("/admin/content");
    await expect(page.getByRole("heading", { name: "内容审核" })).toBeVisible();
    await page.getByLabel("搜索标题 / 作者").fill(operations.contentTitle);
    const contentRow = page.getByRole("row", {
      name: new RegExp(escapeRegExp(operations.contentTitle)),
    });
    await expect(contentRow).toBeVisible();
    await contentRow.getByRole("button", { name: "删除内容" }).click();
    const deleteDialog = page.getByRole("dialog");
    await expect(deleteDialog.getByRole("heading", { name: "删除内容" })).toBeVisible();
    await deleteDialog.getByLabel("输入内容标题确认").fill(operations.contentTitle);
    await deleteDialog.getByRole("button", { name: "确认删除" }).click();
    await expect(page.getByRole("status").filter({ hasText: "已软删除" })).toBeVisible();

    const deletedTrips = await jsonRequest(
      page.request,
      `/v1/admin/trips?limit=20&q=${encodeURIComponent(operations.contentTitle)}`,
    );
    expect(deletedTrips.status).toBe(200);
    expect(deletedTrips.body).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            id: operations.contentTripId,
            deletedAt: expect.any(String),
          }),
        ]),
      }),
    );
    await expect(contentRow.getByRole("button", { name: "恢复内容" })).toBeVisible();
    await contentRow.getByRole("button", { name: "恢复内容" }).click();
    const restoreDialog = page.getByRole("dialog");
    await expect(restoreDialog.getByRole("heading", { name: "恢复内容" })).toBeVisible();
    await restoreDialog.getByLabel("输入内容标题确认").fill(operations.contentTitle);
    await restoreDialog.getByRole("button", { name: "确认恢复" }).click();
    await expect(page.getByRole("status").filter({ hasText: "已恢复" })).toBeVisible();
    const restoredTrips = await jsonRequest(
      page.request,
      `/v1/admin/trips?limit=20&q=${encodeURIComponent(operations.contentTitle)}`,
    );
    expect(restoredTrips.status).toBe(200);
    expect(restoredTrips.body).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ id: operations.contentTripId, deletedAt: null }),
        ]),
      }),
    );
    await page.screenshot({
      path: `${STAGING_EVIDENCE_ROOT}/admin-content.png`,
      fullPage: true,
    });

    await page.goto("/admin/queues");
    await expect(page.getByRole("heading", { name: "队列" })).toBeVisible();
    const jobRow = page.getByRole("row", {
      name: new RegExp(escapeRegExp(operations.failedJobId)),
    });
    await expect(jobRow).toBeVisible({ timeout: 30_000 });
    await jobRow.getByRole("button", { name: "重试任务" }).click();
    const retryDialog = page.getByRole("dialog");
    await expect(retryDialog.getByRole("heading", { name: "重试任务" })).toBeVisible();
    await retryDialog.getByLabel("输入任务 ID 确认").fill(operations.failedJobId);
    await retryDialog.getByRole("button", { name: "确认重试" }).click();
    await expect(page.getByRole("status").filter({ hasText: "已重新入队" })).toBeVisible();
    const waitingJobs = await jsonRequest(
      page.request,
      `/v1/admin/jobs?queue=${operations.queueName}&status=waiting&limit=20`,
    );
    expect(waitingJobs.status).toBe(200);
    expect(waitingJobs.body).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            id: operations.failedJobId,
            queue: operations.queueName,
          }),
        ]),
      }),
    );

    const queueCard = page.getByRole("article", {
      name: `队列 ${operations.queueName}`,
    });
    await expect(queueCard).toBeVisible();
    await queueCard.getByRole("button", { name: `暂停队列 ${operations.queueName}` }).click();
    const pauseDialog = page.getByRole("dialog");
    await expect(pauseDialog.getByRole("heading", { name: "暂停队列" })).toBeVisible();
    await pauseDialog.getByLabel("输入队列名称确认").fill(operations.queueName);
    await pauseDialog.getByRole("button", { name: "确认暂停" }).click();
    await expect(page.getByRole("status").filter({ hasText: "已暂停队列" })).toBeVisible();

    const pausedMetrics = await jsonRequest(page.request, "/v1/admin/metrics");
    expect(pausedMetrics.status).toBe(200);
    expect(pausedMetrics.body).toEqual(
      expect.objectContaining({
        queues: expect.arrayContaining([
          expect.objectContaining({ name: operations.queueName, paused: true }),
        ]),
      }),
    );

    await queueCard.getByRole("button", { name: `恢复队列 ${operations.queueName}` }).click();
    const resumeDialog = page.getByRole("dialog");
    await expect(resumeDialog.getByRole("heading", { name: "恢复队列" })).toBeVisible();
    await resumeDialog.getByLabel("输入队列名称确认").fill(operations.queueName);
    await resumeDialog.getByRole("button", { name: "确认恢复" }).click();
    await expect(page.getByRole("status").filter({ hasText: "已恢复队列" })).toBeVisible();
    const resumedMetrics = await jsonRequest(page.request, "/v1/admin/metrics");
    expect(resumedMetrics.status).toBe(200);
    expect(resumedMetrics.body).toEqual(
      expect.objectContaining({
        queues: expect.arrayContaining([
          expect.objectContaining({ name: operations.queueName, paused: false }),
        ]),
      }),
    );
    await page.screenshot({
      path: `${STAGING_EVIDENCE_ROOT}/admin-queues.png`,
      fullPage: true,
    });

    await page.goto("/admin/emails");
    await expect(page.getByRole("heading", { name: "邮件" })).toBeVisible();
    const emailRow = page.getByRole("row", {
      name: new RegExp(escapeRegExp(operations.emailTo)),
    });
    await expect(emailRow).toBeVisible();
    await emailRow.getByRole("button", { name: `重发邮件至 ${operations.emailTo}` }).click();
    await expect(page.getByRole("status").filter({ hasText: "已重新加入队列" })).toBeVisible();
    const emails = await jsonRequest(
      page.request,
      `/v1/admin/emails?limit=20&to=${encodeURIComponent(operations.emailTo)}`,
    );
    expect(emails.status).toBe(200);
    expect(emails.body).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            to: operations.emailTo,
            template: "staging.release-gate",
            status: "queued",
          }),
        ]),
      }),
    );
    const emailItems = (
      emails.body as {
        items: Array<{ id: string; to: string; status: string }>;
      }
    ).items;
    const queuedEmail = emailItems.find(
      (item) => item.to === operations.emailTo && item.status === "queued",
    );
    expect(queuedEmail, "resend must create a queued EmailLog").toBeDefined();
    const ingressJobs = readStagingRedisList("jobs:ingress").flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
    expect(ingressJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queue: "email",
          name: "email.send",
          data: expect.objectContaining({
            emailLogId: queuedEmail?.id,
          }),
        }),
      ]),
    );
    await page.screenshot({
      path: `${STAGING_EVIDENCE_ROOT}/admin-emails.png`,
      fullPage: true,
    });

    const audit = await jsonRequest(page.request, "/v1/admin/audit?limit=100");
    expect(audit.status).toBe(200);
    const actions =
      typeof audit.body === "object" && audit.body !== null && "items" in audit.body
        ? (audit.body.items as Array<{ action?: unknown }>).map((item) => item.action)
        : [];
    expect(actions).toEqual(
      expect.arrayContaining([
        "admin.feature_flag.updated",
        "admin.content.deleted",
        "admin.content.restored",
        "admin.job.retried",
        "admin.queue.paused",
        "admin.queue.resumed",
        "admin.email.resent",
      ]),
    );

    const webDenied = await request.get(`${STAGING_API_URL}/v1/admin/metrics`, {
      headers: { cookie: fixture.web.sessionCookie, origin: STAGING_ORIGIN },
    });
    expect(webDenied.status()).toBe(403);
    expect(await webDenied.text()).toContain("ADMIN_ACCESS_DENIED");

    setStagingAdminRole("admin");
    let deniedFlagStatus = 0;
    let deniedQueueStatus = 0;
    try {
      const deniedFlag = await jsonRequest(
        page.request,
        `/v1/admin/flags/${encodeURIComponent(operations.flagKey)}`,
        {
          method: "PATCH",
          data: { enabled: true },
        },
      );
      deniedFlagStatus = deniedFlag.status;
      expect(deniedFlag.status).toBe(403);
      expect(deniedFlag.body).toEqual(expect.objectContaining({ code: "ADMIN_ACCESS_DENIED" }));

      const deniedQueue = await jsonRequest(
        page.request,
        `/v1/admin/jobs/${operations.queueName}/pause`,
        { method: "POST" },
      );
      deniedQueueStatus = deniedQueue.status;
      expect(deniedQueue.status).toBe(403);
      expect(deniedQueue.body).toEqual(expect.objectContaining({ code: "ADMIN_ACCESS_DENIED" }));
    } finally {
      setStagingAdminRole("super_admin");
    }

    writeEvidence("admin-operations.json", {
      user: fixture.admin.email,
      flagUpdate: { status: flags.status, key: operations.flagKey },
      content: {
        deletedStatus: deletedTrips.status,
        restoredStatus: restoredTrips.status,
        tripId: operations.contentTripId,
      },
      queue: {
        retryStatus: waitingJobs.status,
        pausedStatus: pausedMetrics.status,
        resumedStatus: resumedMetrics.status,
        jobId: operations.failedJobId,
      },
      email: {
        resendStatus: emails.status,
        to: operations.emailTo,
        queuedEmailId: queuedEmail?.id ?? null,
        queueIngressVerified: true,
      },
      auditActions: actions,
      permissionDenied: {
        webOwnerAdminMetrics: webDenied.status(),
        adminFlagUpdate: deniedFlagStatus,
        adminQueuePause: deniedQueueStatus,
      },
    });
  });
});
