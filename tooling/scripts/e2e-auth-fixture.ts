import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { hashPassword } from "better-auth/crypto";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { createPrismaClient } from "@roamlog/db";

import type { LiveFixture } from "../../e2e/live-support/env";

const ADMIN_URL = "http://127.0.0.1:3101";
const API_URL = "http://127.0.0.1:4100";
const APP_URL = "http://127.0.0.1:3100";
const DATABASE_URL =
  process.env.ROAMLOG_LIVE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://roamlog:roamlog@localhost:55432/roamlog?schema=wave5_live_e2e";
const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_FILE =
  process.env.ROAMLOG_LIVE_FIXTURE_FILE ?? resolve(SCRIPT_ROOT, ".e2e-live/fixture.json");
const AUTH_SECRET =
  process.env.ROAMLOG_LIVE_AUTH_SECRET ?? "roamlog-wave5-live-e2e-secret-at-least-32-bytes";
const PASSWORD = "Roamlog-W5-E2E-Aa1!";

interface AuthCallResult {
  status: number;
  json: Record<string, unknown>;
  cookie: string;
}

function uuidV7(now = Date.now()): string {
  const bytes = randomBytes(16);
  let timestamp = BigInt(now);

  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }

  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
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
      throw new Error("The TOTP URI contained an invalid base32 secret.");
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
  const counter = Math.floor(now / 30_000);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBytes).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

