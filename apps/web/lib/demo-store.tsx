"use client";

import {
  ExpenseWithSplitsSchema,
  splitEqualAmount,
  type Comment,
  type ExpenseCategory,
  type ExpenseWithSplits,
  type Invitation,
  type ItineraryItem,
  type JournalEntry,
  type Media,
  type Notification,
  type PackingCategory,
  type PackingItem,
  type Trip,
  type WorkspaceMemberWithUser,
  type WorkspaceRole,
} from "@roamlog/contracts";
import {
  WORKSPACE_ID,
  demoActivities,
  demoComments,
  demoEntries,
  demoExpenses,
  demoFixtureState,
  demoInvitations,
  demoItineraryItems,
  demoMedia,
  demoMembers,
  demoNotifications,
  demoPackingItems,
  demoStops,
  demoUser,
  fixtureId,
} from "@roamlog/api-mocks/fixtures";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface DemoNotificationPreference {
  type: string;
  inApp: boolean;
  email: boolean;
}

export interface DemoSettings {
  workspaceName: string;
  displayName: string;
  timezone: string;
  locale: string;
  currency: string;
  weekStartsOn: number;
  density: "comfortable" | "compact";
  accentColor: string;
  reduceMotion: boolean;
  notificationPreferences: DemoNotificationPreference[];
}

export interface DemoState {
  trips: Trip[];
  members: WorkspaceMemberWithUser[];
  invitations: Invitation[];
  entries: typeof demoEntries;
  comments: Comment[];
  itinerary: ItineraryItem[];
  stops: typeof demoStops;
  expenses: ExpenseWithSplits[];
  packing: PackingItem[];
  media: Media[];
  notifications: Notification[];
  activities: typeof demoActivities;
  settings: DemoSettings;
}

const STORAGE_KEY = "roamlog:wave2-demo-state:v1";
let localSequence = 5000;

function localId() {
  localSequence += 1;
  return fixtureId(localSequence);
}

function defaultSettings(): DemoSettings {
  return {
    workspaceName: "Roamlog Crew",
    displayName: demoUser.name,
    timezone: demoUser.timezone,
    locale: demoUser.locale,
    currency: "CNY",
    weekStartsOn: 1,
    density: "comfortable",
    accentColor: "#ff801f",
    reduceMotion: false,
    notificationPreferences: [
      { type: "mention", inApp: true, email: true },
      { type: "comment", inApp: true, email: true },
      { type: "trip_reminder", inApp: true, email: false },
      { type: "budget_alert", inApp: true, email: true },
      { type: "weekly_digest", inApp: true, email: true },
    ],
  };
}

export function createDemoState(): DemoState {
  return {
    trips: demoFixtureState.trips.map((trip) => ({ ...trip })),
    members: demoMembers.map((member) => ({ ...member, user: { ...member.user } })),
    invitations: demoInvitations.map((invitation) => ({ ...invitation })),
    entries: demoEntries.map((entry) => ({ ...entry })),
    comments: demoComments.map((comment) => ({ ...comment })),
    itinerary: demoItineraryItems.map((item) => ({ ...item })),
    stops: demoStops.map((stop) => ({ ...stop })),
    expenses: demoExpenses.map((expense) => ({
      ...expense,
      participants: expense.participants.map((participant) => ({ ...participant })),
    })),
    packing: demoPackingItems.map((item) => ({ ...item })),
    media: demoMedia.map((item) => ({ ...item })),
    notifications: demoNotifications.map((item) => ({ ...item })),
    activities: demoActivities.map((item) => ({ ...item })),
    settings: defaultSettings(),
  };
}

export function canEdit(role: WorkspaceRole) {
  return role !== "viewer";
}

interface DemoStoreValue {
  state: DemoState;
  currentRole: WorkspaceRole;
  currentUser: typeof demoUser;
  setItineraryDone: (tripId: string, itemId: string, done: boolean, role: WorkspaceRole) => void;
  addItineraryItem: (
    tripId: string,
    input: Pick<ItineraryItem, "title" | "date" | "type" | "location">,
    role: WorkspaceRole,
  ) => void;
  addExpense: (
    tripId: string,
    input: { note: string; amountMinor: number; category: ExpenseCategory; date: string },
    role: WorkspaceRole,
  ) => void;
  updateTrip: (
    tripId: string,
    patch: { title: string; summary: string; status: Trip["status"]; favorite: boolean },
    role: WorkspaceRole,
  ) => void;
  setPackingPacked: (itemId: string, packed: boolean, role: WorkspaceRole) => void;
  addPackingItem: (
    tripId: string,
    input: { name: string; category: PackingCategory },
    role: WorkspaceRole,
  ) => void;
  setAllPacked: (tripId: string, packed: boolean, role: WorkspaceRole) => void;
  toggleEntryFavorite: (entryId: string) => void;
  addEntry: (
    tripId: string,
    input: { title: string; location: string; excerpt: string },
    role: WorkspaceRole,
  ) => void;
  addComment: (entryId: string, body: string, mentionUserIds?: string[]) => void;
  updateMemberRole: (memberId: string, role: WorkspaceRole) => void;
  removeMember: (memberId: string) => void;
  inviteMember: (email: string, role: WorkspaceRole, message?: string) => void;
  revokeInvitation: (invitationId: string) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  updateNotificationPreference: (
    type: string,
    field: "inApp" | "email",
    value: boolean,
  ) => void;
  updateSettings: (patch: Partial<DemoSettings>) => void;
  addMedia: (tripId: string, caption: string, role: WorkspaceRole) => void;
  resetDemo: () => void;
}

