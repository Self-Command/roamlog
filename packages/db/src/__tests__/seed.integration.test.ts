import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../client.js";
import { buildSeedDataset } from "../seed-data.js";
import { seedDemoData } from "../../seed.js";

const testDatabaseUrl = process.env.ROAMLOG_TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

if (!testDatabaseUrl) {
  process.stderr.write(
    "SKIPPED seed integration test: ROAMLOG_TEST_DATABASE_URL is not set. " +
      "Apply migrations, set the URL, and rerun to exercise a real PostgreSQL database.\n",
  );
}

integration("seedDemoData against PostgreSQL", () => {
  const prisma = createPrismaClient({ connectionString: testDatabaseUrl });
  const data = buildSeedDataset();

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("seeds twice without duplicates and keeps the workspace tenant fence intact", async () => {
    await seedDemoData(prisma, { quiet: true });
    const firstCounts = {
      members: await prisma.workspaceMember.count({
        where: { workspaceId: data.workspace.id },
      }),
      trips: await prisma.trip.count({
        where: { workspaceId: data.workspace.id },
      }),
      entries: await prisma.journalEntry.count({
        where: { workspaceId: data.workspace.id },
      }),
      media: await prisma.media.count({
        where: { workspaceId: data.workspace.id },
      }),
      itinerary: await prisma.itineraryItem.count({
        where: { workspaceId: data.workspace.id },
      }),
      expenses: await prisma.expense.count({
        where: { workspaceId: data.workspace.id },
      }),
      packing: await prisma.packingItem.count({
        where: { workspaceId: data.workspace.id },
      }),
      comments: await prisma.comment.count({
        where: { workspaceId: data.workspace.id },
      }),
      activities: await prisma.activity.count({
        where: { workspaceId: data.workspace.id },
      }),
      shareLinks: await prisma.shareLink.count({
        where: { workspaceId: data.workspace.id },
      }),
    };

    await seedDemoData(prisma, { quiet: true });
    const secondCounts = {
      members: await prisma.workspaceMember.count({
        where: { workspaceId: data.workspace.id },
      }),
      trips: await prisma.trip.count({
        where: { workspaceId: data.workspace.id },
      }),
      entries: await prisma.journalEntry.count({
        where: { workspaceId: data.workspace.id },
      }),
      media: await prisma.media.count({
        where: { workspaceId: data.workspace.id },
      }),
      itinerary: await prisma.itineraryItem.count({
        where: { workspaceId: data.workspace.id },
      }),
      expenses: await prisma.expense.count({
        where: { workspaceId: data.workspace.id },
      }),
      packing: await prisma.packingItem.count({
        where: { workspaceId: data.workspace.id },
      }),
      comments: await prisma.comment.count({
        where: { workspaceId: data.workspace.id },
      }),
      activities: await prisma.activity.count({
        where: { workspaceId: data.workspace.id },
      }),
      shareLinks: await prisma.shareLink.count({
        where: { workspaceId: data.workspace.id },
      }),
    };

    expect(secondCounts).toEqual(firstCounts);
    expect(firstCounts).toMatchObject({
      members: 3,
      trips: 9,
      entries: 16,
      media: 24,
      itinerary: 30,
      expenses: 20,
      packing: 30,
      comments: 8,
      activities: 10,
      shareLinks: 1,
    });

    const owners = await prisma.workspaceMember.findMany({
      where: {
        workspaceId: data.workspace.id,
        role: "owner",
        status: "active",
      },
      select: { userId: true },
    });
    expect(owners).toEqual([{ userId: data.workspace.ownerId }]);

    const scopedCounts = await Promise.all([
      prisma.workspaceMember.count({
        where: { NOT: { workspaceId: data.workspace.id } },
      }),
      prisma.trip.count({ where: { NOT: { workspaceId: data.workspace.id } } }),
      prisma.journalEntry.count({
        where: { NOT: { workspaceId: data.workspace.id } },
      }),
      prisma.media.count({ where: { NOT: { workspaceId: data.workspace.id } } }),
      prisma.expense.count({
        where: { NOT: { workspaceId: data.workspace.id } },
      }),
    ]);
    expect(scopedCounts).toEqual([0, 0, 0, 0, 0]);
  });
});
