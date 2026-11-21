import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./provision-smoke-accounts.ts", import.meta.url), "utf8");

describe("create-member provisioning", () => {
  it("builds a verified credential user with an active workspace membership", () => {
    expect(source).toContain('if (action === "create-member")');
    expect(source).toContain("buildMemberUserCreateData({");
    expect(source).toContain("emailVerified: true");
    expect(source).toContain('platformRole: "user" as const');
    expect(source).toContain('providerId: "credential"');
    expect(source).toContain("password: input.passwordHash");
    expect(source).toContain("workspaceId: input.workspaceId");
    expect(source).toContain("role: input.role");
    expect(source).toContain('status: "active" as const');
    expect(source).toContain("created: true");
    expect(source).toContain("email: user.email");
    expect(source).toContain("userId: user.id");
    expect(source).toContain("workspaceId: workspace.id");
    expect(source).toContain("role: membership.role");
  });

  it("defaults to admin and rejects unknown roles", () => {
    expect(source).toContain(
      'export const CREATE_MEMBER_ROLES = ["owner", "admin", "editor", "viewer"] as const',
    );
    expect(source).toContain('const role = value ?? "admin";');
    expect(source).toContain('"--role must be owner, admin, editor, or viewer"');
  });

  it("looks up the workspace and recreates the user transactionally", () => {
    expect(source).toContain("prisma.workspace.findUnique");
    expect(source).toContain("Workspace not found for --workspace-slug=");
    expect(source).toContain("prisma.$transaction");
    expect(source).toContain("tx.user.delete");
    expect(source).toContain("tx.user.create");
  });
});
