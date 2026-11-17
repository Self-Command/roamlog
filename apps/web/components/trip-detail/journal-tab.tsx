"use client";

import type { JournalEntry, Mood, WorkspaceRole } from "@roamlog/contracts";
import { Badge, Button, Input } from "@roamlog/ui";
import {
  Heart,
  MapPin,
  MessageCircle,
  NotebookPen,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  gradientFor,
  moodColors,
  moodLabels,
  shortDate,
  weatherLabels,
} from "@/lib/demo-format";
import { canEdit, useDemoStore } from "@/lib/demo-store";

import { JournalEditorSheet } from "@/components/journal/journal-editor-sheet";
import {
  createMockJournalRepository,
  mergeMockJournalEntries,
  readMockJournalOverrides,
} from "@/components/journal/journal-repository";

export function TripJournalTab({ tripId, role }: { tripId: string; role: WorkspaceRole }) {
  const { state, currentUser, toggleEntryFavorite, addComment } = useDemoStore();
  const [query, setQuery] = useState("");
  const [mood, setMood] = useState<Mood | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [savedEntries, setSavedEntries] = useState<Record<string, JournalEntry>>({});
  const trip = state.trips.find((candidate) => candidate.id === tripId);
  const editable = canEdit(role);

  useEffect(() => {
    const overrides = readMockJournalOverrides();
    if (!overrides.length) return;
    setSavedEntries((current) => {
      const merged = { ...current };
      overrides.forEach((entry) => {
        merged[entry.id] = entry;
      });
      return merged;
    });
  }, []);

  const allEntries = useMemo(() => {
    const byId = new Map(mergeMockJournalEntries(state.entries).map((entry) => [entry.id, entry]));
    Object.values(savedEntries).forEach((entry) => byId.set(entry.id, entry));
    return [...byId.values()];
  }, [savedEntries, state.entries]);

  const entries = useMemo(
    () =>
      allEntries
        .filter((entry) => {
          if (entry.tripId !== tripId) return false;
          const text = `${entry.title} ${entry.location} ${entry.excerpt}`.toLocaleLowerCase(
            "zh-CN",
          );
          return (
            (!query.trim() || text.includes(query.trim().toLocaleLowerCase("zh-CN"))) &&
            (mood === "all" || entry.mood === mood)
          );
        })
        .sort((left, right) => right.date.localeCompare(left.date)),
    [allEntries, mood, query, tripId],
  );
  const comments = useMemo(() => {
    const counts = new Map<string, number>();
    state.comments.forEach((comment) =>
      counts.set(comment.targetId, (counts.get(comment.targetId) ?? 0) + 1),
    );
    return counts;
  }, [state.comments]);
  const selectedEntry = selectedId
    ? allEntries.find((entry) => entry.id === selectedId) ?? null
    : null;
  const selectedComments = state.comments.filter((comment) => comment.targetId === selectedId);
  const repository = useMemo(
    () =>
      createMockJournalRepository({
        resolveEntry: (entryId) => allEntries.find((entry) => entry.id === entryId),
        currentUserId: currentUser.id,
        workspaceId: trip?.workspaceId ?? state.entries[0]?.workspaceId ?? "",
        tripId,
        location: "本地演示地点",
      }),
    [allEntries, currentUser.id, state.entries, trip?.workspaceId, tripId],
  );

  function handleEntrySaved(entry: JournalEntry) {
    setSavedEntries((current) => ({ ...current, [entry.id]: entry }));
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
            <Button type="button" variant="outline" onClick={() => setCreateOpen(true)}>
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
            <article
              key={entry.id}
              className="flex items-center gap-3 p-3 hover:bg-surface-2 sm:gap-4 sm:p-4"
            >
              <button
                type="button"
                onClick={() => setSelectedId(entry.id)}
                className="grid min-w-0 flex-1 grid-cols-[82px_minmax(0,1fr)] items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-4"
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
              </button>
              <div className="hidden items-center gap-3 sm:flex">
                <button
                  type="button"
                  aria-label={entry.favorite ? "取消收藏" : "收藏日志"}
                  aria-pressed={entry.favorite}
                  disabled={!editable}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleEntryFavorite(entry.id);
                  }}
                  className="flex size-8 items-center justify-center rounded-control border border-hairline bg-surface-2 text-muted hover:text-ink disabled:opacity-40"
                >
                  <Heart
                    aria-hidden="true"
                    className={`size-3.5 ${entry.favorite ? "fill-accent-orange text-accent-orange" : ""}`}
                  />
                </button>
                <span className="inline-flex items-center gap-1 font-mono text-[9px] text-stone">
                  <MessageCircle aria-hidden="true" className="size-3" />
                  {comments.get(entry.id) ?? 0}
                </span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="px-6 py-14 text-center">
          <NotebookPen aria-hidden="true" className="mx-auto size-5 text-stone" />
          <h3 className="mt-3 font-serif text-2xl text-ink">没有匹配的日志</h3>
          <p className="mt-2 text-sm text-muted">清除筛选，或写下这趟旅行的第一篇。</p>
        </div>
      )}

      <JournalEditorSheet
        entry={selectedEntry}
        open={selectedEntry !== null}
        repository={repository}
        canEdit={editable}
        canComment
        members={state.members}
        currentUserId={currentUser.id}
        comments={selectedComments}
        onEntrySaved={handleEntrySaved}
        onSubmitComment={(body, mentionIds) => {
          if (selectedEntry) addComment(selectedEntry.id, body, mentionIds);
        }}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
      <JournalEditorSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        repository={repository}
        tripId={tripId}
        trips={state.trips}
        initialTripId={tripId}
        canEdit={editable}
        canComment={false}
        members={state.members}
        currentUserId={currentUser.id}
        onEntrySaved={handleEntrySaved}
      />
    </section>
  );
}
