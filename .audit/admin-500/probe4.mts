import { createPrismaClient } from "../../packages/db/src/client.js";

const prisma = createPrismaClient({
  connectionString:
    process.env.PROBE_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55444/roamlog_ci?schema=public",
});

const migrations = await prisma.$queryRawUnsafe(
  `select migration_name, finished_at from "_prisma_migrations" order by finished_at`,
);
console.log("migrations:", migrations.length);
for (const m of migrations) console.log(m.migration_name, m.finished_at?.toISOString?.() ?? m.finished_at);
const tables = await prisma.$queryRawUnsafe(
  `select table_name from information_schema.tables where table_schema='public' order by table_name`,
);
console.log("tables:", tables.map((t) => t.table_name).join(", "));
const counts = await prisma.$queryRawUnsafe(
  `select (select count(*) from "AuditLog")::int as audit, (select count(*) from "Trip")::int as trip, (select count(*) from "Workspace")::int as ws, (select count(*) from "User")::int as users`,
);
console.log("counts:", JSON.stringify(counts));
await prisma.$disconnect();