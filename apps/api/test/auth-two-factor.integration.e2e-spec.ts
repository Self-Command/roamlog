import { spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { twoFactor } from "better-auth/plugins/two-factor";
import { createPrismaClient } from "@roamlog/db";
import type { ExecutionContext } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { presentUser } from "../src/common/services/user-presenter.js";
import { buildAuthOptions } from "../src/modules/auth/auth-options.js";
import { PlatformTwoFactorGuard } from "../src/modules/admin/platform-two-factor.guard.js";

const databaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;
const apiUrl = "http://localhost:4000";
const appUrl = "http://localhost:3000";

interface AuthResponse {
  status: number;
  json: Record<string, unknown>;
  setCookies: string[];
}

function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.replaceAll("=", "").toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let buffer = 0;

  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) {
      throw new Error("The TOTP URI contained an invalid base32 secret");
    }
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

function currentTotp(secret: string, now = Date.now()): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(now / 30_000);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(counterBytes).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

function guardContext(user: ReturnType<typeof presentUser>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => function handler(): void {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

integrationDescribe("Better Auth TOTP lifecycle with PostgreSQL", () => {
  const email = `totp-${randomUUID()}@roamlog.test`;
  const password = `Test-${randomUUID()}-Aa1!`;
  const startedAt = new Date();
  let prisma: ReturnType<typeof createPrismaClient>;
  let auth: { handler(request: Request): Promise<Response> };
  let userId: string | undefined;
  let sessionCookie = "";

  async function callAuth(
    path: string,
    input: {
      method: "GET" | "POST";
      body?: Record<string, unknown>;
      cookie?: string;
    },
  ): Promise<AuthResponse> {
    const headers = new Headers({
      origin: appUrl,
    });
    if (input.body) {
      headers.set("content-type", "application/json");
    }
    if (input.cookie) {
      headers.set("cookie", input.cookie);
    }

    const response = await auth.handler(
      new Request(`${apiUrl}/v1/auth${path}`, {
        method: input.method,
        headers,
        ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      }),
    );
    const text = await response.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    return {
      status: response.status,
      json,
      setCookies: response.headers.getSetCookie(),
    };
  }

  beforeAll(async () => {
    if (!databaseUrl) {
      return;
    }

    prisma = createPrismaClient({ connectionString: databaseUrl });
    const config = {
      isProduction: false,
      appUrl,
      adminUrl: "http://localhost:3001",
      apiUrl,
      betterAuthUrl: apiUrl,
      betterAuthSecret: "test-only-secret-that-is-at-least-32-bytes",
      corsOrigins: [appUrl, "http://localhost:3001"],
      sessionCookieDomain: undefined,
      googleClientId: undefined,
      googleClientSecret: undefined,
      githubClientId: undefined,
      githubClientSecret: undefined,
    };
    const emailDelivery = {
      sendVerificationEmail: async () => undefined,
      sendPasswordResetEmail: async () => undefined,
    };
    const options = buildAuthOptions({
      config: config as never,
      prisma: { client: prisma } as never,
      email: emailDelivery as never,
      prismaAdapter: prismaAdapter as never,
      twoFactor: twoFactor as never,
    });
    auth = betterAuth(options as never) as unknown as {
      handler(request: Request): Promise<Response>;
    };
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }
    await prisma.user.deleteMany({
      where: { email },
    });
    await prisma.verification.deleteMany({
      where: { createdAt: { gte: startedAt } },
    });
    await prisma.$disconnect();
  });

  it("enrolls, verifies, gates Admin access, rejects a wrong code, and disables TOTP", async () => {
    const signUp = await callAuth("/sign-up/email", {
      method: "POST",
      body: {
        name: "TOTP Integration Admin",
        email,
        password,
      },
    });
    expect(signUp.status).toBe(200);

    const registered = await prisma.user.findUnique({ where: { email } });
    expect(registered).not.toBeNull();
    userId = registered?.id;
    expect(userId).toBeDefined();

    await prisma.user.update({
      where: { id: userId },
      data: {
        emailVerified: true,
        platformRole: "admin",
      },
    });

    const signIn = await callAuth("/sign-in/email", {
      method: "POST",
      body: { email, password },
    });
    expect(signIn.status).toBe(200);
    sessionCookie = cookieHeader(signIn.setCookies);
    expect(sessionCookie).toContain("roamlog.session_token=");

    const guard = new PlatformTwoFactorGuard(
      { client: prisma } as never,
      { adminTwoFactorEnforced: true } as never,
    );
    const beforeEnrollment = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    await expect(
      guard.canActivate(guardContext(presentUser(beforeEnrollment))),
    ).rejects.toMatchObject({
      status: 403,
      response: { code: "ADMIN_2FA_REQUIRED" },
    });

    const enable = await callAuth("/two-factor/enable", {
      method: "POST",
      cookie: sessionCookie,
      body: {
        password,
        method: "totp",
      },
    });
    expect(enable.status).toBe(200);
    const totpUri = enable.json.totpURI;
    expect(typeof totpUri).toBe("string");
    const secret = new URL(totpUri as string).searchParams.get("secret");
    expect(secret).toBeTruthy();

    const pendingFactor = await prisma.twoFactor.findFirstOrThrow({
      where: { userId },
    });
    expect(pendingFactor.verified).toBe(false);

    const validCode = currentTotp(secret as string);
    const wrongCode = validCode === "000000" ? "000001" : "000000";
    const wrong = await callAuth("/two-factor/verify-totp", {
      method: "POST",
      cookie: sessionCookie,
      body: { code: wrongCode },
    });
    expect(wrong.status).toBe(401);
    expect(wrong.json.code).toBe("INVALID_CODE");

    const verify = await callAuth("/two-factor/verify-totp", {
      method: "POST",
      cookie: sessionCookie,
      body: { code: validCode },
    });
    expect(verify.status).toBe(200);
    const verifyCookie = cookieHeader(verify.setCookies);
    if (verifyCookie) {
      sessionCookie = verifyCookie;
    }

    const verifiedUser = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const verifiedFactor = await prisma.twoFactor.findFirstOrThrow({
      where: { userId },
    });
    expect(verifiedUser.twoFactorEnabled).toBe(true);
    expect(verifiedFactor.verified).toBe(true);
    await expect(guard.canActivate(guardContext(presentUser(verifiedUser)))).resolves.toBe(true);

    const challengedSignIn = await callAuth("/sign-in/email", {
      method: "POST",
      body: { email, password },
    });
    expect(challengedSignIn.status).toBe(200);
    expect(challengedSignIn.json.twoFactorRedirect).toBe(true);
    const challengeCookie = cookieHeader(challengedSignIn.setCookies);
    expect(challengeCookie).not.toBe("");

    const challengedVerify = await callAuth("/two-factor/verify-totp", {
      method: "POST",
      cookie: challengeCookie,
      body: { code: currentTotp(secret as string) },
    });
    expect(challengedVerify.status).toBe(200);
    const challengedSessionCookie = cookieHeader(challengedVerify.setCookies);
    expect(challengedSessionCookie).toContain("roamlog.session_token=");
    sessionCookie = challengedSessionCookie;

    const disable = await callAuth("/two-factor/disable", {
      method: "POST",
      cookie: sessionCookie,
      body: { password },
    });
    expect(disable.status).toBe(200);
    expect(disable.json.status).toBe(true);

    const disabledUser = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(disabledUser.twoFactorEnabled).toBe(false);
    await expect(prisma.twoFactor.findFirst({ where: { userId } })).resolves.toBeNull();
    await expect(guard.canActivate(guardContext(presentUser(disabledUser)))).rejects.toMatchObject({
      status: 403,
      response: { code: "ADMIN_2FA_REQUIRED" },
    });
  });

  it("rejects bootstrap promotion when the existing account has no verified TOTP factor", async () => {
    const bootstrapEmail = `bootstrap-${randomUUID()}@roamlog.test`;
    const bootstrapUser = await prisma.user.create({
      data: {
        email: bootstrapEmail,
        name: "Bootstrap Without TOTP",
        emailVerified: true,
      },
    });

    try {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "scripts/bootstrap-admin.ts", "--email", bootstrapEmail, "--force"],
        {
          cwd: resolve(process.cwd()),
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_ENV: "test",
            DATABASE_URL: databaseUrl,
            BOOTSTRAP_SUPER_ADMIN_EMAIL: bootstrapEmail,
          },
          timeout: 20_000,
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("verified TOTP factor");
      expect(result.stderr).not.toContain(bootstrapEmail);
      await expect(
        prisma.user.findUniqueOrThrow({ where: { id: bootstrapUser.id } }),
      ).resolves.toMatchObject({ platformRole: "user" });
    } finally {
      await prisma.user.delete({ where: { id: bootstrapUser.id } });
    }
  });
});
