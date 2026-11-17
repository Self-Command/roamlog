"use client";

import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  Skeleton,
} from "@roamlog/ui";
import {
  Bookmark,
  BookmarkCheck,
  CalendarDays,
  Heart,
  MessageCircle,
  NotebookPen,
  Search,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useDataAdapter } from "@/lib/data-provider";
import {
  gradientFor,
  moodColors,
  moodLabels,
  shortDate,
} from "@/lib/demo-format";
import {
  useCommentsQuery,
  useCreateCommentMutation,
  useEntriesQuery,
  useFavoriteEntryMutation,
  useMeQuery,
  useMembersQuery,
  useTripsQuery,
  useWorkspaceBySlug,
} from "@/lib/query";

import { JournalEditorSheet } from "@/components/journal/journal-editor-sheet";
import { createApiJournalRepository } from "@/components/journal/journal-repository";

export function JournalLive({ workspaceSlug }: { workspaceSlug: string }) {
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const tripsQuery = useTripsQuery(workspace?.id);
  const membersQuery = useMembersQuery(workspace?.id);
  const meQuery = useMeQuery();
  const [query, setQuery] = useState("");
  const [tripFilter, setTripFilter] = useState("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const deferredQuery = useDeferredValue(query.trim());
  const entriesQuery = useEntriesQuery(workspace?.id, {
    limit: 100,
    sort: "date:desc",
    ...(deferredQuery ? { q: deferredQuery } : {}),
    ...(favoriteOnly ? { favorite: true } : {}),
  });
  const favoriteEntry = useFavoriteEntryMutation();
  const createComment = useCreateCommentMutation();
  const adapter = useDataAdapter();
  const queryClient = useQueryClient();
  const repository = useMemo(() => createApiJournalRepository(adapter), [adapter]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);

  const trips = tripsQuery.data?.items ?? [];
  const members = membersQuery.data?.items ?? [];
  const entries = useMemo(
    () =>
      (entriesQuery.data?.items ?? []).filter(
        (entry) => tripFilter === "all" || entry.tripId === tripFilter,
      ),
    [entriesQuery.data?.items, tripFilter],
  );
  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null;
  const commentsQuery = useCommentsQuery("journal_entry", selectedEntry?.id);
  const canEdit = workspace ? workspace.role !== "viewer" : false;

  if (workspacesQuery.isLoading || entriesQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-12 w-52" />
        <Skeleton className="h-11 w-full rounded-control" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-72 rounded-card" />
          ))}
        </div>
      </div>
    );
  }

  if (!workspace || entriesQuery.error) {
    return (
      <ErrorState
        title="日志不可用"
        description="Workspace 或日志列表没有返回。检查 API 会话后重试。"
        retryAction={
          <Button type="button" variant="primary" onClick={() => void entriesQuery.refetch()}>
            重新加载
          </Button>
        }
      />
    );
  }

  function handleEntrySaved() {
    void queryClient.invalidateQueries({ queryKey: ["v1", "entries"] });
    void queryClient.invalidateQueries({ queryKey: ["v1", "trip-entries"] });
  }

  async function handleComment(body: string, mentionUserIds: string[]) {
    if (!selectedEntry) return;
    await createComment.mutateAsync({
      tripId: selectedEntry.tripId,
      targetType: "journal_entry",
      targetId: selectedEntry.id,
      body,
      mentionUserIds,
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`JOURNAL / ${entries.length} ENTRIES`}
        title="全部日志"
        description="搜索、筛选与评论来自真实 API。Viewer 可以阅读和评论，但不能新建或收藏。"
        actions={
          canEdit ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setComposeOpen(true);
              }}
              disabled={trips.length === 0}
            >
              <NotebookPen aria-hidden="true" />
              写日志
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 border-b border-hairline pb-3 lg:flex-row lg:items-center">
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-control border border-hairline-strong bg-surface-1 px-3">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索日志"
            placeholder="搜索标题、地点、标签或旅行…"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-stone"
          />
        </div>
        <Select
          value={tripFilter}
          onChange={(event) => setTripFilter(event.target.value)}
          aria-label="按旅行筛选"
          className="h-11 w-full lg:w-60"
        >
          <option value="all">全部旅行</option>
          {trips.map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.title}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant={favoriteOnly ? "primary" : "outline"}
          onClick={() => setFavoriteOnly((value) => !value)}
        >
          {favoriteOnly ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
          仅收藏
        </Button>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="没有匹配日志"
          description="换一个关键词或旅行，或者写下第一段路上的记录。"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry) => {
            const trip = trips.find((candidate) => candidate.id === entry.tripId);
            return (
              <article
                key={entry.id}
                className="group flex flex-col overflow-hidden rounded-card border border-hairline-strong bg-surface-1"
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(entry.id)}
                  className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  <div
                    className={`relative aspect-video overflow-hidden border-b border-hairline bg-gradient-to-br ${gradientFor(entry.id)}`}
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(255,255,255,0.16),transparent_45%)]" />
                    <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/70">
                        {entry.date} · {entry.location}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-pill border border-white/15 bg-black/30 px-2 py-1 text-[9px] text-white/80">
                        <span
                          aria-hidden="true"
                          className={`size-1.5 rounded-pill ${moodColors[entry.mood ?? "calm"]}`}
                        />
                        {moodLabels[entry.mood ?? "calm"]}
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="type-eyebrow">{trip?.title ?? "未知旅行"}</p>
                    <h2 className="mt-2 font-serif text-2xl leading-tight tracking-[-0.025em] text-ink">
                      {entry.title}
                    </h2>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted">{entry.excerpt}</p>
                  </div>
                </button>
                <div className="mt-auto flex items-center justify-between border-t border-hairline px-4 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-[10px] text-stone">
                    <CalendarDays aria-hidden="true" className="size-3" />
                    {shortDate(entry.date)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[10px] text-stone">
                      <MessageCircle aria-hidden="true" className="size-3" />
                      {entry.favorite ? "收藏" : entry.version}
                    </span>
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label={entry.favorite ? "取消收藏" : "收藏日志"}
                        aria-pressed={entry.favorite}
                        onClick={() =>
                          void favoriteEntry.mutateAsync({
                            entryId: entry.id,
                            favorite: !entry.favorite,
                          })
                        }
                        className="inline-flex size-8 items-center justify-center rounded-control border border-hairline bg-surface-2 text-muted hover:text-ink"
                      >
                        <Heart
                          aria-hidden="true"
                          className={`size-3.5 ${entry.favorite ? "fill-accent-orange text-accent-orange" : ""}`}
                        />
                      </button>
                    ) : null}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <JournalEditorSheet
        entry={selectedEntry}
        open={selectedEntry !== null}
        repository={repository}
        canEdit={canEdit}
        canComment
        members={members}
        currentUserId={meQuery.data?.id}
        comments={commentsQuery.data?.items ?? []}
        commentsLoading={commentsQuery.isLoading}
        onSubmitComment={handleComment}
        onEntrySaved={handleEntrySaved}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />

      <JournalEditorSheet
        open={composeOpen}
        onOpenChange={setComposeOpen}
        repository={repository}
        trips={trips}
        initialTripId={trips[0]?.id}
        canEdit={canEdit}
        canComment={false}
        members={members}
        currentUserId={meQuery.data?.id}
        onEntrySaved={handleEntrySaved}
      />
    </div>
  );
}
