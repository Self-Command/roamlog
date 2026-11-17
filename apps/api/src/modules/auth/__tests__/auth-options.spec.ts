import { UuidV7Schema } from "@roamlog/contracts";
import { describe, expect, it, vi } from "vitest";

import type { AppConfigService } from "../../../config/app-config.service.js";
import type { PrismaService } from "../../prisma/prisma.service.js";
import { buildAuthOptions } from "../auth-options.js";
import type { EmailDeliveryService } from "../email-delivery.service.js";
import { generateUuidV7 } from "../uuid.js";

describe("Better Auth options", () => {
  it("configures verification, OAuth, cookies, rate limit, and structural 2FA", () => {
    const prisma = {
      client: {
        user: {
          findUnique: vi.fn(),
        },
      },
    };
    const email = {
      sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
    };
    const prismaAdapter = vi.fn().mockReturnValue({ adapter: "prisma" });
    const twoFactor = vi.fn().mockReturnValue({ id: "two-factor" });
    const config = {
      isProduction: false,
      appUrl: "http://localhost:3000",
      adminUrl: "http://localhost:3001",
      apiUrl: "http://localhost:4000",
      betterAuthUrl: "http://localhost:4000",
      betterAuthSecret: "test-secret-that-is-at-least-32-bytes",
      corsOrigins: ["http://localhost:3000"],
      sessionCookieDomain: undefined,
      googleClientId: "google-client",
      googleClientSecret: "google-secret",
      githubClientId: "github-client",
      githubClientSecret: "github-secret",
    } as unknown as AppConfigService;

    const options = buildAuthOptions({
      config,
      prisma: prisma as unknown as PrismaService,
      email: email as unknown as EmailDeliveryService,
      prismaAdapter,
      twoFactor,
    });

    expect(options).toMatchObject({
      appName: "Roamlog",
      basePath: "/v1/auth",
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
      },
      emailVerification: {
        sendOnSignUp: true,
      },
      rateLimit: {
        enabled: true,
        max: 10,
      },
      advanced: {
        cookiePrefix: "roamlog",
      },
      logger: {
        disabled: true,
      },
    });
    expect(options.socialProviders).toMatchObject({
      google: { clientId: "google-client" },
      github: { clientId: "github-client" },
    });
    expect(options.plugins).toEqual([{ id: "two-factor" }]);
    expect(twoFactor).toHaveBeenCalledWith({
      issuer: "Roamlog",
      skipVerificationOnEnable: false,
      totpOptions: {
        digits: 6,
        period: 30,
      },
      accountLockout: {
        enabled: true,
        maxFailedAttempts: 10,
        durationSeconds: 900,
      },
    });
    expect(prismaAdapter).toHaveBeenCalledWith(prisma.client, {
      provider: "postgresql",
    });

    const advanced = options.advanced as {
      database: { generateId: () => string };
    };
    expect(UuidV7Schema.safeParse(advanced.database.generateId()).success).toBe(true);
  });

  it("blocks session creation for unverified or suspended users", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({
        status: "active",
        deletedAt: null,
        emailVerified: false,
      })
      .mockResolvedValueOnce({
        status: "suspended",
        deletedAt: null,
        emailVerified: true,
      })
      .mockResolvedValueOnce({
        status: "active",
        deletedAt: null,
        emailVerified: true,
      });
    const options = buildAuthOptions({
      config: {
        isProduction: false,
        appUrl: "http://localhost:3000",
        adminUrl: "http://localhost:3001",
        apiUrl: "http://localhost:4000",
        betterAuthUrl: "http://localhost:4000",
        betterAuthSecret: "test-secret-that-is-at-least-32-bytes",
        corsOrigins: [],
        sessionCookieDomain: undefined,
      } as unknown as AppConfigService,
      prisma: {
        client: { user: { findUnique } },
      } as unknown as PrismaService,
      email: {} as EmailDeliveryService,
      prismaAdapter: vi.fn(),
      twoFactor: vi.fn(),
    });
    const databaseHooks = options.databaseHooks as {
      session: {
        create: {
          before: (session: { userId: string }) => Promise<boolean>;
        };
      };
    };

    await expect(databaseHooks.session.create.before({ userId: "u1" })).resolves.toBe(false);
    await expect(databaseHooks.session.create.before({ userId: "u2" })).resolves.toBe(false);
    await expect(databaseHooks.session.create.before({ userId: "u3" })).resolves.toBe(true);
  });
});

describe("generateUuidV7", () => {
  it("generates a sortable UUIDv7 accepted by the contract", () => {
    const first = generateUuidV7(1_700_000_000_000);
    const second = generateUuidV7(1_700_000_000_001);

    expect(UuidV7Schema.safeParse(first).success).toBe(true);
    expect(second > first).toBe(true);
  });
});
