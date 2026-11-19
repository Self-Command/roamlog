"use client";

import { useCreateStop, useDeleteStop, useUpdateStop } from "@roamlog/api-client";
import type { CreateStopRequest, Stop } from "@roamlog/contracts";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Textarea,
} from "@roamlog/ui";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { deniedReason } from "./capabilities";
import { ConfirmDialog } from "./dialogs";
import { formatDateRange } from "@/lib/trip-presentation";
import { providerLabel } from "./format";
import { EmptyBlock, QueryPanel } from "./panel";
import { assertMutationOk, latestStopVersion, useStops } from "./queries";
import { useTripWorkspace } from "./workspace-context";

interface StopDraft {
  city: string;
  country: string;
  countryCode: string;
  startDate: string;
  endDate: string;
  lat: string;
  lng: string;
  notes: string;
}

const EMPTY_DRAFT: StopDraft = {
  city: "",
  country: "",
  countryCode: "",
  startDate: "",
  endDate: "",
  lat: "",
  lng: "",
  notes: "",
};

function buildCreateStop(draft: StopDraft, order: number): CreateStopRequest {
  const lat = draft.lat.trim();
  const lng = draft.lng.trim();
  const notes = draft.notes.trim();
  return {
    city: draft.city.trim(),
    country: draft.country.trim(),
    countryCode: draft.countryCode.trim().toUpperCase(),
    startDate: draft.startDate,
    endDate: draft.endDate,
    order,
    ...(notes ? { notes } : {}),
    ...(lat ? { lat: Number(lat) } : {}),
    ...(lng ? { lng: Number(lng) } : {}),
  };
}

function draftFromStop(stop: Stop): StopDraft {
  return {
    city: stop.city,
    country: stop.country,
    countryCode: stop.countryCode,
    startDate: stop.startDate,
    endDate: stop.endDate,
    lat: stop.lat === null ? "" : String(stop.lat),
    lng: stop.lng === null ? "" : String(stop.lng),
    notes: stop.notes,
  };
}

function validateDraft(draft: StopDraft): string | null {
  if (!draft.city.trim()) return "请填写城市。";
  if (!draft.country.trim()) return "请填写国家。";
  if (!/^[A-Za-z]{2}$/.test(draft.countryCode.trim())) return "国家码必须是两位字母，例如 JP。";
  if (!draft.startDate) return "请选择开始日期。";
  if (!draft.endDate) return "请选择结束日期。";
  if (draft.endDate < draft.startDate) return "结束日期不能早于开始日期。";
  if (draft.lat.trim() && !Number.isFinite(Number(draft.lat))) return "纬度必须是数字。";
  if (draft.lng.trim() && !Number.isFinite(Number(draft.lng))) return "经度必须是数字。";
  return null;
}

