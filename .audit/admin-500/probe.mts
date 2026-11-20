import { createPrismaClient } from "../../packages/db/src/client.js";

const url =
  process.env.PROBE_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public";
const prisma = createPrismaClient({ connectionString: url });

function show(label, err) {
  console.log(`\n=== ${label} :: THROWN ===`);
  console.log("name:", err?.constructor?.name);
  console.log(err?.message ?? String(err));
  if (err?.stack) console.log(err.stack);
  if (err?.code) console.log("prisma code:", err.code);
  if (err?.meta) console.log("meta:", JSON.stringify(err.meta));
}

const auditSelect = {
  id: true,
  actorId: true,
  actorType: true,
  action: true,
  targetType: true,
  targetId: true,
  workspaceId: true,
  ip: true,
  userAgent: true,
  metadata: true,
  createdAt: true,
};

const tripSelect = {
  id: true,
  workspaceId: true,
  title: true,
  summary: true,
  status: true,
  startDate: true,
  endDate: true,
  coverMediaId: true,
  origin: true,
  destinations: true,
  countryCodes: true,
  tags: true,
  guestNames: true,
  budgetAmountMinor: true,
  budgetCurrency: true,
  visibility: true,
  favorite: true,
  version: true,
  createdById: true,
  updatedById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
};

try {
  const rows = await prisma.auditLog.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 3,
    select: auditSelect,
  });
  console.log("\n=== auditLog.findMany OK, rows:", rows.length);
  console.log(JSON.stringify(rows[0] ?? null, null, 1));
} catch (err) {
  show("auditLog.findMany", err);
}

const ws = await prisma.workspace.findMany({ select: { id: true, name: true, slug: true }, take: 5 });
console.log("\n=== workspaces:", JSON.stringify(ws));

const wsId = process.argv[2] ?? ws[0]?.id;
try {
  const rows = await prisma.trip.findMany({
    where: { workspaceId: wsId },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 3,
    select: tripSelect,
  });
  console.log("\n=== trip.findMany OK, rows:", rows.length, "workspaceId:", wsId);
} catch (err) {
  show("trip.findMany", err);
}

try {
  const cols = await prisma.$queryRawUnsafe(
    "select table_name, column_name, data_type from information_schema.columns where table_schema='public' and table_name in ('AuditLog','Trip','JournalEntry','Comment') order by table_name, ordinal_position",
  );
  console.log("\n=== information_schema sample (first 100):");
  console.log(
    (cols ?? [])
      .slice(0, 200)
      .map((c) => `${c.table_name}.${c.column_name}:${c.data_type}`)
      .join("\n"),
  );
} catch (err) {
  show("information_schema", err);
}

await prisma.$disconnect();