/**
 * Journey 4 — the report loop: viewer submits, super_admin sees it, super_admin
 * dismisses it.
 *
 * Every run creates its own trip (unique title) because the API rejects a
 * second report by the same member on the same target forever — reusing demo
 * content would make the second run fail for the wrong reason.
 *
 * Cleanup: the report is dismissed (kept for audit, no longer open) and the
 * trip is soft-deleted by its owner in `finally`.
 */
import { expect, request as playwrightRequest, test } from "@playwright/test";

import {
  ADMIN_URL,
  API_URL,
  createSuperAdminAccount,
  deleteSuperAdmin,
  findWorkspace,
  OWNER_ACCOUNT,
  provisionSuperAdmin,
  routeBrowserApi,
  signInViaApi,
  VIEWER_ACCOUNT,
  WEB_URL,
  WORKSPACE_SLUG,
} from "../../support/accounts";
import { registerFailureEvidence, uniqueRunId } from "../../support/smoke";

registerFailureEvidence(test);

const runId = uniqueRunId();
const superAdmin = createSuperAdminAccount(runId);

test.describe("report moderation loop", () => {
  test.beforeAll(() => {
    provisionSuperAdmin(superAdmin);
  });

  test.afterAll(() => {
    deleteSuperAdmin(superAdmin.email);
  });

  test("viewer report is visible to the super_admin queue and can be dismissed", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Optional stable API process (same database) for runs while the shared
    // :4000 process is being restarted by another agent.
    const apiBase = process.env.E2E_SMOKE_API_URL?.trim() ?? API_URL;

    let viewerId: string;
    let workspace: { id: string; slug: string; name: string };

    if (apiBase === API_URL) {
      const viewer = await signInViaApi(page.request, VIEWER_ACCOUNT, WEB_URL);
      viewerId = viewer.id;
      workspace = await findWorkspace(page.request);
    } else {
      const viewerApi = await playwrightRequest.newContext({ baseURL: apiBase });
      try {
        const viewer = await signInViaApi(viewerApi, VIEWER_ACCOUNT, WEB_URL, apiBase);
        viewerId = viewer.id;
        const response = await viewerApi.get(`${apiBase}/v1/me/workspaces`);
        expect(response.status(), await response.text()).toBe(200);
        const workspaces = (await response.json()) as Array<{
          id: string;
          slug: string;
          name: string;
        }>;
        const found = workspaces.find((entry) => entry.slug === WORKSPACE_SLUG);
        expect(found, `workspace ${WORKSPACE_SLUG} must be visible`).toBeTruthy();
        workspace = found as { id: string; slug: string; name: string };

        const cookie = (await viewerApi.cookies())
          .map((entry) => `${entry.name}=${entry.value}`)
          .join("; ");
        await routeBrowserApi(page, apiBase, cookie);
      } finally {
        await viewerApi.dispose();
      }
    }

    let tripId: string | null = null;
    let reportId: string | null = null;

    try {
      // A fresh target for this run, created by the workspace owner.
      const ownerApi = await playwrightRequest.newContext({ baseURL: apiBase });
      try {
        await signInViaApi(ownerApi, OWNER_ACCOUNT, WEB_URL, apiBase);
        const tripTitle = `Smoke report ${runId}`;
        const created = await ownerApi.post(
          `${apiBase}/v1/workspaces/${workspace.id}/trips`,
          {
            headers: { origin: WEB_URL },
            data: {
              title: tripTitle,
              summary: "E2E smoke moderation target; removed again by the test.",
              startDate: "2027-06-01",
              endDate: "2027-06-03",
            },
          },
        );
        expect([200, 201], await created.text()).toContain(created.status());
        tripId = ((await created.json()) as { id: string }).id;

        await page.goto(`/w/${WORKSPACE_SLUG}/trips/${tripId}`);
        await expect(page.getByRole("heading", { name: tripTitle })).toBeVisible({ timeout: 30_000 });

        await page.getByRole("button", { name: `更多操作：${tripTitle}` }).click();
        await page.getByRole("menuitem", { name: "举报" }).click();

        const dialog = page.getByRole("dialog");
        await expect(dialog.getByRole("heading", { name: "举报这条内容" })).toBeVisible();
        await dialog.getByLabel("举报原因").selectOption("spam");
        await dialog.getByRole("button", { name: "提交举报" }).click();
        await expect(dialog.getByRole("status")).toContainText("举报已提交", {
          timeout: 30_000,
        });
        await dialog
          .getByRole("button", { name: "关闭", exact: true })
          .filter({ hasText: "关闭" })
          .click();
        await expect(dialog).toHaveCount(0);
      } finally {
        await ownerApi.dispose();
      }

      // The platform queue must contain the new report.
      const adminApi = await playwrightRequest.newContext({ baseURL: apiBase });
      try {
        await signInViaApi(adminApi, superAdmin, ADMIN_URL, apiBase);

        const queueResponse = await adminApi.get(
          `${apiBase}/v1/admin/reports?status=open&limit=100`,
        );
        expect(queueResponse.status(), await queueResponse.text()).toBe(200);
        const queue = (await queueResponse.json()) as {
          items: Array<{
            id: string;
            targetId: string;
            targetType: string;
            reporterId: string;
            reason: string;
            status: string;
            target: { title: string; workspaceName: string };
          }>;
        };
        const report = queue.items.find(
          (item) =>
            item.targetType === "trip" &&
            item.targetId === tripId &&
            item.reporterId === viewerId,
        );
        expect(report, "the submitted report must be visible in GET /v1/admin/reports?status=open").toBeTruthy();
        reportId = report?.id ?? null;
        expect(report?.reason).toBe("spam");
        expect(report?.status).toBe("open");
        expect(report?.target.title).toContain(`Smoke report ${runId}`);

        const resolved = await adminApi.post(
          `${apiBase}/v1/admin/reports/${reportId}/resolve`,
          {
            headers: { origin: ADMIN_URL },
            data: { action: "dismiss", note: "E2E smoke: dismiss after verification." },
          },
        );
        expect(resolved.status(), await resolved.text()).toBe(200);
        const resolvedBody = (await resolved.json()) as {
          report: { id: string; status: string };
          action: { action: string };
        };
        expect(resolvedBody.report.status).toBe("dismissed");
        expect(resolvedBody.action.action).toBe("dismiss");

        const afterResponse = await adminApi.get(
          `${apiBase}/v1/admin/reports?status=open&limit=100`,
        );
        expect(afterResponse.status()).toBe(200);
        const after = (await afterResponse.json()) as { items: Array<{ id: string }> };
        expect(after.items.some((item) => item.id === reportId)).toBe(false);
      } finally {
        await adminApi.dispose();
      }
    } finally {
      // Best effort: never leave an open smoke report behind, even on failure.
      if (reportId) {
        const cleanupApi = await playwrightRequest.newContext({ baseURL: apiBase });
        try {
          await signInViaApi(cleanupApi, superAdmin, ADMIN_URL, apiBase);
          await cleanupApi
            .post(`${apiBase}/v1/admin/reports/${reportId}/resolve`, {
              headers: { origin: ADMIN_URL },
              data: { action: "dismiss", note: "E2E smoke cleanup." },
            })
            .catch(() => undefined);
        } catch {
          // The report may already be dismissed; cleanup must not mask the assertion failure.
        } finally {
          await cleanupApi.dispose();
        }
      }

      if (tripId) {
        const cleanupApi = await playwrightRequest.newContext({ baseURL: apiBase });
        try {
          await signInViaApi(cleanupApi, OWNER_ACCOUNT, WEB_URL, apiBase);
          await cleanupApi
            .delete(`${apiBase}/v1/trips/${tripId}`, { headers: { origin: WEB_URL } })
            .catch(() => undefined);
        } catch {
          // Keep the original failure if sign-in itself is unavailable.
        } finally {
          await cleanupApi.dispose();
        }
      }
    }
  });
});