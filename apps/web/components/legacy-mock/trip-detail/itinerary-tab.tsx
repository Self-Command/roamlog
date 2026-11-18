"use client";

import type { ItineraryItem, WorkspaceRole } from "@roamlog/contracts";
import {
  Badge,
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
  Select,
} from "@roamlog/ui";
import { CalendarPlus, CheckCircle2, Clock3, MapPin, Plus, UserRound } from "lucide-react";
import { useMemo, useState } from "react";

import { canEdit, useDemoStore } from "@/lib/demo-store";
import { shortDate } from "@/lib/demo-format";

const typeLabels: Record<ItineraryItem["type"], string> = {
  transit: "交通",
  food: "餐饮",
  activity: "活动",
  stay: "住宿",
  note: "备注",
};

export function ItineraryTab({ tripId, role }: { tripId: string; role: WorkspaceRole }) {
  const { state, addItineraryItem, setItineraryDone } = useDemoStore();
  const trip = state.trips.find((candidate) => candidate.id === tripId);
  const items = useMemo(
    () =>
      state.itinerary
        .filter((item) => item.tripId === tripId)
        .sort((left, right) => left.date.localeCompare(right.date) || left.order - right.order),
    [state.itinerary, tripId],
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [type, setType] = useState<ItineraryItem["type"]>("activity");
  const [date, setDate] = useState(trip?.startDate ?? "2026-11-17");

  const editable = canEdit(role);
  const groups = useMemo(() => {
    const map = new Map<string, ItineraryItem[]>();
    items.forEach((item) => map.set(item.date, [...(map.get(item.date) ?? []), item]));
    return [...map.entries()];
  }, [items]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !location.trim()) return;
    addItineraryItem(
      tripId,
      { title: title.trim(), location: location.trim(), date, type },
      role,
    );
    setTitle("");
    setLocation("");
    setDialogOpen(false);
  }

  return (
    <section className="surface-card overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-hairline p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="type-eyebrow">ITINERARY / {items.length} ITEMS</p>
          <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink">按日期整理</h2>
          <p className="mt-2 text-xs leading-5 text-muted">
            勾选完成会立即写入本地状态；拖拽排序留待真实 API 接入。
          </p>
        </div>
        {editable ? (
          <Button type="button" variant="outline" onClick={() => setDialogOpen(true)}>
            <Plus aria-hidden="true" />
            添加行程
          </Button>
        ) : (
          <Badge tone="slate">VIEWER · 只读</Badge>
        )}
      </div>

      {items.length ? (
        <div className="divide-y divide-hairline">
          {groups.map(([dateValue, group]) => (
            <div key={dateValue} className="grid gap-3 p-4 sm:grid-cols-[110px_minmax(0,1fr)] sm:p-5">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink">
                  {shortDate(dateValue)}
                </p>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                  DAY {String(groups.findIndex(([date]) => date === dateValue) + 1).padStart(2, "0")}
                </p>
              </div>
              <ol className="space-y-2">
                {group.map((item) => {
                  const assignee = state.members.find(
                    (member) => member.userId === item.assigneeId,
                  )?.user;
                  return (
                    <li
                      key={item.id}
                      className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-card border border-hairline bg-surface-1 p-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                    >
                      <div className="flex items-start pt-0.5">
                        <Checkbox
                          checked={item.done}
                          disabled={!editable}
                          aria-label={`完成${item.title}`}
                          onCheckedChange={(checked) =>
                            setItineraryDone(tripId, item.id, checked === true, role)
                          }
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p
                            className={
                              item.done
                                ? "text-sm text-muted line-through"
                                : "text-sm font-medium text-ink"
                            }
                          >
                            {item.title}
                          </p>
                          <Badge tone="neutral">{typeLabels[item.type]}</Badge>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                          <span className="inline-flex items-center gap-1">
                            <Clock3 aria-hidden="true" className="size-3" />
                            {item.startTime
                              ? `${item.startTime}${item.endTime ? `–${item.endTime}` : ""}`
                              : "全天"}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin aria-hidden="true" className="size-3" />
                            {item.location}
                          </span>
                          {assignee ? (
                            <span className="inline-flex items-center gap-1">
                              <UserRound aria-hidden="true" className="size-3" />
                              {assignee.name}
                            </span>
                          ) : null}
                        </div>
                        {item.notes ? (
                          <p className="mt-2 text-[11px] leading-5 text-muted">{item.notes}</p>
                        ) : null}
                      </div>
                      <div className="hidden items-start gap-1.5 sm:flex">
                        {item.done ? (
                          <CheckCircle2
                            aria-label="已完成"
                            className="size-4 text-accent-green"
                          />
                        ) : (
                          <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                            PLANNED
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-6 py-14 text-center">
          <CalendarPlus aria-hidden="true" className="mx-auto size-5 text-stone" />
          <h3 className="mt-3 font-serif text-2xl text-ink">还没有排定行程</h3>
          <p className="mt-2 text-sm text-muted">把第一段交通或晚餐加进来。</p>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <p className="type-eyebrow">NEW ITINERARY ITEM</p>
            <DialogTitle>添加行程</DialogTitle>
            <DialogDescription>为这趟旅行补上一段安排，保存后立即出现在时间线。</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <FormField label="行程标题">
              <Input
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：汉江夜跑"
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="日期" required>
                <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </FormField>
              <FormField label="类型">
                <Select
                  value={type}
                  onChange={(event) => setType(event.target.value as ItineraryItem["type"])}
                >
                  {Object.entries(typeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            <FormField label="地点">
              <Input
                required
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="城市、车站或具体地点"
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="outline">
                加入行程
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
