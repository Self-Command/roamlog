import type {
  Activity,
  Comment,
  CommentPage,
  CommentTargetType,
  CreateCommentRequest,
  CreateJournalEntryRequest,
  CreateTripRequest,
  EntryPage,
  ExpenseCategory,
  ExpensePage,
  InvitationPage,
  ItineraryItem,
  ItineraryListResponse,
  JournalEntry,
  MessageResponse,
  Notification,
  NotificationPage,
  NotificationPreferencesResponse,
  SearchResponse,
  Stop,
  Trip,
  TripPage,
  UpdateItineraryItemRequest,
  UpdateJournalEntryRequest,
  UpdateMeRequest,
  UpdateMemberRequest,
  UpdateTripRequest,
  UpdateWorkspaceRequest,
  User,
  WorkspaceMember,
  WorkspaceMemberPage,
  WorkspaceMemberWithUser,
  WorkspaceWithRole,
} from "@roamlog/contracts";

export interface TripListParams {
  status?: string;
  q?: string;
  cursor?: string;
  limit?: number;
  sort?: string;
}

export interface EntryListParams {
  cursor?: string;
  limit?: number;
  q?: string;
  tag?: string;
  from?: string;
  to?: string;
  favorite?: boolean;
  sort?: string;
}

export interface ExpenseListParams {
  cursor?: string;
  limit?: number;
  category?: ExpenseCategory;
  from?: string;
  to?: string;
  participantId?: string;
  sort?: string;
}

export interface CommentListParams {
  targetType: CommentTargetType;
  targetId: string;
  cursor?: string;
  limit?: number;
  sort?: string;
}

export interface NotificationListParams {
  cursor?: string;
  limit?: number;
  unreadOnly?: boolean;
  sort?: string;
}

export interface ActivityListParams {
  cursor?: string;
  limit?: number;
  actorId?: string;
  entityType?: string;
  from?: string;
  to?: string;
  sort?: string;
}

export interface SearchParams {
  q: string;
  type?: "all" | "trip" | "entry" | "comment";
  limit?: number;
}

export interface MemberListParams {
  cursor?: string;
  limit?: number;
  q?: string;
  role?: string;
  status?: string;
}

export interface InvitationInput {
  email: string;
  role: "admin" | "editor" | "viewer";
  message?: string;
}

export interface SessionInfo {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified?: boolean;
  };
  session?: {
    id?: string;
    expiresAt?: string;
  };
}

export interface DataAdapter {
  fetchMe(signal?: AbortSignal): Promise<User>;
  fetchSession(signal?: AbortSignal): Promise<SessionInfo | null>;
  fetchMyWorkspaces(signal?: AbortSignal): Promise<WorkspaceWithRole[]>;
  fetchWorkspaces(signal?: AbortSignal): Promise<WorkspaceWithRole[]>;
  fetchWorkspace(workspaceId: string, signal?: AbortSignal): Promise<WorkspaceWithRole>;
  updateWorkspace(
    workspaceId: string,
    input: UpdateWorkspaceRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceWithRole>;
  updateMe(input: UpdateMeRequest, signal?: AbortSignal): Promise<User>;

  fetchTrips(
    workspaceId: string,
    params?: TripListParams,
    signal?: AbortSignal,
  ): Promise<TripPage>;
  fetchTrip(tripId: string, signal?: AbortSignal): Promise<Trip>;
  fetchStops(tripId: string, signal?: AbortSignal): Promise<Stop[]>;
  fetchExpenses(
    tripId: string,
    params?: ExpenseListParams,
    signal?: AbortSignal,
  ): Promise<ExpensePage>;
  createTrip(
    workspaceId: string,
    input: CreateTripRequest,
    signal?: AbortSignal,
  ): Promise<Trip>;
  updateTrip(tripId: string, input: UpdateTripRequest, signal?: AbortSignal): Promise<Trip>;

  fetchEntries(
    workspaceId: string,
    params?: EntryListParams,
    signal?: AbortSignal,
  ): Promise<EntryPage>;
  fetchTripEntries(
    tripId: string,
    params?: EntryListParams,
    signal?: AbortSignal,
  ): Promise<EntryPage>;
  fetchEntry(entryId: string, signal?: AbortSignal): Promise<JournalEntry>;
  createEntry(
    tripId: string,
    input: CreateJournalEntryRequest,
    signal?: AbortSignal,
  ): Promise<JournalEntry>;
  updateEntry(
    entryId: string,
    input: UpdateJournalEntryRequest,
    signal?: AbortSignal,
  ): Promise<JournalEntry>;
  favoriteEntry(entryId: string, favorite: boolean, signal?: AbortSignal): Promise<JournalEntry>;

  fetchItinerary(tripId: string, signal?: AbortSignal): Promise<ItineraryListResponse>;
  updateItineraryItem(
    itemId: string,
    input: UpdateItineraryItemRequest,
    signal?: AbortSignal,
  ): Promise<ItineraryItem>;

  fetchComments(params: CommentListParams, signal?: AbortSignal): Promise<CommentPage>;
  createComment(input: CreateCommentRequest, signal?: AbortSignal): Promise<Comment>;

  fetchNotifications(
    params?: NotificationListParams,
    signal?: AbortSignal,
  ): Promise<NotificationPage>;
  markNotificationRead(id: string, signal?: AbortSignal): Promise<Notification>;
  markAllNotificationsRead(signal?: AbortSignal): Promise<{ updatedCount: number }>;
  fetchNotificationPreferences(signal?: AbortSignal): Promise<NotificationPreferencesResponse>;
  updateNotificationPreferences(
    preferences: NotificationPreferencesResponse,
    signal?: AbortSignal,
  ): Promise<NotificationPreferencesResponse>;

  fetchActivity(
    workspaceId: string,
    params?: ActivityListParams,
    signal?: AbortSignal,
  ): Promise<{ items: Activity[]; nextCursor: string | null; hasMore: boolean }>;
  searchWorkspace(
    workspaceId: string,
    params: SearchParams,
    signal?: AbortSignal,
  ): Promise<SearchResponse>;

  fetchMembers(
    workspaceId: string,
    params?: MemberListParams,
    signal?: AbortSignal,
  ): Promise<WorkspaceMemberPage>;
  updateMember(
    workspaceId: string,
    memberId: string,
    input: UpdateMemberRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceMemberWithUser>;
  removeMember(workspaceId: string, memberId: string, signal?: AbortSignal): Promise<MessageResponse>;
  fetchInvitations(
    workspaceId: string,
    params?: MemberListParams,
    signal?: AbortSignal,
  ): Promise<InvitationPage>;
  inviteMember(
    workspaceId: string,
    input: InvitationInput,
    signal?: AbortSignal,
  ): Promise<{ id: string }>;
  revokeInvitation(
    workspaceId: string,
    invitationId: string,
    signal?: AbortSignal,
  ): Promise<MessageResponse>;
  acceptInvitation(token: string, signal?: AbortSignal): Promise<WorkspaceMember>;
}
