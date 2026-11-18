"use client";

import { useDeleteTrip, useDuplicateTrip } from "@roamlog/api-client";
import { TripSchema, type Trip, type WorkspaceWithRole } from "@roamlog/contracts";
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@roamlog/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConflictDialog } from "@/components/app-shell/conflict-dialog";

import { ActivityTab } from "./activity-tab";
import { DeleteTripDialog, DuplicateTripDialog } from "./dialogs";
import { ExpensesTab } from "./expenses-tab";
import { PackingTab } from "./packing-tab";
import { ParticipantsTab } from "./participants-tab";
import { PhotosTab } from "./photos-tab";
import { assertMutationOk, useBudgetSummary } from "./queries";
import { ShareTab } from "./share-tab";
import { StopsTab } from "./stops-tab";
import { TripWorkspaceHeader } from "./workspace-header";
import { TripWorkspaceProvider, useTripWorkspace } from "./workspace-context";

type TabKey = "stops" | "photos" | "expenses" | "packing" | "participants" | "share" | "activity";

interface TabDefinition {
  key: TabKey;
  label: string;
}

const ALL_TABS: TabDefinition[] = [
  { key: "stops", label: "行程" },
  { key: "photos", label: "照片" },
  { key: "expenses", label: "费用" },
  { key: "packing", label: "行李" },
  { key: "participants", label: "参与者" },
  { key: "share", label: "分享" },
  { key: "activity", label: "活动" },
];

function TripWorkspaceBody() {
  const {
    trip,
    workspace,
    workspaceSlug,
    capabilities,
    conflict,
    error,
    pending,
    refresh,
    mutate,
    resolveConflict,
    dismissConflict,
    clearError,
  } = useTripWorkspace();
  const router = useRouter();
  const budget = useBudgetSummary(trip.id);
  const deleteTrip = useDeleteTrip();
  const duplicateTrip = useDuplicateTrip();

  const [tab, setTab] = useState<TabKey>("stops");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);

  const tabs = ALL_TABS.filter((definition) => {
    if (definition.key === "share") return capabilities.readShareLinks;
    if (definition.key === "participants") return capabilities.readParticipants;
    if (definition.key === "activity") return capabilities.readActivity;
    if (definition.key === "stops") return capabilities.readStops;
    if (definition.key === "photos") return capabilities.readMedia;
    if (definition.key === "expenses") return capabilities.readExpenses;
    if (definition.key === "packing") return capabilities.readPacking;
    return true;
  });

  const activeTab = tabs.some((definition) => definition.key === tab) ? tab : (tabs[0]?.key ?? "stops");

  async function confirmDelete() {
    const deleted = await mutate({
      label: "这趟旅行",
      execute: async () => {
        const response = await deleteTrip.mutateAsync({ tripId: trip.id });
        assertMutationOk(response, `/v1/trips/${trip.id}`);
        return response;
      },
      forbidden: "当前角色不能删除旅行。",
      failure: "旅行没有删除。",
    });
    if (deleted) {
      setDeleteOpen(false);
      router.push(`/w/${workspaceSlug}/trips`);
    }
  }

  async function confirmDuplicate(title: string | undefined) {
    const created = await mutate({
      label: "这趟旅行",
      execute: async () => {
        const response = await duplicateTrip.mutateAsync({
          tripId: trip.id,
          data: title ? { title } : {},
        });
        assertMutationOk(response, `/v1/trips/${trip.id}/duplicate`);
        const parsed = TripSchema.safeParse(response.data);
        return parsed.success ? parsed.data : null;
      },
      forbidden: "当前角色不能复制旅行。",
      failure: "旅行没有复制。",
    });
    if (created) {
      setDuplicateOpen(false);
      router.push(`/w/${workspaceSlug}/trips/${created.id}`);
    }
  }

  return (
    <div className="space-y-5">
      <TripWorkspaceHeader
        trip={trip}
        workspace={workspace}
        workspaceSlug={workspaceSlug}
        capabilities={capabilities}
        budget={budget}
        onDuplicate={() => setDuplicateOpen(true)}
        onDelete={() => setDeleteOpen(true)}
      />

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2"
        >
          <p className="text-xs leading-5 text-accent-red">{error}</p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="link" size="sm" onClick={() => void refresh()}>
              重新读取
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={clearError}>
              关闭
            </Button>
          </div>
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={(value) => setTab(value as TabKey)}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList aria-label="旅行工作台" className="w-max min-w-full justify-start">
            {tabs.map((definition) => (
              <TabsTrigger key={definition.key} value={definition.key} className="shrink-0">
                {definition.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="stops">
          <StopsTab tripId={trip.id} />
        </TabsContent>
        <TabsContent value="photos">
          <PhotosTab tripId={trip.id} />
        </TabsContent>
        <TabsContent value="expenses">
          <ExpensesTab tripId={trip.id} />
        </TabsContent>
        <TabsContent value="packing">
          <PackingTab tripId={trip.id} />
        </TabsContent>
        <TabsContent value="participants">
          <ParticipantsTab tripId={trip.id} />
        </TabsContent>
        <TabsContent value="share">
          <ShareTab tripId={trip.id} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab tripId={trip.id} />
        </TabsContent>
      </Tabs>

      <DeleteTripDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        trip={trip}
        pending={pending}
        onConfirm={() => void confirmDelete()}
      />

      <DuplicateTripDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        trip={trip}
        pending={pending}
        onConfirm={(title) => void confirmDuplicate(title)}
      />

      <ConflictDialog
        open={Boolean(conflict)}
        onOpenChange={(open) => {
          if (!open) dismissConflict();
        }}
        entityLabel={conflict?.label ?? "这条记录"}
        onReload={() => void resolveConflict("reload")}
        onOverwrite={() => void resolveConflict("overwrite")}
        pending={pending}
      />
    </div>
  );
}

/**
 * Trip workbench: overview header + real tabs backed by the trip API.
 *
 * `TripDetailLive` owns loading/error for the trip itself and mounts this with
 * resolved `trip` / `workspace` values; everything below reads from the query
 * layer with loading / error+retry / empty states.
 */
export function TripWorkspace({
  trip,
  workspace,
  workspaceSlug,
}: {
  trip: Trip;
  workspace: WorkspaceWithRole;
  workspaceSlug: string;
}) {
  return (
    <TripWorkspaceProvider trip={trip} workspace={workspace} workspaceSlug={workspaceSlug}>
      <TripWorkspaceBody />
    </TripWorkspaceProvider>
  );
}