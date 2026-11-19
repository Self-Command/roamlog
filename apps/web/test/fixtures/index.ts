import {
  demoActivities,
  demoComments,
  demoEntries,
  demoExpenses,
  demoItineraryItems,
  demoMedia,
  demoNotifications,
  demoStops,
} from "./content";
import { demoMembers, demoUser, demoUsers, demoWorkspaces } from "./people";
import { demoTrips } from "./trips";

export * from "./ids";
export * from "./people";
export * from "./trips";
export * from "./content";

/**
 * One schema-validated snapshot for tests that need several collections at
 * once (public share rendering, adapter round-trips).
 *
 * Shape note: the retired shared fixture also carried `invitations`,
 * `packing` and `itineraries`. No web suite reads them, so they are not
 * reproduced here.
 */
export const demoFixtureState = {
  me: demoUser,
  workspaces: demoWorkspaces,
  trips: demoTrips,
  users: demoUsers,
  members: demoMembers,
  entries: demoEntries,
  media: demoMedia,
  itinerary: demoItineraryItems,
  stops: demoStops,
  expenses: demoExpenses,
  comments: demoComments,
  activities: demoActivities,
  notifications: demoNotifications,
} as const;