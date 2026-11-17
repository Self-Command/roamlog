"use client";

import type { PackingCategory, WorkspaceRole } from "@roamlog/contracts";
import { Badge, Button, Checkbox, Input, Progress, Select } from "@roamlog/ui";
import { Backpack, CheckCheck, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";

import { canEdit, useDemoStore } from "@/lib/demo-store";

const categoryLabels: Record<PackingCategory, string> = {
  documents: "证件",
  clothing: "衣物",
  gear: "装备",
  health: "健康",
  other: "其他",
};

export function PackingTab({ tripId, role }: { tripId: string; role: WorkspaceRole }) {
  const { state, setPackingPacked, addPackingItem, setAllPacked } = useDemoStore();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<PackingCategory>("other");
  const items = useMemo(
    () => state.packing.filter((item) => item.tripId === tripId),
    [state.packing, tripId],
  );
  const packed = items.filter((item) => item.packed).length;
  const percent = items.length ? Math.round((packed / items.length) * 100) : 0;
  const editable = canEdit(role);
  const grouped = useMemo(() => {
    const map = new Map<PackingCategory, typeof items>();
    items.forEach((item) => map.set(item.category, [...(map.get(item.category) ?? []), item]));
    return [...map.entries()];
  }, [items]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    addPackingItem(tripId, { name: name.trim(), category }, role);
    setName("");
  }

  return (
    <section className="surface-card overflow-hidden">
      <div className="border-b border-hairline p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="type-eyebrow">PACKING / {percent}% READY</p>
            <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink">出发前清单</h2>
            <p className="mt-2 text-xs text-muted">
              已打包 {packed} 件 / 共 {items.length} 件
            </p>
          </div>
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAllPacked(tripId, true, role)}
              >
                <CheckCheck aria-hidden="true" />
                全部打包
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAllPacked(tripId, false, role)}
              >
                <RotateCcw aria-hidden="true" />
                重置
              </Button>
            </div>
          ) : (
            <Badge tone="slate">VIEWER · 只读</Badge>
          )}
        </div>
        <Progress value={percent} className="mt-4 h-2" indicatorClassName="bg-accent-green" />
      </div>

      <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-hairline">
        {grouped.map(([groupCategory, groupItems]) => (
          <section key={groupCategory} className="border-b border-hairline p-4 last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <h3 className="type-eyebrow text-body">{categoryLabels[groupCategory]}</h3>
              <span className="font-mono text-[9px] text-stone">
                {groupItems.filter((item) => item.packed).length}/{groupItems.length}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {groupItems.map((item) => {
                const assignee = state.members.find(
                  (member) => member.userId === item.assigneeId,
                )?.user;
                return (
                  <label
                    key={item.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-2 py-1.5 hover:bg-surface-2"
                  >
                    <Checkbox
                      checked={item.packed}
                      disabled={!editable}
                      aria-label={item.name}
                      onCheckedChange={(checked) =>
                        setPackingPacked(item.id, checked === true, role)
                      }
                    />
                    <span
                      className={`min-w-0 flex-1 text-[12px] ${
                        item.packed ? "text-muted line-through" : "text-body"
                      }`}
                    >
                      {item.name}
                      {item.quantity > 1 ? (
                        <span className="ml-1 font-mono text-[9px] text-stone">
                          ×{item.quantity}
                        </span>
                      ) : null}
                    </span>
                    {assignee ? (
                      <span className="truncate font-mono text-[8px] text-stone">
                        {assignee.name}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {editable ? (
        <form
          role="form"
          aria-label="新增打包物品"
          onSubmit={submit}
          className="flex flex-col gap-2 border-t border-hairline bg-surface-2 p-4 sm:flex-row"
        >
          <div className="flex-1">
            <label htmlFor="packing-name" className="sr-only">
              新增物品
            </label>
            <Input
              id="packing-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="增加一项，例如：转换插头"
            />
          </div>
          <div className="sm:w-32">
            <label htmlFor="packing-category" className="sr-only">
              分类
            </label>
            <Select
              id="packing-category"
              value={category}
              onChange={(event) => setCategory(event.target.value as PackingCategory)}
            >
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="outline">
            <Backpack aria-hidden="true" />
            添加
          </Button>
        </form>
      ) : null}
    </section>
  );
}