const DemoStoreContext = createContext<DemoStoreValue | null>(null);

export function DemoDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(createDemoState);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DemoState>;
        if (parsed.trips && parsed.entries && parsed.settings) {
          setState({ ...createDemoState(), ...parsed });
        }
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // A full or blocked localStorage should not make the prototype unusable.
    }
  }, [state]);

  const currentRole = useMemo<WorkspaceRole>(() => {
    const member = state.members.find((candidate) => candidate.userId === demoUser.id);
    return member?.role ?? "viewer";
  }, [state.members]);

  const setItineraryDone = useCallback(
    (tripId: string, itemId: string, done: boolean, role: WorkspaceRole) => {
      if (!canEdit(role)) return;
      setState((current) => ({
        ...current,
        itinerary: current.itinerary.map((item) =>
          item.id === itemId && item.tripId === tripId
            ? { ...item, done, version: item.version + 1, updatedAt: new Date().toISOString() }
            : item,
        ),
      }));
    },
    [],
  );

  const addItineraryItem = useCallback(
    (
      tripId: string,
      input: Pick<ItineraryItem, "title" | "date" | "type" | "location">,
      role: WorkspaceRole,
    ) => {
      if (!canEdit(role)) return;
      setState((current) => {
        const id = localId();
        const item: ItineraryItem = {
          id,
          workspaceId: WORKSPACE_ID,
          tripId,
          date: input.date,
          startTime: null,
          endTime: null,
          title: input.title,
          type: input.type,
          location: input.location,
          notes: "",
          done: false,
          order: current.itinerary.filter((candidate) => candidate.tripId === tripId).length,
          assigneeId: demoUser.id,
          version: 1,
          createdById: demoUser.id,
          updatedById: demoUser.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
        };
        return {
          ...current,
          itinerary: [...current.itinerary, item],
          activities: [
            {
              id: localId(),
              workspaceId: WORKSPACE_ID,
              tripId,
              actorId: demoUser.id,
              verb: "created_itinerary",
              entityType: "itinerary_item",
              entityId: id,
              metadata: { title: input.title },
              createdAt: item.createdAt,
            },
            ...current.activities,
          ],
        };
      });
    },
    [],
  );

  const addExpense = useCallback(
    (
      tripId: string,
      input: { note: string; amountMinor: number; category: ExpenseCategory; date: string },
      role: WorkspaceRole,
    ) => {
      if (!canEdit(role)) return;
      setState((current) => {
        const id = localId();
        const participantIds = current.members.map((member) => member.userId);
        const participants = splitEqualAmount(input.amountMinor, participantIds, demoUser.id);
        const expense = ExpenseWithSplitsSchema.parse({
          id,
          workspaceId: WORKSPACE_ID,
          tripId,
          date: input.date,
          category: input.category,
          note: input.note,
          amountMinor: input.amountMinor,
          currency: current.settings.currency,
          paidById: demoUser.id,
          splitMode: "equal",
          receiptMediaId: null,
          createdById: demoUser.id,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
          participants: participants.map((participant) => ({
            workspaceId: WORKSPACE_ID,
            expenseId: id,
            userId: participant.userId,
            shareAmountMinor: participant.shareAmountMinor,
          })),
        });
        return {
          ...current,
          expenses: [expense, ...current.expenses],
          activities: [
            {
              id: localId(),
              workspaceId: WORKSPACE_ID,
              tripId,
              actorId: demoUser.id,
              verb: "expensed",
              entityType: "expense",
              entityId: id,
              metadata: { note: input.note, amountMinor: input.amountMinor },
              createdAt: expense.createdAt,
            },
            ...current.activities,
          ],
        };
      });
    },
    [],
  );

  const updateTrip = useCallback(
    (
      tripId: string,
      patch: { title: string; summary: string; status: Trip["status"]; favorite: boolean },
      role: WorkspaceRole,
    ) => {
      if (!canEdit(role)) return;
      setState((current) => ({
        ...current,
        trips: current.trips.map((trip) =>
          trip.id === tripId
            ? {
                ...trip,
                ...patch,
                version: trip.version + 1,
                updatedAt: new Date().toISOString(),
                updatedById: demoUser.id,
              }
            : trip,
        ),
      }));
    },
    [],
  );

  const setPackingPacked = useCallback(
    (itemId: string, packed: boolean, role: WorkspaceRole) => {
      if (!canEdit(role)) return;
      setState((current) => ({
        ...current,
        packing: current.packing.map((item) =>
          item.id === itemId
            ? { ...item, packed, version: item.version + 1, updatedAt: new Date().toISOString() }
            : item,
        ),
      }));
    },
    [],
  );

  const addPackingItem = useCallback(
    (tripId: string, input: { name: string; category: PackingCategory }, role: WorkspaceRole) => {
      if (!canEdit(role)) return;
      setState((current) => {
        const item: PackingItem = {
          id: localId(),
          workspaceId: WORKSPACE_ID,
          tripId,
          category: input.category,
          name: input.name,
          quantity: 1,
          packed: false,
          assigneeId: demoUser.id,
          order: current.packing.filter((candidate) => candidate.tripId === tripId).length,
          createdById: demoUser.id,
          updatedById: demoUser.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          deletedAt: null,
          version: 1,
        };
        return { ...current, packing: [...current.packing, item] };
      });
    },
    [],
  );

  const setAllPacked = useCallback((tripId: string, packed: boolean, role: WorkspaceRole) => {
    if (!canEdit(role)) return;
    setState((current) => ({
      ...current,
      packing: current.packing.map((item) =>
        item.tripId === tripId ? { ...item, packed, version: item.version + 1 } : item,
      ),
    }));
  }, []);

  const toggleEntryFavorite = useCallback((entryId: string) => {
    setState((current) => ({
      ...current,
      entries: current.entries.map((entry) =>
        entry.id === entryId
          ? { ...entry, favorite: !entry.favorite, version: entry.version + 1 }
          : entry,
      ),
    }));
  }, []);

  const addEntry = useCallback(
    (
      tripId: string,
      input: { title: string; location: string; excerpt: string },
      role: WorkspaceRole,
    ) => {
      if (!canEdit(role)) return;
      setState((current) => {
        const now = new Date().toISOString();
        const entry: JournalEntry = {
          id: localId(),
          tripId,
          workspaceId: WORKSPACE_ID,
          title: input.title,
          date: new Date().toISOString().slice(0, 10),
          location: input.location,
          lat: null,
          lng: null,
          mood: "calm",
          weather: "cloudy",
          contentJson: {
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text: input.excerpt }] },
            ],
          },
          contentHtml: `<p>${input.excerpt}</p>`,
          excerpt: input.excerpt,
          tags: [],
          favorite: false,
          version: 1,
          createdById: demoUser.id,
          updatedById: demoUser.id,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        return {
          ...current,
          entries: [entry, ...current.entries],
          activities: [
            {
              id: localId(),
              workspaceId: WORKSPACE_ID,
              tripId,
              actorId: demoUser.id,
              verb: "created_entry",
              entityType: "journal_entry",
              entityId: entry.id,
              metadata: { title: entry.title },
              createdAt: now,
            },
            ...current.activities,
          ],
        };
      });
    },
    [],
  );

  const addComment = useCallback((entryId: string, body: string, mentionUserIds: string[] = []) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setState((current) => {
      const entry = current.entries.find((candidate) => candidate.id === entryId);
      if (!entry) return current;
      const now = new Date().toISOString();
      const comment: Comment = {
        id: localId(),
        workspaceId: WORKSPACE_ID,
        tripId: entry.tripId,
        targetType: "journal_entry",
        targetId: entryId,
        parentId: null,
        authorId: demoUser.id,
        body: trimmed,
        resolvedAt: null,
        resolvedById: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      const mentioned = current.members.filter((member) =>
        mentionUserIds.includes(member.userId),
      );
      const notifications: Notification[] = mentioned.map((member) => ({
        id: localId(),
        userId: member.userId,
        workspaceId: WORKSPACE_ID,
        tripId: entry.tripId,
        actorId: demoUser.id,
        type: "mention",
        title: `${demoUser.name} 在评论里提到了你`,
        body: `「${trimmed}」 ·《${entry.title}》`,
        entityType: "journal_entry",
        entityId: entryId,
        readAt: null,
        emailedAt: null,
        createdAt: now,
      }));
      return {
        ...current,
        comments: [...current.comments, comment],
        notifications: [...notifications, ...current.notifications],
      };
    });
  }, []);

  const updateMemberRole = useCallback((memberId: string, role: WorkspaceRole) => {
    if (role === "owner") return;
    setState((current) => ({
      ...current,
      members: current.members.map((member) =>
        member.id === memberId ? { ...member, role, updatedAt: new Date().toISOString() } : member,
      ),
    }));
  }, []);

  const removeMember = useCallback((memberId: string) => {
    setState((current) => ({
      ...current,
      members: current.members.filter(
        (member) => member.id !== memberId || member.role === "owner",
      ),
    }));
  }, []);

  const inviteMember = useCallback(
    (email: string, role: WorkspaceRole, message?: string) => {
      if (role === "owner") return;
      setState((current) => {
        const now = new Date();
        const invitation: Invitation = {
          id: localId(),
          workspaceId: WORKSPACE_ID,
          email,
          role,
          invitedById: demoUser.id,
          expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
          acceptedAt: null,
          revokedAt: null,
          createdAt: now.toISOString(),
        };
        return {
          ...current,
          invitations: [invitation, ...current.invitations],
          activities: [
            {
              id: localId(),
              workspaceId: WORKSPACE_ID,
              tripId: null,
              actorId: demoUser.id,
              verb: "invited_member",
              entityType: "invitation",
              entityId: invitation.id,
              metadata: { email, role, message: message ?? "" },
              createdAt: invitation.createdAt,
            },
            ...current.activities,
          ],
        };
      });
    },
    [],
  );

  const revokeInvitation = useCallback((invitationId: string) => {
    setState((current) => ({
      ...current,
      invitations: current.invitations.map((invitation) =>
        invitation.id === invitationId
          ? { ...invitation, revokedAt: new Date().toISOString() }
          : invitation,
      ),
    }));
  }, []);

  const markNotificationRead = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      notifications: current.notifications.map((notification) =>
        notification.id === id && !notification.readAt
          ? { ...notification, readAt: new Date().toISOString() }
          : notification,
      ),
    }));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    const now = new Date().toISOString();
    setState((current) => ({
      ...current,
      notifications: current.notifications.map((notification) =>
        notification.readAt ? notification : { ...notification, readAt: now },
      ),
    }));
  }, []);

  const updateNotificationPreference = useCallback(
    (type: string, field: "inApp" | "email", value: boolean) => {
      setState((current) => ({
        ...current,
        settings: {
          ...current.settings,
          notificationPreferences: current.settings.notificationPreferences.map((preference) =>
            preference.type === type ? { ...preference, [field]: value } : preference,
          ),
        },
      }));
    },
    [],
  );

  const updateSettings = useCallback((patch: Partial<DemoSettings>) => {
    setState((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
  }, []);

  const addMedia = useCallback((tripId: string, caption: string, role: WorkspaceRole) => {
    if (!canEdit(role)) return;
    setState((current) => {
      const media: Media = {
        id: localId(),
        workspaceId: WORKSPACE_ID,
        tripId,
        uploaderId: demoUser.id,
        bucket: "roamlog-local",
        key: `fixtures/${tripId}/local-${localId()}.jpg`,
        mimeType: "image/jpeg",
        size: 1_240_000,
        width: 1600,
        height: 1067,
        blurhash: null,
        variants: {},
        status: "ready",
        error: null,
        caption,
        date: new Date().toISOString().slice(0, 10),
        location: "本地演示上传",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      };
      return { ...current, media: [media, ...current.media] };
    });
  }, []);

  const resetDemo = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState(createDemoState());
  }, []);

  const value = useMemo<DemoStoreValue>(
    () => ({
      state,
      currentRole,
      currentUser: demoUser,
      setItineraryDone,
      addItineraryItem,
      addExpense,
      updateTrip,
      setPackingPacked,
      addPackingItem,
      setAllPacked,
      toggleEntryFavorite,
      addEntry,
      addComment,
      updateMemberRole,
      removeMember,
      inviteMember,
      revokeInvitation,
      markNotificationRead,
      markAllNotificationsRead,
      updateNotificationPreference,
      updateSettings,
      addMedia,
      resetDemo,
    }),
    [
      state,
      currentRole,
      setItineraryDone,
      addItineraryItem,
      addExpense,
      updateTrip,
      setPackingPacked,
      addPackingItem,
      setAllPacked,
      toggleEntryFavorite,
      addEntry,
      addComment,
      updateMemberRole,
      removeMember,
      inviteMember,
      revokeInvitation,
      markNotificationRead,
      markAllNotificationsRead,
      updateNotificationPreference,
      updateSettings,
      addMedia,
      resetDemo,
    ],
  );

  return <DemoStoreContext.Provider value={value}>{children}</DemoStoreContext.Provider>;
}

export function useDemoStore() {
  const value = useContext(DemoStoreContext);
  if (!value) {
    throw new Error("useDemoStore must be used inside DemoDataProvider.");
  }
  return value;
}