function cookieHeader(setCookies: readonly string[]): string {
  return setCookies
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

function assertStatus(result: AuthCallResult, expected: number, operation: string): void {
  if (result.status !== expected) {
    throw new Error(
      `${operation} failed with HTTP ${result.status}: ${JSON.stringify(result.json)}`,
    );
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      cleanup: { type: "boolean", default: false },
    },
  });
  const prisma = createPrismaClient({ connectionString: DATABASE_URL });

  try {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');

    if (values.cleanup) {
      rmSync(FIXTURE_FILE, { force: true });
      console.log("Live E2E database and fixture files cleaned.");
      return;
    }

    const runId = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    const email = (label: string) => `wave5-e2e-${runId}-${label}@roamlog.test`;
    const passwordHash = await hashPassword(PASSWORD);

    async function createUser(input: {
      label: string;
      name: string;
      platformRole?: "user" | "admin";
    }) {
      const id = uuidV7();
      const user = await prisma.user.create({
        data: {
          id,
          email: email(input.label),
          emailVerified: true,
          name: input.name,
          platformRole: input.platformRole ?? "user",
          accounts: {
            create: {
              id: uuidV7(),
              accountId: id,
              providerId: "credential",
              password: passwordHash,
            },
          },
        },
      });
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        password: PASSWORD,
      };
    }

    async function createWorkspace(ownerId: string, name: string, slug: string) {
      const workspaceId = uuidV7();
      await prisma.$transaction(async (transaction) => {
        await transaction.workspace.create({
          data: {
            id: workspaceId,
            name,
            slug,
            ownerId,
          },
        });
        await transaction.workspaceMember.create({
          data: {
            id: uuidV7(),
            workspaceId,
            userId: ownerId,
            role: "owner",
          },
        });
      });
      return {
        id: workspaceId,
        name,
        slug,
      };
    }

    const web = await createUser({
      label: "owner",
      name: "Wave 5 Owner",
    });
    const webWorkspace = await createWorkspace(web.id, "Roamlog Crew", "roamlog-crew");

    const admin = await createUser({
      label: "admin",
      name: "Wave 5 Admin",
      platformRole: "admin",
    });
    const pendingAdmin = await createUser({
      label: "pending-admin",
      name: "Wave 5 Pending Admin",
      platformRole: "admin",
    });
    const target = await createUser({
      label: "suspend-target",
      name: "Wave 5 Suspend Target",
    });
    const outsider = await createUser({
      label: "outsider",
      name: "Wave 5 Outsider",
    });
    const outsiderWorkspace = await createWorkspace(
      outsider.id,
      "Wave 5 Outsider Workspace",
      `wave5-outsider-${runId}`,
    );
    const outsiderTripId = uuidV7();
    await prisma.trip.create({
      data: {
        id: outsiderTripId,
        workspaceId: outsiderWorkspace.id,
        title: "Cross-tenant hidden trip",
        summary: "This trip must never be visible to the Web live user.",
        status: "planning",
        startDate: new Date("2027-02-01T00:00:00.000Z"),
        endDate: new Date("2027-02-05T00:00:00.000Z"),
        origin: "Osaka",
        destinations: ["Nara"],
        countryCodes: ["JP"],
        tags: ["private"],
        guestNames: [],
        visibility: "private",
        createdById: outsider.id,
        updatedById: outsider.id,
      },
    });

    const auth = betterAuth({
      appName: "Roamlog Live E2E Fixture",
      baseURL: API_URL,
      basePath: "/v1/auth",
      secret: AUTH_SECRET,
      trustedOrigins: [APP_URL, ADMIN_URL, API_URL],
      database: prismaAdapter(prisma, { provider: "postgresql" }),
      emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,
        autoSignIn: false,
      },
      plugins: [
        twoFactor({
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
        }),
      ],
      advanced: {
        useSecureCookies: false,
        cookiePrefix: "roamlog",
        defaultCookieAttributes: {
          httpOnly: true,
          secure: false,
          sameSite: "lax",
          path: "/",
        },
        database: {
          generateId: () => uuidV7(),
          validateSchema: true,
        },
      },
    }) as unknown as {
      handler(request: Request): Promise<Response>;
    };

    async function callAuth(
      path: string,
      body: Record<string, unknown>,
      cookie = "",
    ): Promise<AuthCallResult> {
      const headers = new Headers({
        origin: ADMIN_URL,
        "content-type": "application/json",
      });
      if (cookie) {
        headers.set("cookie", cookie);
      }
      const response = await auth.handler(
        new Request(`${API_URL}/v1/auth${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      );
      const text = await response.text();
      return {
        status: response.status,
        json: text ? (JSON.parse(text) as Record<string, unknown>) : {},
        cookie: cookieHeader(response.headers.getSetCookie()),
      };
    }

    const signIn = await callAuth("/sign-in/email", {
      email: admin.email,
      password: admin.password,
      rememberMe: true,
    });
    assertStatus(signIn, 200, "Admin fixture sign-in");
    if (signIn.json.twoFactorRedirect === true || !signIn.cookie) {
      throw new Error("Admin fixture unexpectedly required 2FA before enrollment.");
    }

    const enable = await callAuth(
      "/two-factor/enable",
      {
        password: admin.password,
        method: "totp",
      },
      signIn.cookie,
    );
    assertStatus(enable, 200, "Admin fixture TOTP enrollment");
    const totpUri = enable.json.totpURI;
    if (typeof totpUri !== "string") {
      throw new Error("Better Auth did not return a TOTP URI.");
    }
    const totpSecret = new URL(totpUri).searchParams.get("secret");
    if (!totpSecret) {
      throw new Error("The TOTP URI did not include a secret.");
    }

    const activeCookie = enable.cookie || signIn.cookie;
    let verify = await callAuth(
      "/two-factor/verify-totp",
      { code: currentTotp(totpSecret) },
      activeCookie,
    );
    if (verify.status === 401) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
      verify = await callAuth(
        "/two-factor/verify-totp",
        { code: currentTotp(totpSecret) },
        activeCookie,
      );
    }
    assertStatus(verify, 200, "Admin fixture TOTP verification");

    const verifiedAdmin = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    if (!verifiedAdmin.twoFactorEnabled) {
      throw new Error("Admin fixture TOTP verification did not enable 2FA.");
    }
    await prisma.session.deleteMany({ where: { userId: admin.id } });

    const webSignIn = await callAuth("/sign-in/email", {
      email: web.email,
      password: web.password,
      rememberMe: true,
    });
    assertStatus(webSignIn, 200, "Web fixture session sign-in");
    const pendingAdminSignIn = await callAuth("/sign-in/email", {
      email: pendingAdmin.email,
      password: pendingAdmin.password,
      rememberMe: true,
    });
    assertStatus(pendingAdminSignIn, 200, "Pending admin fixture session sign-in");

    const fixture: LiveFixture = {
      runId,
      generatedAt: new Date().toISOString(),
      web: {
        ...web,
        sessionCookie: webSignIn.cookie,
        workspace: webWorkspace,
      },
      admin: {
        ...admin,
        totpSecret,
      },
      pendingAdmin: {
        ...pendingAdmin,
        sessionCookie: pendingAdminSignIn.cookie,
      },
      target,
      outsider: {
        ...outsider,
        workspaceId: outsiderWorkspace.id,
        tripId: outsiderTripId,
      },
    };

    mkdirSync(dirname(FIXTURE_FILE), { recursive: true });
    writeFileSync(FIXTURE_FILE, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 });
    console.log(
      JSON.stringify({
        runId,
        webUserId: web.id,
        adminUserId: admin.id,
        targetUserId: target.id,
        outsideTripId: outsiderTripId,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
