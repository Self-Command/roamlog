export type IsoDate = string;
export type IsoTimestamp = string;

export interface TiptapNode {
  type: string;
  content?: TiptapNode[];
  text?: string;
  attrs?: Record<string, unknown>;
}

export interface TiptapDoc {
  type: "doc";
  content: TiptapNode[];
}

export interface WorkspaceScopedFixture {
  workspaceId: string;
}

export interface IdentifiedWorkspaceFixture extends WorkspaceScopedFixture {
  id: string;
}

export interface SeedUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string;
  image: string | null;
  platformRole: "user" | "support" | "analyst" | "admin" | "super_admin";
  status: "active" | "suspended" | "deleted";
  locale: string;
  timezone: string;
  lastActiveAt: IsoTimestamp;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface SeedWorkspace {
  id: string;
  name: string;
  slug: string;
  logoMediaId: string | null;
  ownerId: string;
  plan: "free" | "pro" | "team";
  status: "active" | "suspended" | "deleted";
  defaultCurrency: string;
  timezone: string;
  weekStartsOn: number;
  settings: Record<string, unknown>;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface SeedMember extends IdentifiedWorkspaceFixture {
  userId: string;
  role: "owner" | "admin" | "editor" | "viewer";
  status: "active" | "suspended";
  joinedAt: IsoTimestamp;
  invitedById: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface SeedInvitation extends IdentifiedWorkspaceFixture {
  email: string;
  role: "admin" | "editor" | "viewer";
  tokenHash: string;
  invitedById: string;
  expiresAt: IsoTimestamp;
  acceptedAt: IsoTimestamp | null;
  revokedAt: IsoTimestamp | null;
  createdAt: IsoTimestamp;
}

export interface SeedTrip extends IdentifiedWorkspaceFixture {
  title: string;
  summary: string;
  country: string;
  status: "wishlist" | "planning" | "upcoming" | "active" | "completed";
  startDate: IsoDate;
  endDate: IsoDate;
  coverMediaId: string | null;
  origin: string;
  destinations: string[];
  countryCodes: string[];
  tags: string[];
  guestNames: string[];
  budgetAmountMinor: number;
  budgetCurrency: string;
  visibility: "workspace" | "private" | "public_link";
  favorite: boolean;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export interface SeedTripParticipant extends IdentifiedWorkspaceFixture {
  tripId: string;
  userId: string;
  joinedAt: IsoTimestamp;
}

export interface SeedStop extends IdentifiedWorkspaceFixture {
  tripId: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number | null;
  lng: number | null;
  startDate: IsoDate;
  endDate: IsoDate;
  notes: string;
  order: number;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export interface SeedEntry extends IdentifiedWorkspaceFixture {
  tripId: string;
  title: string;
  date: IsoDate;
  location: string;
  lat: number | null;
  lng: number | null;
  mood: "calm" | "happy" | "awe" | "tired" | "reflective" | "excited";
  weather: "sunny" | "cloudy" | "rain" | "snow" | "wind" | "fog";
  contentJson: TiptapDoc;
  contentHtml: string;
  excerpt: string;
  tags: string[];
  favorite: boolean;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export interface SeedRevision extends IdentifiedWorkspaceFixture {
  entryId: string;
  version: number;
  title: string;
  contentJson: TiptapDoc;
  contentHtml: string;
  editedById: string;
  createdAt: IsoTimestamp;
}

export interface SeedMedia extends IdentifiedWorkspaceFixture {
  tripId: string;
  uploaderId: string;
  bucket: string;
  key: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  blurhash: string | null;
  variants: Record<string, unknown>;
  status: "pending" | "processing" | "ready" | "failed";
  error: string | null;
  caption: string | null;
  date: IsoDate | null;
  location: string | null;
  assetIndex: number;
  assetFileName: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export interface SeedEntryMedia extends WorkspaceScopedFixture {
  entryId: string;
  mediaId: string;
  order: number;
}

export interface SeedItineraryItem extends IdentifiedWorkspaceFixture {
  tripId: string;
  date: IsoDate;
  startTime: string | null;
  endTime: string | null;
  title: string;
  type: "transit" | "food" | "activity" | "stay" | "note";
  location: string;
  notes: string;
  done: boolean;
  order: number;
  assigneeId: string | null;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export interface SeedComment extends IdentifiedWorkspaceFixture {
  tripId: string;
  targetType: "journal_entry" | "itinerary_item";
  targetId: string;
  parentId: string | null;
  authorId: string;
  body: string;
  resolvedAt: IsoTimestamp | null;
  resolvedById: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export interface SeedCommentMention extends WorkspaceScopedFixture {
  commentId: string;
  userId: string;
}

export interface SeedActivity extends IdentifiedWorkspaceFixture {
  tripId: string | null;
  actorId: string;
  verb: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: IsoTimestamp;
}

export interface SeedExpenseParticipant extends WorkspaceScopedFixture {
  expenseId: string;
  userId: string;
  shareAmountMinor: number;
}

export interface SeedExpense extends IdentifiedWorkspaceFixture {
  tripId: string;
  date: IsoDate;
  category: "transport" | "stay" | "food" | "activity" | "shopping" | "other";
  note: string;
  amountMinor: number;
  currency: string;
  paidById: string;
  splitMode: "equal" | "custom";
  receiptMediaId: string | null;
  createdById: string;
  version: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
  participants: SeedExpenseParticipant[];
}

export interface SeedPackingItem extends IdentifiedWorkspaceFixture {
  tripId: string;
  category: "documents" | "clothing" | "gear" | "health" | "other";
  name: string;
  quantity: number;
  packed: boolean;
  assigneeId: string | null;
  order: number;
  version: number;
  createdById: string;
  updatedById: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  deletedAt: IsoTimestamp | null;
}

export interface SeedShareLink extends IdentifiedWorkspaceFixture {
  tripId: string;
  tokenHash: string;
  createdById: string;
  expiresAt: IsoTimestamp | null;
  revokedAt: IsoTimestamp | null;
  passwordHash: string | null;
  allowIndex: boolean;
  showBudget: boolean;
  lastAccessedAt: IsoTimestamp | null;
  accessCount: number;
  createdAt: IsoTimestamp;
}

export interface SeedNotification {
  id: string;
  userId: string;
  workspaceId: string | null;
  tripId: string | null;
  actorId: string | null;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: IsoTimestamp | null;
  emailedAt: IsoTimestamp | null;
  createdAt: IsoTimestamp;
}

export interface SeedNotificationPreference {
  userId: string;
  type: string;
  inApp: boolean;
  email: boolean;
}

export interface SeedAuditLog {
  id: string;
  actorId: string | null;
  actorType: "user" | "admin" | "system";
  action: string;
  targetType: string;
  targetId: string;
  workspaceId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: IsoTimestamp;
}

export interface SeedFeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPercentage: number;
  rules: Record<string, unknown>;
  updatedById: string;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface SeedEmailLog {
  id: string;
  userId: string | null;
  to: string;
  template: string;
  subject: string;
  providerId: string | null;
  status: "queued" | "sent" | "delivered" | "bounced" | "complained" | "failed";
  error: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface SeedExport extends IdentifiedWorkspaceFixture {
  tripId: string | null;
  requestedById: string;
  scope: "trip" | "workspace" | "account";
  format: "zip" | "json";
  includeComments: boolean;
  includeExpenses: boolean;
  includeMedia: boolean;
  status: "queued" | "processing" | "ready" | "failed" | "expired";
  storageKey: string | null;
  error: string | null;
  expiresAt: IsoTimestamp | null;
  createdAt: IsoTimestamp;
  completedAt: IsoTimestamp | null;
}

export interface SeedAssetDefinition {
  fileName: string;
  label: string;
  startColor: string;
  endColor: string;
}

export interface SeedDataset {
  users: SeedUser[];
  workspace: SeedWorkspace;
  members: SeedMember[];
  invitations: SeedInvitation[];
  trips: SeedTrip[];
  tripParticipants: SeedTripParticipant[];
  stops: SeedStop[];
  entries: SeedEntry[];
  revisions: SeedRevision[];
  media: SeedMedia[];
  entryMedia: SeedEntryMedia[];
  itineraryItems: SeedItineraryItem[];
  comments: SeedComment[];
  commentMentions: SeedCommentMention[];
  activities: SeedActivity[];
  expenses: SeedExpense[];
  packingItems: SeedPackingItem[];
  shareLinks: SeedShareLink[];
  notifications: SeedNotification[];
  notificationPreferences: SeedNotificationPreference[];
  auditLogs: SeedAuditLog[];
  featureFlags: SeedFeatureFlag[];
  emailLogs: SeedEmailLog[];
  exports: SeedExport[];
}
