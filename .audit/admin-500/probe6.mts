import { createPrismaClient } from "../../packages/db/src/client.js";

const urls = [
  "postgresql://roamlog:roamlog@localhost:5432/roamlog?schema=public",
  "postgresql://roamlog:roamlog@127.0.0.1:5432/roamlog?schema=public",
  "postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public",
];

for (const url of urls) {
  const prisma = createPrismaClient({ connectionString: url });
  try {
    const rows = await prisma.$queryRawUnsafe(
      `select count(*)::int as total,
              count(*) filter (where "targetId"::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')::int as non_rfc
       from "AuditLog"`,
    );
    const ws = await prisma.$queryRawUnsafe(
      `select id::text, name from "Workspace" order by "createdAt" limit 3`,
    );
    console.log(url, "->", JSON.stringify(rows), JSON.stringify(ws));
  } catch (err) {
    console.log(url, "-> ERROR:", err.message.split("\n")[0]);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}