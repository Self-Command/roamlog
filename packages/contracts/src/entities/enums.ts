import { z } from "zod";

export const AccountStatusSchema = z.enum(["active", "suspended", "deleted"]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const WorkspacePlanSchema = z.enum(["free", "pro", "team"]);
export type WorkspacePlan = z.infer<typeof WorkspacePlanSchema>;

export const MemberStatusSchema = z.enum(["active", "suspended"]);
export type MemberStatus = z.infer<typeof MemberStatusSchema>;

export const TripStatusSchema = z.enum([
  "wishlist",
  "planning",
  "upcoming",
  "active",
  "completed",
]);
export type TripStatus = z.infer<typeof TripStatusSchema>;

/**
 * Who may read a trip. `custom` means "only the creator plus the principals
 * listed in `TripAccessGrant`" and is the only tier that consults grants;
 * `public_link` keeps its own anonymous share-link path and is independent of
 * both grants and participants.
 */
export const TripVisibilitySchema = z.enum(["workspace", "private", "public_link", "custom"]);
export type TripVisibility = z.infer<typeof TripVisibilitySchema>;

/** Lifecycle of an invitation to a trip. `invited` and `joined` both grant read access. */
export const ParticipantStatusSchema = z.enum(["invited", "joined", "declined"]);
export type ParticipantStatus = z.infer<typeof ParticipantStatusSchema>;

/** What a participant may do inside the trip once they have access. */
export const ParticipantRoleSchema = z.enum(["viewer", "editor"]);
export type ParticipantRole = z.infer<typeof ParticipantRoleSchema>;

/** A `custom` trip audience entry targets either a whole workspace or one user. */
export const TripAccessGrantTargetTypeSchema = z.enum(["workspace", "user"]);
export type TripAccessGrantTargetType = z.infer<typeof TripAccessGrantTargetTypeSchema>;

export const MoodSchema = z.enum(["calm", "happy", "awe", "tired", "reflective", "excited"]);
export type Mood = z.infer<typeof MoodSchema>;

export const WeatherSchema = z.enum(["sunny", "cloudy", "rain", "snow", "wind", "fog"]);
export type Weather = z.infer<typeof WeatherSchema>;

export const ItineraryItemTypeSchema = z.enum(["transit", "food", "activity", "stay", "note"]);
export type ItineraryItemType = z.infer<typeof ItineraryItemTypeSchema>;

export const CommentTargetTypeSchema = z.enum(["journal_entry", "itinerary_item"]);
export type CommentTargetType = z.infer<typeof CommentTargetTypeSchema>;

export const MediaStatusSchema = z.enum(["pending", "processing", "ready", "failed"]);
export type MediaStatus = z.infer<typeof MediaStatusSchema>;

export const ExpenseCategorySchema = z.enum([
  "transport",
  "stay",
  "food",
  "activity",
  "shopping",
  "other",
]);
export type ExpenseCategory = z.infer<typeof ExpenseCategorySchema>;

export const PackingCategorySchema = z.enum([
  "documents",
  "clothing",
  "gear",
  "health",
  "other",
]);
export type PackingCategory = z.infer<typeof PackingCategorySchema>;

export const AuditActorTypeSchema = z.enum(["user", "admin", "system"]);
export type AuditActorType = z.infer<typeof AuditActorTypeSchema>;

export const EmailStatusSchema = z.enum([
  "queued",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
]);
export type EmailStatus = z.infer<typeof EmailStatusSchema>;

export const ExportScopeSchema = z.enum(["trip", "workspace", "account"]);
export type ExportScope = z.infer<typeof ExportScopeSchema>;

export const ExportFormatSchema = z.enum(["zip", "json"]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export const ExportStatusSchema = z.enum([
  "queued",
  "processing",
  "ready",
  "failed",
  "expired",
]);
export type ExportStatus = z.infer<typeof ExportStatusSchema>;

export const NotificationTypeSchema = z.string().min(1).max(64);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const TimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .describe("Local wall-clock time in HH:mm form.");
export type TimeOfDay = z.infer<typeof TimeOfDaySchema>;
