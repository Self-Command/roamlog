"use client";

import { useCreatePackingItem, useDeletePackingItem, useUpdatePackingItem } from "@roamlog/api-client";
import type { CreatePackingItemRequest, PackingCategory, PackingItem } from "@roamlog/contracts";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Label,
  Progress,
  Select,
} from "@roamlog/ui";
import { Luggage, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";

import { deniedReason } from "./capabilities";
import { ConfirmDialog } from "./dialogs";
import { PACKING_CATEGORIES, PACKING_CATEGORY_LABELS } from "./format";
import { useMemberDirectory } from "./member-directory";
import { EmptyBlock, QueryPanel } from "./panel";
import { assertMutationOk, latestPackingVersion, usePacking } from "./queries";
import { useTripWorkspace } from "./workspace-context";

function PackingRow({
  item,
  assigneeName,
  canUpdate,
  updateTitle,
  pending,
  onToggle,
  onDelete,
}: {
  item: PackingItem;
  assigneeName: string | null;
  canUpdate: boolean;
  updateTitle: string;
  pending: boolean;
  onToggle: (item: PackingItem) => void;
  onDelete: (item: PackingItem) => void;
}) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Checkbox
        id={`packing-${item.id}`}
        checked={item.packed}
        disabled={!canUpdate || pending}
        title={canUpdate ? (item.packed ? "标记为未打包" : "标记为已打包") : updateTitle}
        onCheckedChange={() => onToggle(item)}
        aria-label={item.packed ? `标记 ${item.name} 为未打包` : `标记 ${item.name} 为已打包`}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <Label
          htmlFor={`packing-${item.id}`}
          className={`mb-0 block text-[13px] leading-5 normal-case tracking-normal ${
            item.packed ? "text-stone line-through" : "text-ink"
          }`}
        >
          {item.name}
          {item.quantity > 1 ? (
            <span className="ml-1.5 font-mono text-[10px] text-muted">×{item.quantity}</span>
          ) : null}
        </Label>
        <p className="mt-0.5 text-[11px] leading-4 text-muted">
          {PACKING_CATEGORY_LABELS[item.category]}
          {assigneeName ? ` · ${assigneeName}` : " · 未指派"}
          <span className="ml-1.5 font-mono text-[9px] text-stone">V{item.version}</span>
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onDelete(item)}
        aria-label={`删除行李 ${item.name}`}
        disabled={!canUpdate}
        title={canUpdate ? "删除这件行李" : updateTitle}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </li>
  );
}

