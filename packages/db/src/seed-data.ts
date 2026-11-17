import { users, workspace, members, invitations } from "./seed/core.js";
import {
  entries,
  entryMedia,
  media,
  revisions,
} from "./seed/entries.js";
import { expenses, packingItems } from "./seed/finance.js";
import {
  commentMentions,
  comments,
  itineraryItems,
} from "./seed/itinerary.js";
import {
  activities,
  auditLogs,
  emailLogs,
  exports,
  featureFlags,
  notificationPreferences,
  notifications,
  shareLinks,
} from "./seed/operations.js";
import {
  stops,
  tripParticipants,
  trips,
} from "./seed/trips.js";
import type { SeedDataset, SeedTrip } from "./seed/types.js";

export type {
  SeedActivity,
  SeedAuditLog,
  SeedEmailLog,
  SeedEntry,
  SeedEntryMedia,
  SeedExpense,
  SeedExpenseParticipant,
  SeedExport,
  SeedFeatureFlag,
  SeedInvitation,
  SeedItineraryItem,
  SeedMedia,
  SeedMember,
  SeedNotification,
  SeedNotificationPreference,
  SeedPackingItem,
  SeedShareLink,
  SeedStop,
  SeedTrip,
  SeedTripParticipant,
  SeedUser,
  SeedWorkspace,
  SeedDataset,
  TiptapDoc,
  TiptapNode,
  WorkspaceScopedFixture,
} from "./seed/types.js";

export { seedAssetFiles } from "./seed/assets.js";
export { userIds, workspaceId } from "./seed/core.js";
export {
  demoShareTokenHash,
  deterministicId,
} from "./seed/util.js";

function attachCovers(): SeedTrip[] {
  return trips.map((trip) => {
    const cover = media.find((item) => item.tripId === trip.id);
    return { ...trip, coverMediaId: cover?.id ?? null };
  });
}

export function buildSeedDataset(): SeedDataset {
  return structuredClone({
    users,
    workspace,
    members,
    invitations,
    trips: attachCovers(),
    tripParticipants,
    stops,
    entries,
    revisions,
    media,
    entryMedia,
    itineraryItems,
    comments,
    commentMentions,
    activities,
    expenses,
    packingItems,
    shareLinks,
    notifications,
    notificationPreferences,
    auditLogs,
    featureFlags,
    emailLogs,
    exports,
  });
}

export const seedDataset = buildSeedDataset();
