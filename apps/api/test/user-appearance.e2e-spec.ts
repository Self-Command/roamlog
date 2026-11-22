import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createPrismaClient } from "@roamlog/db";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SessionGuard } from "../src/common/guards/session.guard.js";
import { VerifiedEmailGuard } from "../src/common/guards/verified-email.guard.js";
import { AppConfigService } from "../src/config/app-config.service.js";
import { AuditService } from "../src/modules/audit/audit.service.js";
import { PrismaService } from "../src/modules/prisma/prisma.service.js";
import { SettingsService } from "../src/modules/settings/settings.service.js";
import { AppearanceController } from "../src/modules/users/appearance.controller.js";
import { AppearanceService } from "../src/modules/users/appearance.service.js";
import { NOW, makeActor } from "./identity-fixtures.js";

const databaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;

if (!databaseUrl) {
  process.stderr.write(
    "SKIPPED user appearance PostgreSQL persistence test: ROAMLOG_TEST_DATABASE_URL is not set.\n",
  );
}

function uuidV7(): string {
  const hex = randomUUID().replaceAll("-", "");
  const timestamp = Date.now().toString(16).padStart(12, "0").slice(-12);
  const variant = (8 + (Number.parseInt(hex[16] ?? "0", 16) % 4)).toString(16);
  return `${timestamp.slice(0, 8)}-${timestamp.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

interface Row {
  userId: string;
  mode: string | null;
  skin: string | null;
  fontPairing: string | null;
  updatedAt: Date;
}

describe("user appearance routes", () => {
  let app: INestApplication;
  let row: Row | null = null;
  const actor = makeActor();

  beforeAll(async () => {
    const delegate = {
      findUnique: vi.fn(async () => row),
      upsert: vi.fn(
        async (args: {
          create: Omit<Row, "updatedAt">;
          update: Partial<Omit<Row, "userId" | "updatedAt">>;
        }) => {
          row = row
            ? { ...row, ...args.update, updatedAt: NOW }
            : { ...args.create, updatedAt: NOW };
          return row;
        },
      ),
      deleteMany: vi.fn(async () => {
        const count = row ? 1 : 0;
        row = null;
        return { count };
      }),
    };
    const prisma = {
      client: {
        userAppearancePreference: delegate,
        $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
          callback({ userAppearancePreference: delegate }),
        ),
      },
    };
    const settings = {
      getGroup: vi.fn(async () => ({
        "theme.defaultSkin": "editorial-noir",
        "theme.defaultMode": "system",
        "theme.defaultFont": "editorial-classic",
        "theme.allowUserOverride": true,
      })),
    };
    const audit = { record: vi.fn(async () => ({ id: "audit-id" })) };

    const moduleRef = await Test.createTestingModule({
      controllers: [AppearanceController],
      providers: [
        AppearanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettingsService, useValue: settings },
        { provide: AuditService, useValue: audit },
        {
          provide: AppConfigService,
          useValue: { isProduction: false, apiUrl: "http://localhost:4000" },
        },
      ],
    })
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => { headers: Record<string, string>; user?: unknown };
          };
        }) => {
          const httpRequest = context.switchToHttp().getRequest();
          if (httpRequest.headers["x-test-auth"] !== "1") {
            throw new UnauthorizedException({
              code: "UNAUTHENTICATED",
              message: "A valid session is required.",
            });
          }
          httpRequest.user = actor.user;
          return true;
        },
      })
      .overrideGuard(VerifiedEmailGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix("v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires an authenticated session", async () => {
    await request(app.getHttpServer()).get("/v1/me/appearance").expect(401);
  });

  it("returns defaults, persists a PUT, sets a cookie, and resets", async () => {
    const initial = await request(app.getHttpServer())
      .get("/v1/me/appearance")
      .set("x-test-auth", "1")
      .expect(200);
    expect(initial.body).toMatchObject({
      mode: "system",
      skin: "editorial-noir",
      fontPairing: "editorial-classic",
      source: "platform",
    });

    const updated = await request(app.getHttpServer())
      .put("/v1/me/appearance")
      .set("x-test-auth", "1")
      .send({ mode: "light", skin: "kanagawa" })
      .expect(200);
    expect(updated.body).toMatchObject({
      mode: "light",
      skin: "kanagawa",
      source: "user",
    });
    expect(String(updated.headers["set-cookie"])).toContain("roamlog_appearance=");
    expect(row).toMatchObject({ userId: actor.user.id, mode: "light", skin: "kanagawa" });

    const persisted = await request(app.getHttpServer())
      .get("/v1/me/appearance")
      .set("x-test-auth", "1")
      .expect(200);
    expect(persisted.body).toMatchObject({ mode: "light", skin: "kanagawa", source: "user" });

    const reset = await request(app.getHttpServer())
      .delete("/v1/me/appearance")
      .set("x-test-auth", "1")
      .expect(200);
    expect(reset.body).toMatchObject({ mode: "system", source: "platform" });
    expect(row).toBeNull();
    expect(String(reset.headers["set-cookie"])).toContain("roamlog_appearance=;");
  });

  it("rejects invalid appearance IDs with field errors", async () => {
    const response = await request(app.getHttpServer())
      .put("/v1/me/appearance")
      .set("x-test-auth", "1")
      .send({ skin: "not-a-skin" })
      .expect(422);
    expect(response.body).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

databaseDescribe("user appearance PostgreSQL persistence", () => {
  if (!databaseUrl) {
    return;
  }
  const prisma = createPrismaClient({ connectionString: databaseUrl });
  const database = { client: prisma } as never;
  const actor = makeActor(uuidV7(), {
    email: `appearance-${randomUUID()}@roamlog.test`,
  });
  const settings = {
    getGroup: vi.fn(async () => ({
      "theme.defaultSkin": "editorial-noir",
      "theme.defaultMode": "system",
      "theme.defaultFont": "editorial-classic",
      "theme.allowUserOverride": true,
    })),
  };
  const audit = new AuditService(database, {} as never);
  const service = new AppearanceService(database, settings as never, audit);

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.create({
      data: {
        id: actor.user.id,
        email: actor.user.email,
        emailVerified: true,
        name: actor.user.name,
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.auditLog.deleteMany({ where: { actorId: actor.user.id } });
      await prisma.user.deleteMany({ where: { id: actor.user.id } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("writes, reads, clears and resets the preference with audit evidence", async () => {
    const updated = await service.update(actor, { mode: "light", skin: "kanagawa" });
    expect(updated.appearance).toMatchObject({
      mode: "light",
      skin: "kanagawa",
      source: "user",
    });

    const row = await prisma.userAppearancePreference.findUnique({
      where: { userId: actor.user.id },
    });
    expect(row).toMatchObject({ mode: "light", skin: "kanagawa", fontPairing: null });

    const auditRow = await prisma.auditLog.findFirst({
      where: { actorId: actor.user.id, action: "user.appearance.updated" },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow?.metadata).toMatchObject({ changedFields: ["mode", "skin"] });

    const persisted = await service.get(actor);
    expect(persisted.appearance).toMatchObject({
      mode: "light",
      skin: "kanagawa",
      source: "user",
    });

    const cleared = await service.update(actor, { mode: null });
    expect(cleared.appearance).toMatchObject({ mode: "system", skin: "kanagawa" });

    const reset = await service.reset(actor);
    expect(reset.appearance).toMatchObject({ source: "platform" });
    await expect(
      prisma.userAppearancePreference.findUnique({ where: { userId: actor.user.id } }),
    ).resolves.toBeNull();
  });
});
