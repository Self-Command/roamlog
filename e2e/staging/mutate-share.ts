import { createPrismaClient } from "../../packages/db/src/client";

const shareLinkId = process.argv[2];
if (!shareLinkId) {
  throw new Error("Usage: mutate-share.ts <share-link-id>");
}

async function main(): Promise<void> {
  const prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL });
  try {
    await prisma.shareLink.update({
      where: { id: shareLinkId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    console.log(`Expired share link ${shareLinkId}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
