import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { PermissionService } from "../services/permission.service.js";

describe("PermissionService", () => {
  const permissions = new PermissionService();

  it.each([
    ["owner", "workspace:update", "workspace", true],
    ["admin", "workspace:update", "workspace", true],
    ["editor", "workspace:update", "workspace", false],
    ["viewer", "workspace:update", "workspace", false],
    ["owner", "workspace:transfer-ownership", "workspace", true],
    ["admin", "workspace:transfer-ownership", "workspace", false],
    ["owner", "invitation:create-admin", "invitation", true],
    ["admin", "invitation:create-admin", "invitation", false],
    ["owner", "invitation:create", "invitation", true],
    ["admin", "invitation:create", "invitation", true],
    ["editor", "invitation:create", "invitation", false],
    ["viewer", "comment:create", "comment", true],
    ["viewer", "entry:update", "journal_entry", false],
    ["editor", "entry:update", "journal_entry", true],
    ["owner", "workspace:view-audit", "audit", true],
    ["admin", "workspace:view-audit", "audit", true],
    ["editor", "workspace:view-audit", "audit", false],
  ] as const)("%s can=%s for %s on %s", (role, action, resource, expected) => {
    expect(permissions.can(role, action, resource)).toBe(expected);
  });

  it("throws a problem-details ForbiddenException for denied actions", () => {
    expect(() => permissions.assertCan("viewer", "workspace:update", "workspace")).toThrow(
      ForbiddenException,
    );

    try {
      permissions.assertCan("viewer", "workspace:update", "workspace");
    } catch (error) {
      expect((error as ForbiddenException).getStatus()).toBe(403);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: "WORKSPACE_ROLE_FORBIDDEN",
      });
    }
  });
});
