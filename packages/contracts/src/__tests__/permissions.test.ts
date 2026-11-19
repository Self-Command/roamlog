import { describe, expect, it } from "vitest";

import {
  ADMIN_ACTIONS,
  NON_GRANTABLE_ADMIN_ACTIONS,
  PLATFORM_ROLE_ACTIONS,
  can,
  canPlatform,
} from "../permissions";

describe("workspace permission matrix", () => {
  it("lets viewers participate in comments without granting content writes", () => {
    expect(can("viewer", "comment:create", "trip")).toBe(true);
    expect(can("viewer", "comment:resolve", "comment")).toBe(true);
    expect(can("viewer", "mention:create", "comment")).toBe(true);
    expect(can("viewer", "trip:update", "trip")).toBe(false);
    expect(can("viewer", "entry:update", "journal_entry")).toBe(false);
    expect(can("viewer", "expense:create", "expense")).toBe(false);
  });

  it("keeps ownership transfer and workspace deletion owner-only", () => {
    expect(can("owner", "workspace:transfer-ownership", "workspace")).toBe(true);
    expect(can("admin", "workspace:transfer-ownership", "workspace")).toBe(false);
    expect(can("owner", "workspace:delete", "workspace")).toBe(true);
    expect(can("admin", "workspace:delete", "workspace")).toBe(false);
  });

  it("prevents editors from administration and settings", () => {
    expect(can("editor", "member:update-role", "member")).toBe(false);
    expect(can("editor", "invitation:create", "invitation")).toBe(false);
    expect(can("editor", "workspace:update", "workspace")).toBe(false);
    expect(can("editor", "workspace:view-audit", "workspace")).toBe(false);
    expect(can("editor", "share-link:create", "share_link")).toBe(true);
    expect(can("editor", "entry:create", "journal_entry")).toBe(true);
  });

  it("prevents admins from managing owners or admin peers", () => {
    expect(can("admin", "member:manage-admin", "member")).toBe(false);
    expect(can("owner", "member:manage-admin", "member")).toBe(true);
    expect(can("admin", "member:remove-admin", "member")).toBe(false);
    expect(can("admin", "member:grant-owner", "member")).toBe(false);
    expect(can("owner", "member:grant-owner", "member")).toBe(false);
    expect(can("admin", "invitation:create", "invitation")).toBe(true);
    expect(can("admin", "invitation:create-admin", "invitation")).toBe(false);
    expect(can("owner", "invitation:create-admin", "invitation")).toBe(true);
  });

  it("allows admins to read audit logs but never to transfer ownership", () => {
    expect(can("admin", "workspace:view-audit", "workspace")).toBe(true);
    expect(can("admin", "workspace:transfer-ownership", "workspace")).toBe(false);
    expect(can("owner", "workspace:view-audit", "workspace")).toBe(true);
  });

  it("fails closed for unknown roles, actions, and resources", () => {
    expect(can("owner", "nonsense:action", "trip")).toBe(false);
    expect(can("owner", "trip:read", "nonsense")).toBe(false);
    expect(can("intruder", "trip:read", "trip")).toBe(false);
    expect(can("owner", "admin:metrics:read", "admin")).toBe(false);
  });
});

describe("platform permission matrix", () => {
  it("separates read-only operators from administrators", () => {
    expect(canPlatform("support", "admin:users:read")).toBe(true);
    expect(canPlatform("support", "admin:users:suspend")).toBe(true);
    expect(canPlatform("support", "admin:flags:update")).toBe(false);
    expect(canPlatform("analyst", "admin:metrics:read")).toBe(true);
    expect(canPlatform("analyst", "admin:users:suspend")).toBe(false);
    expect(canPlatform("analyst", "admin:audit:export")).toBe(true);
    expect(canPlatform("admin", "admin:users:delete")).toBe(true);
    expect(canPlatform("admin", "admin:users:change-role")).toBe(false);
    expect(canPlatform("super_admin", "admin:users:change-role")).toBe(true);
    expect(canPlatform("super_admin", "admin:flags:update")).toBe(true);
    expect(canPlatform("user", "admin:metrics:read")).toBe(false);
  });

  it("fails closed for unknown platform actions", () => {
    expect(canPlatform("super_admin", "admin:not-real")).toBe(false);
    expect(canPlatform("intruder", "admin:metrics:read")).toBe(false);
  });

  it("reserves queue lifecycle management for super admins", () => {
    expect(canPlatform("super_admin", "admin:jobs:manage")).toBe(true);
    expect(canPlatform("admin", "admin:jobs:manage")).toBe(false);
    expect(canPlatform("support", "admin:jobs:manage")).toBe(false);
    expect(canPlatform("analyst", "admin:jobs:manage")).toBe(false);
  });

  it("reserves platform settings read and write for super admins", () => {
    for (const action of ["admin:settings:read", "admin:settings:write"] as const) {
      expect(canPlatform("super_admin", action)).toBe(true);
      expect(canPlatform("admin", action)).toBe(false);
      expect(canPlatform("support", action)).toBe(false);
      expect(canPlatform("analyst", action)).toBe(false);
      expect(canPlatform("user", action)).toBe(false);
    }
  });

  it("every non-grantable action is a real action", () => {
    for (const action of NON_GRANTABLE_ADMIN_ACTIONS) {
      expect(ADMIN_ACTIONS).toContain(action);
    }
  });

  it("every role action is a real action", () => {
    for (const [role, actions] of Object.entries(PLATFORM_ROLE_ACTIONS)) {
      for (const action of actions) expect(ADMIN_ACTIONS, role).toContain(action);
    }
  });
});
