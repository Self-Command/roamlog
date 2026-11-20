import { createPrismaClient } from "../../packages/db/src/client.js";

const prisma = createPrismaClient({
  connectionString:
    process.env.PROBE_DATABASE_URL ??
    "postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public",
});

const audit = await prisma.$queryRawUnsafe(
  `select count(*)::int as total,
          count(*) filter (where "targetId"::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')::int as non_rfc,
          md5(string_agg("id"::text || '|' || "targetId"::text || '|' || "createdAt"::text, ',' order by "id")) as checksum
   from "AuditLog"`,
);
const trips = await prisma.$queryRawUnsafe(
  `select "workspaceId"::text as ws, count(*)::int as n
   from "Trip" group by 1 order by 2 desc`,
);
const tripTotal = await prisma.$queryRawUnsafe(`select count(*)::int as n from "Trip"`);
const variant = await prisma.$queryRawUnsafe(
  `select "id"::text, "action", "targetType", "targetId"::text, "metadata"->>'runId' as run_id
   from "AuditLog" where "targetId"::text like '726d652a%' limit 1`,
);
console.log("AuditLog:", JSON.stringify(audit));
console.log("Trip total:", JSON.stringify(tripTotal), "by workspace:", JSON.stringify(trips));
console.log("variant row:", JSON.stringify(variant));
await prisma.$disconnect();