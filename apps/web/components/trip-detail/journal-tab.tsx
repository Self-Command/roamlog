"use client";

import type { JournalEntry, Mood, WorkspaceRole } from "@roamlog/contracts";
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
} from "@roamlog/ui";
import { Heart, MapPin, MessageCircle, NotebookPen, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { canEdit, useDemoStore } from "@/lib/demo-store";
import {
  gradientFor,
  moodColors,
  moodLabels,
  shortDate,
  weatherLabels,
} from "@/lib/demo-format";

import { JournalEntrySheet } from "@/components/journal/journal-entry-sheet";

export function TripJournalTab({ tripId, role }: { tripId: string; role: WorkspaceRole }) {
  const { state, addEntry } = useDemoStore();
  const [query, setQuery] = useState("");
  const [mood, setMood] = useState<Mood | "all">("all");
  const [selected, setSelected] = useState<JournalEntry | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const trip = state.trips.find((candidate) => candidate.id === tripId);
  const entries = useMemo(
    () =>
      state.entries
        .filter((entry) => {
          if (entry.tripId !== tripId) return false;
          const text = `${entry.title} ${entry.location} ${entry.excerpt}`.toLocaleLowerCase("zh-CN");
          return (
            (!query.trim() || text.includes(query.trim().toLocaleLowerCase("zh-CN"))) &&
            (mood === "all" || entry.mood === mood)
          );
        })
        .sort((left, right) => right.date.localeCompare(left.date)),
    [mood, query, state.entries, tripId],
  );
  const comments = useMemo(() => {
    const counts = new Map<string, number>();
    state.comments.forEach((comment) =>
      counts.set(comment.targetId, (counts.get(comment.targetId) ?? 0) + 1),
    );
    return counts;
  }, [state.comments]);
  const editable = canEdit(role);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !location.trim() || !excerpt.trim()) return;
    addEntry(
      tripId,
      { title: title.trim(), location: location.trim(), excerpt: excerpt.trim() },
      role,
    );
    setTitle("");
    setLocation("");
    setExcerpt("");
    setDialogOpen(false);
  }

  return (
    <section className="surface-card overflow-hidden">
      <div className="border-b border-hairline p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="type-eyebrow">TRAVEL NOTES / {entries.length}</p>
            <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.025em] text-ink">
              {trip?.title ?? "旅行"} · 日志
            </h2>
          </div>
          {editable ? (
            <Button type="button" variant="outline" onClick={() => setDialogOpen(true)}>
              <NotebookPen aria-hidden="true" />
              写一篇
            </Button>
          ) : (
            <Badge tone="slate">VIEWER · 可读与评论</Badge>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-stone"
            />
            <Input
              type="search"
              aria-label="搜索旅行日志"
              placeholder="搜索标题、地点或摘要"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1 overflow-x-auto">
            <button
              type="button"
              aria-pressed={mood === "all"}
              onClick={() => setMood("all")}
              className={`h-10 shrink-0 rounded-control px-3 text-[11px] ${
                mood === "all" ? "bg-ink text-black" : "bg-surface-2 text-muted"
              }`}
            >
              全部
            </button>
            {(Object.keys(moodLabels) as Mood[]).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={mood === item}
                onClick={() => setMood(item)}
                className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-control px-3 text-[11px] ${
                  mood === item ? "bg-ink text-black" : "bg-surface-2 text-muted"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-pill ${moodColors[item]}`}
                />
                {moodLabels[item]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {entries.length ? (
        <div className="divide-y divide-hairline">
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelected(entry)}
              className="grid w-full grid-cols-[82px_minmax(0,1fr)] items-center gap-3 p-3 text-left hover:bg-surface-2 sm:grid-cols-[132px_minmax(0,1fr)_auto] sm:gap-4 sm:p-4"
            >
              <div
                className={`aspect-[4/3] rounded-control border border-hairline-strong bg-gradient-to-br ${gradientFor(entry.id)}`}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                  <span>{shortDate(entry.date)}</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin aria-hidden="true" className="size-3" />
                    {entry.location}
                  </span>
                  <span>{weatherLabels[entry.weather ?? "cloudy"]}</span>
                </div>
                <p className="mt-1 line-clamp-1 font-serif text-[23px] leading-tight text-ink">
                  {entry.title}
                </p>
                <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted">
                  {entry.excerpt}
                </p>
              </div>
              <div className="hidden items-center gap-3 sm:flex">
                {entry.favorite ? (
                  <Heart
                    aria-label="已收藏"
                    className="size-3.5 fill-accent-orange text-accent-orange"
                  />
                ) : null}
                <span className="inline-flex items-center gap-1 font-mono text-[9px] text-stone">
                  <MessageCircle aria-hidden="true" className="size-3" />
                  {comments.get(entry.id) ?? 0}
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-6 py-14 text-center">
          <NotebookPen aria-hidden="true" className="mx-auto size-5 text-stone" />
          <h3 className="mt-3 font-serif text-2xl text-ink">没有匹配的日志</h3>
          <p className="mt-2 text-sm text-muted">清除筛选，或写下这趟旅行的第一篇。</p>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <p className="type-eyebrow">NEW JOURNAL ENTRY</p>
            <DialogTitle>写一篇日志</DialogTitle>
            <DialogDescription>
              这是轻量本地编辑器，保存后立即出现在时间线；Tiptap 与版本历史尚未接入。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <FormField label="标题" required>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            </FormField>
            <FormField label="地点" required>
              <Input value={location} onChange={(event) => setLocation(event.target.value)} />
            </FormField>
            <FormField label="正文" required>
              <textarea
                value={excerpt}
                onChange={(event) => setExcerpt(event.target.value)}
                className="min-h-32 w-full resize-y rounded-control border border-hairline-strong bg-surface-1 px-3 py-2.5 text-sm leading-6 text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink"
                placeholder="今天发生了什么？"
              />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="outline">
                <Plus aria-hidden="true" />
                保存日志
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <JournalEntrySheet
        entry={selected}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </section>
  );
}
