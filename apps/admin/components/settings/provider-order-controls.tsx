"use client";

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  ListOrdered,
  RefreshCw,
  Save,
  Undo2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ProviderGroupResponse } from "@roamlog/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@roamlog/ui";

import { AdminMutationError, type AdminApiFailure } from "../../lib/admin-api-error";
import type { AdminConsoleRole } from "../../lib/admin-types";
import type {
  AdminProviderSummary,
  ProviderGroupKey,
  ProviderSettingsApi,
} from "../../lib/provider-settings-api";
import { ProviderConflictDialog } from "./provider-conflict-dialog";

interface ProviderOrderControlsProps {
  group: ProviderGroupKey;
  providers: readonly AdminProviderSummary[];
  groupVersion: number;
  role: AdminConsoleRole;
  api: ProviderSettingsApi;
  onSaved?: (next: ProviderGroupResponse) => void;
  onError?: (message: string | null) => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof AdminMutationError) {
    return error.failure.detail?.trim() || error.failure.title || error.failure.code;
  }
  return error instanceof Error ? error.message : "顺序保存失败，请重试。";
}

function SortableRow({
  provider,
  index,
  count,
  disabled,
  onMoveUp,
  onMoveDown,
}: {
  provider: AdminProviderSummary;
  index: number;
  count: number;
  disabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: provider.id,
    disabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-provider-order-id={provider.id}
      className={`flex items-center gap-3 rounded-control border px-3 py-2.5 ${
        isDragging
          ? "border-accent-orange/40 bg-surface-2 shadow-lg"
          : "border-hairline bg-surface-1"
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`拖动排序：${provider.label}`}
        className="flex size-8 cursor-grab touch-none items-center justify-center rounded-control border border-hairline text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-40"
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <span className="w-6 font-mono text-[10px] text-muted">{index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-ink">{provider.label}</p>
        <p className="truncate font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
          {provider.preset ?? provider.adapter} · priority {(index + 1) * 10}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || index === 0}
          aria-label={`${provider.label}上移`}
          title={index === 0 ? "已经在第一位" : `上移 ${provider.label}`}
          onClick={onMoveUp}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || index === count - 1}
          aria-label={`${provider.label}下移`}
          title={index === count - 1 ? "已经在最后一位" : `下移 ${provider.label}`}
          onClick={onMoveDown}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

export function ProviderOrderControls({
  group,
  providers,
  groupVersion,
  role,
  api,
  onSaved,
  onError,
}: ProviderOrderControlsProps) {
  const canWrite = role === "super_admin";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<readonly AdminProviderSummary[]>(providers);
  const [version, setVersion] = useState(groupVersion);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflict, setConflict] = useState<AdminApiFailure | null>(null);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const ids = useMemo(() => draft.map((provider) => provider.id), [draft]);

  useEffect(() => {
    if (open && dirty) {
      return;
    }
    setDraft(providers);
    setVersion(groupVersion);
  }, [dirty, groupVersion, open, providers]);

  if (!canWrite || providers.length < 2) {
    return null;
  }

  function openEditor() {
    setDraft(providers);
    setVersion(groupVersion);
    setDirty(false);
    setConflict(null);
    setAnnouncement("");
    onError?.(null);
    setOpen(true);
  }

  function closeEditor() {
    if (dirty) {
      setDiscardDialogOpen(true);
      return;
    }
    resetAndClose();
  }

  function resetAndClose() {
    setDraft(providers);
    setVersion(groupVersion);
    setDirty(false);
    setConflict(null);
    setDiscardDialogOpen(false);
    setOpen(false);
  }

  function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= draft.length) {
      return;
    }
    const provider = draft[index];
    if (!provider) {
      return;
    }
    setDraft(arrayMove([...draft], index, next));
    setDirty(true);
    setAnnouncement(`${provider.label}移动到第 ${next + 1} 位。`);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    const oldIndex = draft.findIndex((provider) => provider.id === active.id);
    const newIndex = draft.findIndex((provider) => provider.id === over.id);
    if (oldIndex < 0 || newIndex < 0) {
      return;
    }
    const provider = draft[oldIndex];
    setDraft(arrayMove([...draft], oldIndex, newIndex));
    setDirty(true);
    setAnnouncement(`${provider?.label ?? "服务商"}移动到第 ${newIndex + 1} 位。`);
  }

  async function saveOrder(versionOverride = version): Promise<void> {
    setSaving(true);
    setConflict(null);
    onError?.(null);
    try {
      const updated = await api.reorder(group, ids, versionOverride);
      setDraft(updated.providers);
      setVersion(updated.version);
      setDirty(false);
      setOpen(false);
      setAnnouncement("服务商优先级顺序已保存。");
      onSaved?.(updated);
    } catch (error) {
      if (error instanceof AdminMutationError && error.failure.code === "PROVIDER_ORDER_CONFLICT") {
        setConflict(error.failure);
      } else {
        onError?.(errorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  }

  async function loadLatest(): Promise<void> {
    setConflictBusy(true);
    try {
      const latest = await api.group(group);
      setDraft(latest.providers);
      setVersion(latest.version);
      setDirty(false);
      setConflict(null);
      setOpen(false);
      setAnnouncement("已载入最新顺序。");
      onSaved?.(latest);
    } catch (error) {
      onError?.(errorMessage(error));
    } finally {
      setConflictBusy(false);
    }
  }

  async function retryWithLatestVersion(): Promise<void> {
    setConflictBusy(true);
    try {
      const latest = await api.group(group);
      const latestIds = new Set(latest.providers.map((provider) => provider.id));
      if (
        latestIds.size !== draft.length ||
        draft.some((provider) => !latestIds.has(provider.id))
      ) {
        setDraft(latest.providers);
        setVersion(latest.version);
        setConflict(null);
        onError?.("服务商列表已经变化，已载入最新顺序，请重新调整。");
        return;
      }
      await saveOrder(latest.version);
    } catch (error) {
      onError?.(errorMessage(error));
    } finally {
      setConflictBusy(false);
    }
  }

  return (
    <section className="rounded-card border border-hairline-strong bg-surface-1 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface-2 text-muted">
            <ListOrdered aria-hidden="true" className="size-4" />
          </span>
          <div>
            <p className="type-eyebrow">优先级顺序</p>
            <p className="mt-1 text-[11px] leading-5 text-muted">
              数字越小越先使用。拖拽或键盘按钮调整后保存；保存顺序使用版本检查，不会覆盖他人改动。
            </p>
          </div>
        </div>
        {!open ? (
          <Button variant="outline" size="sm" onClick={openEditor}>
            <ListOrdered aria-hidden="true" />
            调整顺序
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={closeEditor}>
              <Undo2 aria-hidden="true" />
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!dirty || saving}
              onClick={() => void saveOrder()}
            >
              <Save aria-hidden="true" />
              {saving ? "保存中…" : "保存顺序"}
            </Button>
          </div>
        )}
      </div>

      {open ? (
        <div className="mt-4 border-t border-hairline pt-4">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <ol className="space-y-2" aria-label="服务商优先级顺序">
                {draft.map((provider, index) => (
                  <SortableRow
                    key={provider.id}
                    provider={provider}
                    index={index}
                    count={draft.length}
                    disabled={saving || conflictBusy}
                    onMoveUp={() => move(index, -1)}
                    onMoveDown={() => move(index, 1)}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
          {dirty ? (
            <p className="mt-3 flex items-center gap-2 rounded-control border border-accent-yellow/25 bg-accent-yellow/5 px-3 py-2 text-[11px] text-body">
              <RefreshCw aria-hidden="true" className="size-3.5" />
              顺序未保存。保存后会同步到运行时和所有后台实例。
            </p>
          ) : (
            <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.08em] text-muted">
              当前顺序已与服务器同步
            </p>
          )}
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="mt-2 min-h-4 text-[11px] text-muted">
        {announcement}
      </p>

      <ProviderConflictDialog
        open={conflict !== null}
        failure={conflict}
        busy={conflictBusy}
        onOpenChange={(next) => {
          if (!next) {
            setConflict(null);
          }
        }}
        onLoadLatest={() => void loadLatest()}
        onRetry={() => void retryWithLatestVersion()}
      />

      <Dialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>放弃未保存的顺序调整？</DialogTitle>
            <DialogDescription>
              当前顺序还没有保存。放弃后，列表会恢复为服务器上的优先级顺序。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiscardDialogOpen(false)}>
              继续编辑
            </Button>
            <Button variant="danger" onClick={resetAndClose}>
              放弃调整
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
