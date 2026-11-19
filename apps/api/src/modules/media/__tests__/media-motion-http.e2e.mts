/**
 * D2 Live Photo HTTP harness.
 *
 * Boots a real Nest HTTP server on 127.0.0.1:4230 with the production Media,
 * Trips, Prisma, Redis, Storage and queue wiring against the isolated `d2_e2e`
 * PostgreSQL schema and the local MinIO bucket, then drives the whole Live Photo
 * loop with `fetch` and real object uploads:
 *
 *   presign still → PUT still → complete still
 *   presign motion → PUT motion → POST /motion
 *   GET media (livePhoto + signed motion url)
 *   GET as a member of another workspace (404)
 *   DELETE media → GET 404 + MediaMotion soft-deleted
 *
 * Authentication is injected through the same `x-test-user` SessionGuard seam the
 * other API E2E harnesses use, because the focus here is the Live Photo
 * lifecycle rather than better-auth enrollment.
 *
 * Not part of the unit suite (`*.mts`, not `*.test.ts`). Run:
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=d2_e2e \
 *   REDIS_URL=redis://localhost:6379 \
 *   S3_ENDPOINT=http://localhost:9000 S3_BUCKET=roamlog-local \
 *   S3_ACCESS_KEY=roamlog S3_SECRET_KEY=roamlog-local-secret \
 *   node --import tsx src/modules/media/__tests__/media-motion-http.e2e.mts
 */
import { UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createPrismaClient } from "@roamlog/db";

import { configureApp } from "../../../bootstrap/configure-app.js";
import { AppConfigModule } from "../../../config/app-config.module.js";
import { SessionGuard } from "../../../common/guards/session.guard.js";
import { SanitizeModule } from "../../../common/services/sanitize.module.js";
import { ActivitiesModule } from "../../activities/activities.module.js";
import { AuditModule } from "../../audit/audit.module.js";
import { EmailModule } from "../../email/mail.module.js";
import { PrismaModule } from "../../prisma/prisma.module.js";
import { RedisModule } from "../../redis/redis.module.js";
import { SecurityModule } from "../../../common/security/security.module.js";
import { AccessControlModule } from "../../../common/guards/access-control.module.js";
import { StorageModule } from "../../storage/storage.module.js";
import { TripsModule } from "../../trips/trips.module.js";
import { MediaModule } from "../media.module.js";

const databaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
if (!databaseUrl) {
  console.error("ROAMLOG_TEST_DATABASE_URL is required");
  process.exit(2);
}

const prisma = createPrismaClient({ connectionString: databaseUrl });
const API = "http://127.0.0.1:4230";
const ids = {
  alice: "01942f30-1200-7000-8000-0000000d0001",
  bob: "01942f30-1200-7000-8000-0000000d0002",
  workspaceA: "01942f30-1200-7000-8000-0000000d0011",
  workspaceB: "01942f30-1200-7000-8000-0000000d0012",
  memberA: "01942f30-1200-7000-8000-0000000d0021",
  memberB: "01942f30-1200-7000-8000-0000000d0022",
};

interface Json {
  [key: string]: unknown;
}

function log(step: string, status: number, body: unknown): void {
  const printable =
    typeof body === "string" ? body.slice(0, 500) : JSON.stringify(body).slice(0, 900);
  console.log(`\n## ${step}\nHTTP ${status}\n${printable}`);
}

