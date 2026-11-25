"use client";

import { Button, EmptyState, ErrorState, PageHeader, Select, Skeleton } from "@roamlog/ui";
import dynamic from "next/dynamic";
import {
  Bookmark,
  BookmarkCheck,
  CalendarDays,
  Heart,
  MessageCircle,
  NotebookPen,
  RefreshCcw,
  Search,
} from "lucide-react";
import {
  Component,
  useDeferredValue,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useDataAdapter } from "@/lib/data-provider";
import { gradientFor, moodColors, moodLabels, shortDate } from "@/lib/demo-format";
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

import { createApiJournalRepository } from "@/components/journal/journal-repository";

const LazyJournalEditorSheet = dynamic(
  () =>
    import("@/components/journal/journal-editor-sheet").then((module) => module.JournalEditorSheet),
  {
    ssr: false,
    loading: () => <JournalEditorChunkLoading />,
  },
);

export function JournalEditorChunkLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-hairline-strong bg-canvas p-6 sm:p-8"
    >
      <p className="type-eyebrow">编辑日志</p>
      <h2 className="mt-2 font-display text-xl font-semibold text-ink">正在准备日志编辑器…</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        首次打开会加载排版与图片工具，之后会从缓存恢复。
      </p>
      <div className="mt-6 space-y-3">
        <Skeleton className="h-10 w-full rounded-control" />
        <Skeleton className="h-10 w-full rounded-control" />
        <Skeleton className="h-56 w-full rounded-card" />
      </div>
    </div>
  );
}

export function JournalEditorChunkError() {
  return (
    <div
      role="alert"
      className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-hairline-strong bg-canvas p-6 sm:p-8"
    >
      <p className="type-eyebrow">编辑日志</p>
      <h2 className="mt-2 font-display text-xl font-semibold text-ink">编辑器加载失败</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        网络可能中断，或新版本刚刚发布。刷新页面后重试即可。
      </p>
      <Button
        type="button"
        variant="primary"
        className="mt-5"
        onClick={() => window.location.reload()}
      >
        <RefreshCcw aria-hidden="true" />
        重新加载
      </Button>
    </div>
  );
}

interface JournalEditorChunkBoundaryProps {
  children: ReactNode;
}

interface JournalEditorChunkBoundaryState {
  failed: boolean;
}

class JournalEditorChunkBoundary extends Component<
  JournalEditorChunkBoundaryProps,
  JournalEditorChunkBoundaryState
> {
  override state: JournalEditorChunkBoundaryState = { failed: false };

  static getDerivedStateFromError(): JournalEditorChunkBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (process.env.NODE_ENV !== "production") {
      console.error("Journal editor chunk failed to load", error, info.componentStack);
    }
  }

  override render(): ReactNode {
    if (this.state.failed) return <JournalEditorChunkError />;
    return this.props.children;
  }
}

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
  const [editorRequested, setEditorRequested] = useState(false);

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
        description="日志暂时无法加载，请稍后重试。"
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
        eyebrow={`日志 / ${entries.length} 篇`}
        title="全部日志"
        description="搜索并筛选日志。只读成员可以阅读和评论，不能新建或收藏日志。"
        actions={
          canEdit ? (
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setEditorRequested(true);
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
                  onClick={() => {
                    setEditorRequested(true);
                    setSelectedId(entry.id);
                  }}
                  className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  <div
                    className={`relative aspect-video overflow-hidden border-b border-hairline ${gradientFor(entry.id)}`}
                  >
                    <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink/70">
                        {entry.date} · {entry.location}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-pill border border-hairline-strong bg-canvas/40 px-2 py-1 text-[9px] text-ink">
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
                    <h2 className="mt-2 font-prose text-xl leading-tight font-semibold tracking-[-0.01em] text-ink">
                      {entry.title}
                    </h2>
                    <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted">
                      {entry.excerpt}
                    </p>
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

      {editorRequested && selectedEntry ? (
        <JournalEditorChunkBoundary>
          <LazyJournalEditorSheet
            entry={selectedEntry}
            open
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
        </JournalEditorChunkBoundary>
      ) : null}

      {editorRequested && composeOpen ? (
        <JournalEditorChunkBoundary>
          <LazyJournalEditorSheet
            open
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
        </JournalEditorChunkBoundary>
      ) : null}
    </div>
  );
}