export function PackingTab({ tripId }: { tripId: string }) {
  const { capabilities, mutate, pending, role } = useTripWorkspace();
  const packing = usePacking(tripId);
  const createItem = useCreatePackingItem();
  const updateItem = useUpdatePackingItem();
  const deleteItem = useDeletePackingItem();
  const directory = useMemberDirectory();

  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; category: PackingCategory; quantity: string }>({
    name: "",
    category: "clothing",
    quantity: "1",
  });
  const [deleteTarget, setDeleteTarget] = useState<PackingItem | null>(null);

  const updateTitle = capabilities.updatePacking ? undefined : deniedReason(role, "修改行李");

  const groups = useMemo(() => {
    if (packing.state !== "ready") return [];
    const byCategory = new Map<PackingCategory, PackingItem[]>();
    for (const item of packing.data.items) {
      byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), item]);
    }
    return PACKING_CATEGORIES.flatMap((category) => {
      const items = byCategory.get(category);
      if (!items || items.length === 0) return [];
      return [{ category, items: [...items].sort((a, b) => a.order - b.order) }];
    });
  }, [packing]);

  const progress = useMemo(() => {
    if (packing.state !== "ready") return { total: 0, packed: 0, percent: 0 };
    const total = packing.data.items.length;
    const packed = packing.data.items.filter((item) => item.packed).length;
    return { total, packed, percent: total === 0 ? 0 : Math.round((packed / total) * 100) };
  }, [packing]);

  /**
   * Toggle is the workspace's versioned PATCH: `{ version, packed }`. A `409`
   * opens `ConflictDialog`; 「覆盖保存」 re-reads the current version first.
   */
  async function toggle(item: PackingItem) {
    const next = !item.packed;
    await mutate({
      label: "这件行李",
      execute: async () => {
        const response = await updateItem.mutateAsync({
          itemId: item.id,
          data: { version: item.version, packed: next },
        });
        assertMutationOk(response, `/v1/packing/${item.id}`);
        return response;
      },
      retryAfterConflict: async () => {
        const version = await latestPackingVersion(tripId, item.id);
        if (version === null) {
          throw new Error("这件行李已经不存在，无法覆盖保存。");
        }
        const response = await updateItem.mutateAsync({
          itemId: item.id,
          data: { version, packed: next },
        });
        assertMutationOk(response, `/v1/packing/${item.id}`);
        return response;
      },
      forbidden: "当前角色不能修改行李。",
      failure: "行李状态没有更新。",
    });
  }

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) {
      setFormError("请填写行李名称。");
      return;
    }
    const quantity = Number(draft.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      setFormError("数量必须是 1–999 的整数。");
      return;
    }

    const payload: CreatePackingItemRequest = {
      category: draft.category,
      name,
      quantity,
      order: packing.state === "ready" ? packing.data.items.length : 0,
    };

    setFormError(null);
    const created = await mutate({
      label: "这件行李",
      execute: async () => {
        const response = await createItem.mutateAsync({ tripId, data: payload });
        assertMutationOk(response, `/v1/trips/${tripId}/packing`);
        return response;
      },
      forbidden: "当前角色不能添加行李。",
      failure: "行李没有添加。",
    });
    if (created) {
      setDraft({ name: "", category: "clothing", quantity: "1" });
      setFormOpen(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const deleted = await mutate({
      label: "这件行李",
      execute: async () => {
        const response = await deleteItem.mutateAsync({ itemId: target.id });
        assertMutationOk(response, `/v1/packing/${target.id}`);
        return response;
      },
      forbidden: "当前角色不能删除行李。",
      failure: "行李没有删除。",
    });
    if (deleted) setDeleteTarget(null);
  }

  return (
    <>
      <QueryPanel
        title="行李"
        meta={
          packing.state === "ready"
            ? `${progress.packed}/${progress.total} 已打包`
            : "读取中"
        }
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setFormError(null);
              setFormOpen(true);
            }}
            disabled={!capabilities.createPacking}
            title={capabilities.createPacking ? undefined : deniedReason(role, "添加行李")}
          >
            <Plus aria-hidden="true" />
            添加行李
          </Button>
        }
        result={packing}
        errorTitle="行李读取失败"
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyBlock
            icon={Luggage}
            title="行李清单还是空的"
            description="按证件、衣物、装备、健康分类添加，勾选后进度会实时更新。"
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFormOpen(true)}
                disabled={!capabilities.createPacking}
                title={capabilities.createPacking ? undefined : deniedReason(role, "添加行李")}
              >
                <Plus aria-hidden="true" />
                添加第一件
              </Button>
            }
          />
        }
      >
        {() => (
          <div>
            <div className="border-b border-hairline px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="type-eyebrow">打包进度</p>
                <p className="font-mono text-[11px] text-ink">{progress.percent}%</p>
              </div>
              <Progress
                value={progress.percent}
                aria-label="行李打包进度"
                aria-valuetext={`${progress.packed} / ${progress.total} 已打包`}
                className="mt-2"
                indicatorClassName="motion-reduce:transition-none!"
              />
            </div>
            {groups.map((group) => (
              <section key={group.category} className="border-b border-hairline last:border-b-0">
                <div className="flex items-baseline justify-between gap-2 bg-surface-2/40 px-4 py-2">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">
                    {PACKING_CATEGORY_LABELS[group.category]}
                  </h3>
                  <span className="font-mono text-[9px] text-stone">
                    {group.items.filter((item) => item.packed).length}/{group.items.length}
                  </span>
                </div>
                <ul className="divide-y divide-hairline">
                  {group.items.map((item) => (
                    <PackingRow
                      key={item.id}
                      item={item}
                      assigneeName={item.assigneeId ? directory.nameOf(item.assigneeId) : null}
                      canUpdate={capabilities.updatePacking}
                      updateTitle={updateTitle ?? ""}
                      pending={pending}
                      onToggle={(target) => void toggle(target)}
                      onDelete={(target) => setDeleteTarget(target)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </QueryPanel>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <form onSubmit={(event) => void submitDraft(event)} className="space-y-4" noValidate>
            <DialogHeader>
              <DialogTitle>添加行李</DialogTitle>
              <DialogDescription>
                写入 `POST /v1/trips/{tripId}/packing`，顺序取当前清单长度。
              </DialogDescription>
            </DialogHeader>
            <FormField label="名称" id="packing-name">
              <Input
                id="packing-name"
                value={draft.name}
                maxLength={160}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="分类" id="packing-category">
                <Select
                  id="packing-category"
                  value={draft.category}
                  onChange={(event) =>
                    setDraft({ ...draft, category: event.target.value as PackingCategory })
                  }
                >
                  {PACKING_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {PACKING_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="数量" error={formError} id="packing-quantity">
                <Input
                  id="packing-quantity"
                  value={draft.quantity}
                  inputMode="numeric"
                  onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
                />
              </FormField>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "保存中…" : "保存行李"}
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
        title="删除这件行李？"
        description={deleteTarget ? `${deleteTarget.name} 会从清单里移除。` : ""}
        pending={pending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}