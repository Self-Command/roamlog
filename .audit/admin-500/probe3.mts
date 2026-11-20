import { createPrismaClient } from "../../packages/db/src/client.js";
import { auditSelect } from "../../apps/api/src/modules/admin/admin-selects.js";

const prisma = createPrismaClient({
  connectionString:
    process.env.PROBE_DATABASE_URL ??
    "postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public",
});

const rows = await prisma.auditLog.findMany({
  orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  take: 200,
  select: auditSelect,
});
const re =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
const bad = rows.filter((r) => !re.test(r.targetId));
console.log("total audit rows:", rows.length, "non-conforming targetId:", bad.length);
for (const r of bad.slice(0, 10)) {
  console.log(
    "id=%s action=%s targetType=%s targetId=%s createdAt=%s",
    r.id,
    r.action,
    r.targetType,
    r.targetId,
    r.createdAt.toISOString(),
  );
}
const groups = new Map();
for (const r of bad) {
  const k = `${r.action} | targetType=${r.targetType} | targetId=${r.targetId}`;
  groups.set(k, (groups.get(k) ?? 0) + 1);
}
console.log("\ngroups:");
for (const [k, v] of groups) console.log(v, k);

const all = await prisma.$queryRawUnsafe(
  `select "action", "targetType", "targetId"::text as tid from "AuditLog" order by "createdAt" desc`,
);
console.log("\nraw count:", all.length);
const badRaw = all.filter((r) => !re.test(r.tid));
console.log("raw non-conforming:", badRaw.length, JSON.stringify(badRaw.slice(0, 5)));

await prisma.$disconnect();