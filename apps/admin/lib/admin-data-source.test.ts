import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AdminMutationError, assertAdminResponse, toAdminApiFailure } from "./admin-api-error";
import { mapAdminMedia, mapAdminUsers, platformRoleOf } from "./admin-data-source";

const here = dirname(fileURLToPath(import.meta.url));

describe("admin data mode and API adapter", () => {
  it("has no fixture mode switch", () => {
    const source = readFileSync(join(here, "admin-data-source.ts"), "utf8");
    expect(source).not.toMatch(/fixture/i);
  });

  it("has no data-mode module left to import", () => {
    expect(() => readFileSync(join(here, "admin-data-mode.ts"), "utf8")).toThrow();
  });

  it("surfaces ADMIN_2FA_REQUIRED with degraded headers from a 403 response", () => {
    const failure = toAdminApiFailure(
      403,
      {
        type: "https://roamlog.app/errors/forbidden",
        title: "Forbidden",
        status: 403,
        detail: "Enroll and verify TOTP before accessing the Admin API.",
        code: "ADMIN_2FA_REQUIRED",
      },
      new Headers({ "x-roamlog-degraded": "redis,storage" }),
    );

    expect(failure).toMatchObject({
      code: "ADMIN_2FA_REQUIRED",
      status: 403,
      degraded: ["redis", "storage"],
    });
  });

  it("passes successful mutation data through and throws the backend problem on failure", () => {
    expect(
      assertAdminResponse(
        {
          status: 200,
          data: { revokedSessions: 3 },
          headers: new Headers(),
        },
        "force logout",
      ),
    ).toEqual({ revokedSessions: 3 });

    expect(() =>
      assertAdminResponse(
        {
          status: 403,
          data: {
            type: "https://roamlog.app/errors/forbidden",
            title: "Forbidden",
            status: 403,
            detail: "Only super_admin can update flags.",
            code: "ADMIN_ACTION_FORBIDDEN",
          },
          headers: new Headers(),
        },
        "update flag",
      ),
    ).toThrow(AdminMutationError);
  });

  it("keeps API user rows unchanged instead of inventing detail counters", () => {
    const users = mapAdminUsers([
      {
        id: "0199a0c1-1100-7000-8000-000000000001",
        email: "admin@roamlog.local",
        emailVerified: true,
        name: "Admin",
        image: null,
        platformRole: "admin",
        status: "active",
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
        lastActiveAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
      },
    ]);

    expect(users[0]).toMatchObject({
      platformRole: "admin",
    });
    expect(users[0]).not.toHaveProperty("workspaceCount");
    expect(users[0]).not.toHaveProperty("activeSessionCount");
    expect(platformRoleOf("super_admin")).toBe("super_admin");
    expect(platformRoleOf("user")).toBe("user");
    expect(platformRoleOf("owner")).toBe("user");
  });

  it("uses the persisted original filename and falls back for legacy media", () => {
    const row = {
      id: "0199a0c1-2200-7000-8000-000000000001",
      workspaceId: "0199a0c1-2200-7000-8000-000000000002",
      tripId: null,
      uploaderId: "0199a0c1-2200-7000-8000-000000000003",
      bucket: "roamlog-test",
      key: "workspace/2026/11/media/original.jpg",
      originalFileName: "旅行 京都.jpg",
      mimeType: "image/jpeg",
      size: 1024,
      width: 1200,
      height: 800,
      blurhash: null,
      variants: {},
      status: "ready",
      error: null,
      caption: null,
      date: null,
      location: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: null,
    } as Parameters<typeof mapAdminMedia>[0][number];

    expect(mapAdminMedia([row], [])[0]?.fileName).toBe("旅行 京都.jpg");
    expect(mapAdminMedia([{ ...row, originalFileName: null }], [])[0]?.fileName).toBe(
      "original.jpg",
    );
  });
});