async function call(
  who: "alice" | "bob",
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Json }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      "x-test-user": who,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed: Json = {};
  try {
    parsed = text ? (JSON.parse(text) as Json) : {};
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

async function main(): Promise<void> {
  await prisma.$connect();
  const now = new Date("2026-11-19T08:00:00.000Z");

  // Typed deletes only: the driver adapter keeps `?schema=` on the ORM path, and
  // raw SQL would silently hit another search_path.
  await prisma.mediaMotion.deleteMany({
    where: { media: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } } },
  });
  await prisma.media.deleteMany({
    where: { workspaceId: { in: [ids.workspaceA, ids.workspaceB] } },
  });
  await prisma.workspace.deleteMany({ where: { id: { in: [ids.workspaceA, ids.workspaceB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.alice, ids.bob] } } });

  await prisma.$transaction(async (tx) => {
    for (const [id, email, name] of [
      [ids.alice, "alice@d2.roamlog.test", "Alice"],
      [ids.bob, "bob@d2.roamlog.test", "Bob"],
    ] as const) {
      await tx.user.create({
        data: { id, email, name, emailVerified: true, platformRole: "user", createdAt: now, updatedAt: now },
      });
    }
    for (const [id, name, slug, ownerId] of [
      [ids.workspaceA, "D2 Workspace A", "d2-e2e-a", ids.alice],
      [ids.workspaceB, "D2 Workspace B", "d2-e2e-b", ids.bob],
    ] as const) {
      await tx.workspace.create({ data: { id, name, slug, ownerId, createdAt: now, updatedAt: now } });
    }
    await tx.workspaceMember.create({
      data: { id: ids.memberA, workspaceId: ids.workspaceA, userId: ids.alice, role: "owner", createdAt: now, updatedAt: now },
    });
    await tx.workspaceMember.create({
      data: { id: ids.memberB, workspaceId: ids.workspaceB, userId: ids.bob, role: "owner", createdAt: now, updatedAt: now },
    });
  });

  const moduleRef = await Test.createTestingModule({
    imports: [
      AppConfigModule,
      SanitizeModule,
      PrismaModule,
      RedisModule,
      StorageModule,
      SecurityModule,
      AccessControlModule,
      ActivitiesModule,
      AuditModule,
      EmailModule,
      TripsModule,
      MediaModule,
    ],
  })
    .overrideProvider(SessionGuard)
    .useValue({
      canActivate: (context: { switchToHttp: () => { getRequest: () => Record<string, unknown> } }) => {
        const request = context.switchToHttp().getRequest() as {
          headers?: Record<string, string | undefined>;
          user?: unknown;
        };
        const who = request.headers?.["x-test-user"];
        const actors: Record<string, { id: string; email: string }> = {
          alice: { id: ids.alice, email: "alice@d2.roamlog.test" },
          bob: { id: ids.bob, email: "bob@d2.roamlog.test" },
        };
        const actor = who ? actors[who] : undefined;
        if (!actor) throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
        request.user = {
          ...actor,
          emailVerified: true,
          name: actor.id === ids.alice ? "Alice" : "Bob",
          image: null,
          platformRole: "user",
          status: "active",
          locale: "zh-CN",
          timezone: "Asia/Shanghai",
          lastActiveAt: now.toISOString(),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          deletedAt: null,
        };
        return true;
      },
    })
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.listen(4230);
  // The Redis client connects lazily with `enableOfflineQueue: false`; give it a
  // moment so the queue/RateLimit paths are warm before the first request.
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  console.log(`D2 media e2e listening on ${API}`);

  // Real image bytes: a 1x1 HEIC-branded ISO-BMFF header is enough for the magic
  // byte check; the worker is not part of this flow.
  const stillBytes = new Uint8Array([
    0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
    0x6d, 0x69, 0x66, 0x31, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65,
  ]);
  const motionBytes = new Uint8Array([
    0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0x00, 0x00, 0x02, 0x00,
    0x71, 0x74, 0x20, 0x20, 0x6d, 0x6f, 0x6f, 0x76,
  ]);

  // 1) Still: presign → PUT → complete (the existing media pipeline).
  const presign = await call("alice", "POST", `/v1/workspaces/${ids.workspaceA}/media/presign`, {
    fileName: "IMG_1234.HEIC",
    mimeType: "image/heic",
    size: stillBytes.byteLength,
  });
  log("POST /media/presign (still)", presign.status, presign.body);
  if (presign.status !== 201 && presign.status !== 200) {
    throw new Error("still presign failed");
  }
  const mediaId = String(presign.body.mediaId);
  const stillPut = await fetch(String(presign.body.uploadUrl), {
    method: "PUT",
    headers: presign.body.headers as Record<string, string>,
    body: stillBytes,
  });
  log("PUT still object", stillPut.status, { etag: stillPut.headers.get("etag") });

  const complete = await call("alice", "POST", `/v1/media/${mediaId}/complete`, {
    size: stillBytes.byteLength,
  });
  log("POST /media/{id}/complete (still)", complete.status, complete.body);
  if (complete.status !== 200) {
    throw new Error("still complete failed");
  }

  // 2) Motion: presign → PUT → completion callback.
  const motionPresign = await call(
    "alice",
    "POST",
    `/v1/workspaces/${ids.workspaceA}/media/${mediaId}/motion/presign`,
    {
      fileName: "IMG_1234.MOV",
      mimeType: "video/quicktime",
      size: motionBytes.byteLength,
      durationMs: 2400,
    },
  );
  log("POST /media/{id}/motion/presign", motionPresign.status, motionPresign.body);
  if (motionPresign.status !== 201 && motionPresign.status !== 200) {
    throw new Error("motion presign failed");
  }
  const motionPut = await fetch(String(motionPresign.body.uploadUrl), {
    method: "PUT",
    headers: motionPresign.body.headers as Record<string, string>,
    body: motionBytes,
  });
  log("PUT motion object", motionPut.status, { etag: motionPut.headers.get("etag") });

  const motionComplete = await call(
    "alice",
    "POST",
    `/v1/workspaces/${ids.workspaceA}/media/${mediaId}/motion`,
    {
      storageKey: motionPresign.body.storageKey,
      mimeType: "video/quicktime",
      sizeBytes: motionBytes.byteLength,
      durationMs: 2400,
    },
  );
  log("POST /media/{id}/motion (completion)", motionComplete.status, {
    id: motionComplete.body.id,
    livePhoto: motionComplete.body.livePhoto,
    motion: motionComplete.body.motion,
  });
  if (motionComplete.status !== 200) {
    throw new Error("motion completion failed");
  }

  const row = await prisma.mediaMotion.findFirst({ where: { mediaId } });
  log("DB MediaMotion row", 200, {
    mediaId: row?.mediaId,
    mimeType: row?.mimeType,
    sizeBytes: row?.sizeBytes,
    durationMs: row?.durationMs,
    storageKeyIsServerDerived: row?.storageKey === motionPresign.body.storageKey,
    deletedAt: row?.deletedAt,
  });

  // 3) Read back: livePhoto true and a signed motion URL.
  const read = await call("alice", "GET", `/v1/media/${mediaId}`);
  log("GET /media/{id}", read.status, read.body);
  if (read.body.livePhoto !== true) {
    throw new Error("livePhoto was not true");
  }
  const motionView = read.body.motion as { url?: unknown } | null;
  if (typeof motionView?.url !== "string" || motionView.url.length === 0) {
    throw new Error("motion.url was empty");
  }
  console.log(`\nASSERT motion.url is a signed URL: ${motionView.url.includes("X-Amz-Signature=")}`);
  console.log(`ASSERT no storage keys leaked: ${!JSON.stringify(read.body).includes("storageKey")}`);

  // 4) Tenant fence: the other workspace cannot read this media.
  const foreign = await call("bob", "GET", `/v1/media/${mediaId}`);
  log("GET /media/{id} as another workspace", foreign.status, foreign.body);

  // 5) Soft delete cascades to the motion row.
  const deleted = await call("alice", "DELETE", `/v1/media/${mediaId}`);
  log("DELETE /media/{id}", deleted.status, deleted.body);
  const afterDelete = await call("alice", "GET", `/v1/media/${mediaId}`);
  log("GET /media/{id} after delete", afterDelete.status, afterDelete.body);
  const deletedMotion = await prisma.mediaMotion.findFirst({ where: { mediaId } });
  console.log(
    `\nASSERT MediaMotion soft-deleted: ${deletedMotion?.deletedAt !== null && deletedMotion?.deletedAt !== undefined}`,
  );
  console.log(
    `ASSERT cross-workspace read refused: ${foreign.status === 403 || foreign.status === 404}`,
  );
  console.log(`ASSERT media invisible after delete: ${afterDelete.status === 404}`);

  await app.close();
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("D2 media e2e failed:", error);
  await app_cleanup();
  process.exit(1);
});

async function app_cleanup(): Promise<void> {
  await prisma.$disconnect().catch(() => undefined);
}