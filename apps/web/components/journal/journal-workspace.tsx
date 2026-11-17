"use client";

import type { JournalEntry, Mood } from "@roamlog/contracts";
import {
  Avatar,
  Button,
  Input,
  PageHeader,
  Select,
} from "@roamlog/ui";
import {
  CalendarDays,
  Heart,
  LayoutGrid,
  List,
  MapPin,
  MessageCircle,
  NotebookPen,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useDemoStore } from "@/lib/demo-store";
import {
  gradientFor,
  moodColors,
  moodLabels,
  monthLabel,
  shortDate,
  weatherLabels,
} from "@/lib/demo-format";

import { JournalEditorSheet } from "./journal-editor-sheet";
import {
  createMockJournalRepository,
  mergeMockJournalEntries,
  readMockJournalOverrides,
} from "./journal-repository";

type ViewMode = "grid" | "list";

export function JournalWorkspace({ workspaceSlug }: { workspaceSlug: string }) {
  const { state, currentRole, currentUser, addComment } = useDemoStore();
  const [query, setQuery] = useState("");
  const [tripFilter, setTripFilter] = useState("all");
  const [moodFilter, setMoodFilter] = useState<Mood | "all">("all");
  const [sortOrder, setSortOrder] = useState("newest");
  const [view, setView] = useState<ViewMode>("grid");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [savedEntries, setSavedEntries] = useState<Record<string, JournalEntry>>({});

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
    const merged = mergeMockJournalEntries(state.entries);
    const byId = new Map(merged.map((entry) => [entry.id, entry]));
    Object.values(savedEntries).forEach((entry) => byId.set(entry.id, entry));
    return [...byId.values()];
  }, [savedEntries, state.entries]);

  const tripById = useMemo(
    () => new Map(state.trips.map((trip) => [trip.id, trip])),
    [state.trips],
  );
  const commentsByEntry = useMemo(() => {
    const counts = new Map<string, number>();
    state.comments.forEach((comment) => {
      counts.set(comment.targetId, (counts.get(comment.targetId) ?? 0) + 1);
    });
    return counts;
  }, [state.comments]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    return allEntries
      .filter((entry) => {
        const trip = tripById.get(entry.tripId);
        const text = [
          entry.title,
          entry.location,
          entry.excerpt,
          entry.tags.join(" "),
          trip?.title ?? "",
        ]
          .join(" ")
          .toLocaleLowerCase("zh-CN");
        return (
          (!normalized || text.includes(normalized)) &&
          (tripFilter === "all" || entry.tripId === tripFilter) &&
          (moodFilter === "all" || entry.mood === moodFilter)
        );
      })
      .sort((left, right) =>
        sortOrder === "newest"
          ? right.date.localeCompare(left.date)
          : left.date.localeCompare(right.date),
      );
  }, [allEntries, moodFilter, query, sortOrder, tripById, tripFilter]);

  const selectedEntry = selectedEntryId
    ? allEntries.find((entry) => entry.id === selectedEntryId) ?? null
    : null;
  const selectedComments = useMemo(
    () => state.comments.filter((comment) => comment.targetId === selectedEntryId),
    [selectedEntryId, state.comments],
  );
  const repository = useMemo(
    () =>
      createMockJournalRepository({
        resolveEntry: (entryId) => allEntries.find((entry) => entry.id === entryId),
        currentUserId: currentUser.id,
        workspaceId: allEntries[0]?.workspaceId ?? state.entries[0]?.workspaceId ?? "",
        tripId: state.trips[0]?.id ?? "",
        location: "本地演示地点",
      }),
    [allEntries, currentUser.id, state.entries, state.trips],
  );

  function handleEntrySaved(entry: JournalEntry) {
    setSavedEntries((current) => ({ ...current, [entry.id]: entry }));
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, JournalEntry[]>();
    filtered.forEach((entry) => {
      const key = entry.date.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    });
    return [...groups.entries()];
  }, [filtered]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (query.trim()) url.searchParams.set("q", query.trim());
    else url.searchParams.delete("q");
    if (tripFilter !== "all") url.searchParams.set("trip", tripFilter);
    else url.searchParams.delete("trip");
    if (moodFilter !== "all") url.searchParams.set("mood", moodFilter);
    else url.searchParams.delete("mood");
    window.history.replaceState(null, "", url);
  }, [moodFilter, query, tripFilter]);

  function clearFilters() {
    setQuery("");
    setTripFilter("all");
    setMoodFilter("all");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`JOURNAL / ${String(allEntries.length).padStart(2, "0")} ENTRIES`}
        title="全部日志"
        description="按月份翻阅，或沿着心情、旅行和关键词重新遇见某一天。每一条都能打开右侧详情并继续评论。"
        actions={
          <>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="hidden sm:inline-flex"
            >
              <a href={`/w/${workspaceSlug}/trips`}>
                <CalendarDays aria-hidden="true" />
                按旅行浏览
              </a>
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => setComposeOpen(true)}
            >
              <NotebookPen aria-hidden="true" />
              写日志
            </Button>
          </>
        }
      />

      <section className="surface-card overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-hairline px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-pill bg-accent-orange" />
            <p className="type-eyebrow text-body">ARCHIVE INDEX</p>
          </div>
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
            {filtered.length} / {allEntries.length} ENTRIES · LOCAL FIXTURE
          </p>
        </div>

        <div className="space-y-3 p-3 sm:p-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_210px_160px_auto]">
            <div className="relative sm:col-span-2 xl:col-span-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-stone"
              />
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索标题、地点、正文或标签"
                aria-label="搜索日志"
                className="pl-9 pr-9"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="清除搜索"
                  onClick={() => setQuery("")}
                  className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-control text-muted hover:bg-surface-2 hover:text-ink"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              ) : null}
            </div>

            <Select
              value={tripFilter}
              onChange={(event) => setTripFilter(event.target.value)}
              aria-label="按旅行筛选"
            >
              <option value="all">全部旅行</option>
              {state.trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.title}
                </option>
              ))}
            </Select>

            <Select
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              aria-label="排序方式"
            >
              <option value="newest">最新在前</option>
              <option value="oldest">最早在前</option>
            </Select>

            <div className="flex h-11 items-center justify-between rounded-control border border-hairline-strong bg-surface-2 p-1 md:h-10">
              <div className="flex gap-0.5">
                <button
                  type="button"
                  aria-label="网格视图"
                  aria-pressed={view === "grid"}
                  onClick={() => setView("grid")}
                  className={`flex size-8 items-center justify-center rounded-[5px] ${
                    view === "grid" ? "bg-white/10 text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  <LayoutGrid aria-hidden="true" className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="列表视图"
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                  className={`flex size-8 items-center justify-center rounded-[5px] ${
                    view === "list" ? "bg-white/10 text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  <List aria-hidden="true" className="size-3.5" />
                </button>
              </div>
              <span className="px-2 font-mono text-[9px] uppercase text-stone">
                {filtered.length} PCS
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-t border-hairline pt-3">
            <span className="type-eyebrow mr-1">MOOD</span>
            <button
              type="button"
              onClick={() => setMoodFilter("all")}
              aria-pressed={moodFilter === "all"}
              className={`h-8 rounded-pill border px-3 text-[11px] ${
                moodFilter === "all"
                  ? "border-hairline-strong bg-surface-2 text-ink"
                  : "border-transparent text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              全部
            </button>
            {(Object.keys(moodLabels) as Mood[]).map((mood) => (
              <button
                key={mood}
                type="button"
                onClick={() => setMoodFilter(mood)}
                aria-pressed={moodFilter === mood}
                className={`inline-flex h-8 items-center gap-1.5 rounded-pill border px-3 text-[11px] ${
                  moodFilter === mood
                    ? "border-hairline-strong bg-surface-2 text-ink"
                    : "border-transparent text-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-pill ${moodColors[mood]}`}
                />
                {moodLabels[mood]}
              </button>
            ))}
            {query || tripFilter !== "all" || moodFilter !== "all" ? (
              <button
                type="button"
                onClick={clearFilters}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-pill px-2 text-[10px] text-muted hover:text-ink"
              >
                <X aria-hidden="true" className="size-3" />
                清除筛选
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {grouped.length ? (
        <div className="space-y-8">
          {grouped.map(([month, entries], index) => (
            <section key={month} aria-label={`${monthLabel(month)} 的日志`}>
              <div className="mb-3 flex items-center gap-3">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
                  {monthLabel(month)}
                </h2>
                <span
                  aria-hidden="true"
                  className={`size-1 rounded-pill ${
                    index === 0 ? "bg-accent-orange" : "bg-stone"
                  }`}
                />
                <span className="font-mono text-[9px] uppercase text-stone">
                  {String(entries.length).padStart(2, "0")} ENTRIES
                </span>
                <div className="h-px flex-1 bg-hairline" />
              </div>

              {view === "grid" ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {entries.map((entry) => {
                    const trip = tripById.get(entry.tripId);
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSelectedEntryId(entry.id)}
                        className="group flex h-full w-full flex-col overflow-hidden rounded-card border border-hairline-strong bg-surface-1 text-left transition-colors hover:border-white/25"
                      >
                        <div
                          className={`relative aspect-video overflow-hidden border-b border-hairline bg-gradient-to-br ${gradientFor(entry.id)}`}
                        >
                          <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,0.16),transparent_45%)]" />
                          <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
                            <span className="max-w-[calc(100%-2rem)] truncate rounded-pill border border-white/10 bg-black/55 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-white/75 backdrop-blur">
                              {trip?.title ?? "旅途"}
                            </span>
                            {entry.favorite ? (
                              <span className="flex size-6 items-center justify-center rounded-pill border border-white/10 bg-black/55">
                                <Heart
                                  aria-hidden="true"
                                  className="size-3 fill-accent-orange text-accent-orange"
                                />
                              </span>
                            ) : null}
                          </div>
                          <span className="absolute bottom-3 left-3 font-mono text-[9px] uppercase tracking-[0.12em] text-white/70">
                            {shortDate(entry.date)} · {weatherLabels[entry.weather ?? "cloudy"]}
                          </span>
                        </div>
                        <div className="flex flex-1 flex-col p-4">
                          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.06em] text-muted">
                            <span className="inline-flex min-w-0 items-center gap-1">
                              <MapPin aria-hidden="true" className="size-3 shrink-0" />
                              <span className="truncate">{entry.location}</span>
                            </span>
                            <span className="ml-auto inline-flex items-center gap-1">
                              <MessageCircle aria-hidden="true" className="size-3" />
                              {commentsByEntry.get(entry.id) ?? 0}
                            </span>
                          </div>
                          <h3 className="mt-3 font-serif text-[26px] leading-[1.12] tracking-[-0.025em] text-ink">
                            {entry.title}
                          </h3>
                          <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-muted">
                            {entry.excerpt}
                          </p>
                          <div className="mt-auto flex items-center justify-between border-t border-hairline pt-3 text-[10px] text-stone">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                aria-hidden="true"
                                className={`size-1.5 rounded-pill ${moodColors[entry.mood ?? "calm"]}`}
                              />
                              {moodLabels[entry.mood ?? "calm"]}
                            </span>
                            <span className="font-mono uppercase tracking-[0.08em]">
                              阅读 ↗
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-hidden rounded-card border border-hairline-strong bg-surface-1">
                  {entries.map((entry) => {
                    const trip = tripById.get(entry.tripId);
                    const author = state.members.find(
                      (member) => member.userId === entry.createdById,
                    )?.user;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSelectedEntryId(entry.id)}
                        className="grid w-full grid-cols-[74px_minmax(0,1fr)] items-center gap-3 border-b border-hairline px-3 py-3 text-left last:border-b-0 hover:bg-surface-2 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:gap-4 sm:px-4"
                      >
                        <div
                          className={`aspect-[16/9] rounded-control border border-hairline-strong bg-gradient-to-br ${gradientFor(entry.id)}`}
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase text-stone">
                            <span>{shortDate(entry.date)}</span>
                            <span>{entry.location}</span>
                            <span className="hidden sm:inline">{trip?.title}</span>
                          </div>
                          <p className="mt-1 truncate font-serif text-xl text-ink">{entry.title}</p>
                          <p className="mt-1 line-clamp-1 text-[11px] text-muted">{entry.excerpt}</p>
                        </div>
                        <div className="hidden items-center gap-3 sm:flex">
                          <Avatar name={author?.name ?? "记录者"} size={26} />
                          <span className="inline-flex items-center gap-1 font-mono text-[9px] text-stone">
                            <MessageCircle aria-hidden="true" className="size-3" />
                            {commentsByEntry.get(entry.id) ?? 0}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-card border border-dashed border-hairline-strong bg-surface-1 px-6 py-14 text-center">
          <Search aria-hidden="true" className="mx-auto size-5 text-stone" />
          <h2 className="mt-3 font-serif text-2xl text-ink">没有找到匹配的日志</h2>
          <p className="mt-2 text-sm text-muted">换一个关键词、旅行或心情，再翻翻路上的字。</p>
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
            清除筛选
          </Button>
        </div>
      )}

      <JournalEditorSheet
        entry={selectedEntry}
        open={selectedEntry !== null}
        repository={repository}
        canEdit={currentRole !== "viewer"}
        canComment
        members={state.members}
        currentUserId={currentUser.id}
        comments={selectedComments}
        onEntrySaved={handleEntrySaved}
        onSubmitComment={(body, mentionIds) => {
          if (selectedEntry) addComment(selectedEntry.id, body, mentionIds);
        }}
        onOpenChange={(open) => {
          if (!open) setSelectedEntryId(null);
        }}
      />
      <JournalEditorSheet
        open={composeOpen}
        onOpenChange={setComposeOpen}
        repository={repository}
        trips={state.trips}
        initialTripId={state.trips[0]?.id}
        canEdit={currentRole !== "viewer"}
        canComment={false}
        members={state.members}
        currentUserId={currentUser.id}
        onEntrySaved={handleEntrySaved}
      />
    </div>
  );
}
