import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { User } from "@roamlog/contracts";

import { PlatformTwoFactorGuard } from "../platform-two-factor.guard.js";
import { makeActor, USER_ADMIN_ID } from "../../../../test/identity-fixtures.js";

function contextFor(user?: User): ExecutionContext {
  const request = { user };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => function handler(): void {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

describe("PlatformTwoFactorGuard", () => {
  function setup(enforced = true) {
    const findUnique = vi.fn();
    const prisma = {
      client: {
        user: {
          findUnique,
        },
      },
    };
    const config = { adminTwoFactorEnforced: enforced };
    const guard = new PlatformTwoFactorGuard(prisma as never, config as never);
    return { findUnique, guard };
  }

  it("rejects a platform Admin without a verified TOTP factor", async () => {
    const { findUnique, guard } = setup();
    findUnique.mockResolvedValue({
      twoFactorEnabled: false,
      twoFactors: [],
    });

    await expect(
      guard.canActivate(contextFor(makeActor(USER_ADMIN_ID, { platformRole: "admin" }).user)),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: "ADMIN_2FA_REQUIRED" },
    });
  });

  it("allows a platform Admin with an enabled and verified TOTP factor", async () => {
    const { findUnique, guard } = setup();
    findUnique.mockResolvedValue({
      twoFactorEnabled: true,
      twoFactors: [
        {
          id: "01942f30-1200-7000-8000-000000000601",
        },
      ],
    });

    await expect(
      guard.canActivate(contextFor(makeActor(USER_ADMIN_ID, { platformRole: "admin" }).user)),
    ).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ADMIN_ID },
        select: expect.objectContaining({
          twoFactorEnabled: true,
          twoFactors: expect.objectContaining({ where: { verified: true } }),
        }),
      }),
    );
  });

  it("leaves TOTP optional for a normal user", async () => {
    const { findUnique, guard } = setup();

    await expect(
      guard.canActivate(contextFor(makeActor(USER_ADMIN_ID, { platformRole: "user" }).user)),
    ).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("allows platform staff through when ADMIN_2FA_ENFORCED is false", async () => {
    const { findUnique, guard } = setup(false);

    await expect(
      guard.canActivate(contextFor(makeActor(USER_ADMIN_ID, { platformRole: "admin" }).user)),
    ).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("requires a session before evaluating 2FA state", async () => {
    const { guard } = setup();
    await expect(guard.canActivate(contextFor())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects an enabled flag without a verified factor row", async () => {
    const { findUnique, guard } = setup();
    findUnique.mockResolvedValue({
      twoFactorEnabled: true,
      twoFactors: [],
    });

    await expect(
      guard.canActivate(contextFor(makeActor(USER_ADMIN_ID, { platformRole: "support" }).user)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
