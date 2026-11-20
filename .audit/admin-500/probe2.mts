import { createPrismaClient } from "../../packages/db/src/client.js";
import { presentAdminAuditLog } from "../../apps/api/src/modules/admin/admin.presenters.js";
import { presentTrip } from "../../apps/api/src/modules/trips/content-presenters.js";
import { toCursorPage } from "../../apps/api/src/common/services/cursor-page.js";
import { auditSelect, tripSelect } from "../../apps/api/src/modules/admin/admin-selects.js";

const url =
  process.env.PROBE_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:55444/roamlog_local?schema=public";
const prisma = createPrismaClient({ connectionString: url });

function show(label, err) {
  console.log(`\n=== ${label} :: THROWN ===`);
  console.log("name:", err?.constructor?.name);
  console.log("message:", err?.message ?? String(err));
  if (err?.stack) console.log(err.stack);
  if (err?.code) console.log("code:", err.code);
  if (err?.meta) console.log("meta:", JSON.stringify(err.meta));
}

const auditRows = await prisma.auditLog.findMany({
  orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  take: 51,
  select: auditSelect,
});
console.log("audit rows fetched:", auditRows.length);
for (const [i, row] of auditRows.entries()) {
  try {
    presentAdminAuditLog(row);
  } catch (err) {
    console.log(`\n--- audit row #${i} id=${row.id} present failed`);
    show(`presentAdminAuditLog #${i}`, err);
    break;
  }
}
try {
  const page = toCursorPage(auditRows, 50, presentAdminAuditLog);
  console.log("toCursorPage audit OK items:", page.items.length);
} catch (err) {
  show("toCursorPage audit", err);
}

const ws = await prisma.workspace.findMany({ take: 3, select: { id: true } });
for (const w of ws) {
  const tripRows = await prisma.trip.findMany({
    where: { workspaceId: w.id },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: 51,
    select: tripSelect,
  });
  console.log(`\nworkspace ${w.id} trip rows: ${tripRows.length}`);
  for (const [i, row] of tripRows.entries()) {
    try {
      presentTrip(row);
    } catch (err) {
      console.log(`--- trip row #${i} id=${row.id} present failed`);
      show(`presentTrip #${i}`, err);
      console.log("row:", JSON.stringify(row, null, 1));
      break;
    }
  }
  try {
    const page = toCursorPage(tripRows, 50, presentTrip);
    console.log("toCursorPage trips OK items:", page.items.length);
  } catch (err) {
    show("toCursorPage trips", err);
  }
}

await prisma.$disconnect();