function StopRow({
  stop,
  index,
  canEdit,
  canDelete,
  editTitle,
  deleteTitle,
  onEdit,
  onDelete,
}: {
  stop: Stop;
  index: number;
  canEdit: boolean;
  canDelete: boolean;
  editTitle: string;
  deleteTitle: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="grid gap-3 px-4 py-3.5 sm:grid-cols-[52px_minmax(0,1fr)_auto] sm:items-start">
      <div className="font-mono text-[11px] text-stone">
        {String(index + 1).padStart(2, "0")}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="font-serif text-lg leading-tight tracking-[-0.02em] text-ink">
            {stop.city}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
            {stop.country} · {stop.countryCode}
          </p>
          <Badge tone={stop.provider ? "blue" : "neutral"}>{providerLabel(stop.provider)}</Badge>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-muted">
          {/* The persisted place address survives a refresh; without one the
              city/country line above is the only location we can honestly show. */}
          {stop.address ?? `${stop.city} · ${stop.country}`}
        </p>
        <p className="mt-1 text-[11px] leading-5 text-muted">
          {formatDateRange(stop.startDate, stop.endDate)}
          <span className="mx-1.5 text-stone">/</span>
          <span className="font-mono text-[10px]">
            {stop.lat === null || stop.lng === null
              ? "未记录坐标"
              : `${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}`}
          </span>
          {stop.timeZone ? <span className="ml-2 font-mono text-[10px]">{stop.timeZone}</span> : null}
        </p>
        {stop.notes ? (
          <p className="mt-1.5 text-xs leading-5 text-body">{stop.notes}</p>
        ) : null}
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
          ORDER {stop.order} · VERSION {stop.version}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onEdit}
          disabled={!canEdit}
          title={canEdit ? "编辑这个行程节点" : editTitle}
          aria-label={`编辑行程节点 ${stop.city}`}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={!canDelete}
          title={canDelete ? "删除这个行程节点" : deleteTitle}
          aria-label={`删除行程节点 ${stop.city}`}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

export function StopsTab({ tripId }: { tripId: string }) {
  const { capabilities, mutate, pending, role } = useTripWorkspace();
  const stops = useStops(tripId);
  const createStop = useCreateStop();
  const updateStop = useUpdateStop();
  const deleteStop = useDeleteStop();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Stop | null>(null);
  const [draft, setDraft] = useState<StopDraft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Stop | null>(null);

  const ordered = stops.state === "ready" ? [...stops.data].sort((a, b) => a.order - b.order) : [];
  const addTitle = capabilities.createStop ? undefined : deniedReason(role, "添加行程节点");
  const editTitle = capabilities.updateStop ? undefined : deniedReason(role, "编辑行程节点");
  const deleteTitle = capabilities.deleteStop ? undefined : deniedReason(role, "删除行程节点");

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = validateDraft(draft);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setFormError(null);

    if (editTarget) {
      const target = editTarget;
      const payload = {
        ...buildCreateStop(draft, target.order),
        version: target.version,
      };
      const saved = await mutate({
        label: "这个行程节点",
        execute: async () => {
          const response = await updateStop.mutateAsync({ stopId: target.id, data: payload });
          assertMutationOk(response, `/v1/stops/${target.id}`);
          return response;
        },
        retryAfterConflict: async () => {
          const version = await latestStopVersion(tripId, target.id);
          if (version === null) {
            throw new Error("这个行程节点已经不存在，无法覆盖保存。");
          }
          const response = await updateStop.mutateAsync({
            stopId: target.id,
            data: { ...payload, version },
          });
          assertMutationOk(response, `/v1/stops/${target.id}`);
          return response;
        },
        forbidden: "当前角色不能编辑行程节点。",
        failure: "行程节点没有保存。",
      });
      if (saved) {
        setDraft(EMPTY_DRAFT);
        setEditTarget(null);
        setFormOpen(false);
      }
      return;
    }

    const request = buildCreateStop(draft, ordered.length);
    const created = await mutate({
      label: "这个行程节点",
      execute: async () => {
        const response = await createStop.mutateAsync({ tripId, data: request });
        assertMutationOk(response, `/v1/trips/${tripId}/stops`);
        return response;
      },
      forbidden: "当前角色不能添加行程节点。",
      failure: "行程节点没有创建成功。",
    });
    if (created) {
      setDraft(EMPTY_DRAFT);
      setFormOpen(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const deleted = await mutate({
      label: "这个行程节点",
      execute: async () => {
        const response = await deleteStop.mutateAsync({ stopId: target.id });
        assertMutationOk(response, `/v1/stops/${target.id}`);
        return response;
      },
      forbidden: "当前角色不能删除行程节点。",
      failure: "行程节点没有删除。",
    });
    if (deleted) setDeleteTarget(null);
  }

  return (
    <>
      <QueryPanel
        title="行程节点"
        meta={
          stops.state === "ready"
            ? `${stops.data.length} 个节点 · 按顺序排列`
            : "读取中"
        }
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setFormError(null);
              setEditTarget(null);
              setDraft(EMPTY_DRAFT);
              setFormOpen(true);
            }}
            disabled={!capabilities.createStop}
            title={addTitle}
          >
            <Plus aria-hidden="true" />
            添加节点
          </Button>
        }
        result={stops}
        errorTitle="行程节点读取失败"
        isEmpty={(data) => data.length === 0}
        empty={
          <EmptyBlock
            icon={MapPin}
            title="还没有行程节点"
            description="添加第一站后，城市、日期、坐标来源会按顺序出现在这里，并进入地图与预算统计。"
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFormOpen(true)}
                disabled={!capabilities.createStop}
                title={addTitle}
              >
                <Plus aria-hidden="true" />
                添加第一个节点
              </Button>
            }
          />
        }
      >
        {(data) => (
          <ul className="divide-y divide-hairline">
            {[...data]
              .sort((left, right) => left.order - right.order)
              .map((stop, index) => (
                <StopRow
                  key={stop.id}
                  stop={stop}
                  index={index}
                  canEdit={capabilities.updateStop}
                  canDelete={capabilities.deleteStop}
                  editTitle={editTitle ?? ""}
                  deleteTitle={deleteTitle ?? ""}
                  onEdit={() => {
                    setFormError(null);
                    setEditTarget(stop);
                    setDraft(draftFromStop(stop));
                    setFormOpen(true);
                  }}
                  onDelete={() => setDeleteTarget(stop)}
                />
              ))}
          </ul>
        )}
      </QueryPanel>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <form onSubmit={(event) => void submitDraft(event)} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>{editTarget ? "编辑行程节点" : "添加行程节点"}</DialogTitle>
              <DialogDescription>
                {editTarget
                  ? `写入 \`PATCH /v1/stops/${editTarget.id}\`，携带 version ${editTarget.version}。冲突会打开版本冲突对话框。`
                  : `写入 \`POST /v1/trips/${tripId}/stops\`。地点搜索由 Photon 提供方后续接入，这里手动录入时 \`provider\` 留空。`}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="城市" id="stop-city">
                <Input
                  id="stop-city"
                  value={draft.city}
                  maxLength={120}
                  onChange={(event) => setDraft({ ...draft, city: event.target.value })}
                />
              </FormField>
              <FormField label="国家" id="stop-country">
                <Input
                  id="stop-country"
                  value={draft.country}
                  maxLength={120}
                  onChange={(event) => setDraft({ ...draft, country: event.target.value })}
                />
              </FormField>
              <FormField label="国家码" hint="ISO 3166-1 两位字母" id="stop-country-code">
                <Input
                  id="stop-country-code"
                  value={draft.countryCode}
                  maxLength={2}
                  onChange={(event) => setDraft({ ...draft, countryCode: event.target.value })}
                />
              </FormField>
              <FormField label="纬度（可选）" id="stop-lat">
                <Input
                  id="stop-lat"
                  value={draft.lat}
                  inputMode="decimal"
                  onChange={(event) => setDraft({ ...draft, lat: event.target.value })}
                />
              </FormField>
              <FormField label="开始日期" id="stop-start">
                <Input
                  id="stop-start"
                  type="date"
                  value={draft.startDate}
                  onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
                />
              </FormField>
              <FormField label="结束日期" id="stop-end">
                <Input
                  id="stop-end"
                  type="date"
                  value={draft.endDate}
                  onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
                />
              </FormField>
              <FormField label="经度（可选）" id="stop-lng">
                <Input
                  id="stop-lng"
                  value={draft.lng}
                  inputMode="decimal"
                  onChange={(event) => setDraft({ ...draft, lng: event.target.value })}
                />
              </FormField>
            </div>

            <FormField label="备注（可选）" error={formError} id="stop-notes">
              <Textarea
                id="stop-notes"
                rows={3}
                maxLength={4000}
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              />
            </FormField>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditTarget(null);
                  setFormOpen(false);
                }}
              >
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "保存中…" : "保存节点"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除这个行程节点？"
        description={
          deleteTarget
            ? `${deleteTarget.city}（${formatDateRange(deleteTarget.startDate, deleteTarget.endDate)}）会被软删除，顺序会保留空位。`
            : ""
        }
        pending={pending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}