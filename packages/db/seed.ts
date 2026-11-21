import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrismaClient } from "./src/generated/prisma/client.js";
import { createPrismaClient } from "./src/client.js";
import {
  DEMO_SHARE_TOKEN,
} from "./src/seed/util.js";
import { applySeedData } from "./src/seed/apply.js";
import { uploadSeedAssets } from "./src/seed/upload-assets.js";
import {
  buildSeedDataset,
  type SeedDataset,
} from "./src/seed-data.js";

export interface SeedDemoDataOptions {
  quiet?: boolean;
  uploadAssets?: boolean;
}

export interface SeedSummary {
  users: number;
  members: number;
  trips: number;
  tripParticipants: number;
  stops: number;
  entries: number;
  revisions: number;
  media: number;
  itineraryItems: number;
  comments: number;
  activities: number;
  expenses: number;
  expenseParticipants: number;
  packingItems: number;
  shareLinks: number;
  notifications: number;
  notificationPreferences: number;
  auditLogs: number;
  featureFlags: number;
  emailLogs: number;
  exports: number;
}

function loadWorkspaceEnv(): void {
  const packageRoot = path.dirname(fileURLToPath(import.meta.url));
  const environmentPath = path.resolve(packageRoot, "../../.env.local");
  if (existsSync(environmentPath)) {
    process.loadEnvFile(environmentPath);
  }
}

function assertSeedAllowed(): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to seed demo data when NODE_ENV=production");
  }
  if (process.env.DEMO_SEED_ENABLED === "false") {
    throw new Error("Refusing to seed demo data because DEMO_SEED_ENABLED=false");
  }
}

function summarize(data: SeedDataset): SeedSummary {
  return {
    users: data.users.length,
    members: data.members.length,
    trips: data.trips.length,
    tripParticipants: data.tripParticipants.length,
    stops: data.stops.length,
    entries: data.entries.length,
    revisions: data.revisions.length,
    media: data.media.length,
    itineraryItems: data.itineraryItems.length,
    comments: data.comments.length,
    activities: data.activities.length,
    expenses: data.expenses.length,
    expenseParticipants: data.expenses.reduce(
      (total, expense) => total + expense.participants.length,
      0,
    ),
    packingItems: data.packingItems.length,
    shareLinks: data.shareLinks.length,
    notifications: data.notifications.length,
    notificationPreferences: data.notificationPreferences.length,
    auditLogs: data.auditLogs.length,
    featureFlags: data.featureFlags.length,
    emailLogs: data.emailLogs.length,
    exports: data.exports.length,
  };
}

function printSummary(summary: SeedSummary): void {
  const formatted = Object.entries(summary)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.log(`Roamlog demo seed complete (local/staging fixtures): ${formatted}`);
}

export async function seedDemoData(
  prisma: PrismaClient,
  options: SeedDemoDataOptions = {},
): Promise<SeedSummary> {
  assertSeedAllowed();
  const data = buildSeedDataset();

  const shouldUpload =
    options.uploadAssets ?? process.env.ROAMLOG_SEED_S3_UPLOAD === "true";
  if (shouldUpload) {
    await uploadSeedAssets(data, !options.quiet);
  }

  await prisma.$transaction(
    async (transaction) => applySeedData(transaction, data),
    {
      maxWait: 15_000,
      timeout: 120_000,
    },
  );

  const summary = summarize(data);
  if (!options.quiet) {
    printSummary(summary);
    if (process.env.ROAMLOG_SEED_PRINT_SHARE_TOKEN === "true") {
      console.log(
        `Demo public share token (shown once, store only its hash): ${DEMO_SHARE_TOKEN}`,
      );
    }
  }
  return summary;
}

loadWorkspaceEnv();

const invokedFile = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (import.meta.url === invokedFile) {
  const prisma = createPrismaClient();
  try {
    await seedDemoData(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
