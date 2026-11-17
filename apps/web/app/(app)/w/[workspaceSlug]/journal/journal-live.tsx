"use client";

import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  PageHeader,
  Select,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Textarea,
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
import { useDeferredValue, useMemo, useState, type FormEvent } from "react";

import { isForbidden } from "@/lib/api";
import {
  gradientFor,
  moodColors,
  moodLabels,
  shortDate,
} from "@/lib/demo-format";
import {
  useCommentsQuery,
  useCreateCommentMutation,
  useCreateEntryMutation,
  useEntriesQuery,
  useFavoriteEntryMutation,
  useMembersQuery,
  useTripsQuery,
  useWorkspaceBySlug,
} from "@/lib/query";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function JournalLive({ workspaceSlug }: { workspaceSlug: string }) {
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const tripsQuery = useTripsQuery(workspace?.id);
  const membersQuery = useMembersQuery(workspace?.id);
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
  const createEntry = useCreateEntryMutation();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const [tripId, setTripId] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [body, setBody] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [formError, setFormError] = useState<string | null>(null);

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

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEntry || !workspace || !comment.trim()) return;
    setCommentError(null);
    try {
      await createComment.mutateAsync({
        tripId: selectedEntry.tripId,
        targetType: "journal_entry",
        targetId: selectedEntry.id,
        body: comment.trim(),
      });
      setComment("");
    } catch (cause) {
      setCommentError(
        isForbidden(cause) ? "你的角色不能评论这个日志。" : "评论没有发送成功，请重试。",
      );
    }
  }

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tripId || !title.trim() || !location.trim() || !body.trim()) {
      setFormError("请选择旅行，并填写标题、地点和正文。");
      return;
    }
    setFormError(null);
    try {
      const text = body.trim();
      await createEntry.mutateAsync({
        tripId,
        input: {
          title: title.trim(),
          date,
          location: location.trim(),
          contentJson: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text }],
              },
            ],
          },
          contentHtml: `<p>${escapeHtml(text)}</p>`,
          excerpt: text.slice(0, 180),
          tags: [],
        },
      });
      setComposeOpen(false);
      setTitle("");
      setLocation("");
      setBody("");
      setNotice("日志已保存到真实 API。");
    } catch (cause) {
      setFormError(isForbidden(cause) ? "你的角色不能在这个 Workspace 写日志。" : "日志保存失败。");
    }
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
                setTripId(trips[0]?.id ?? "");
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

      {notice ? (
        <p
          role="status"
          className="rounded-control border border-accent-green/20 bg-accent-green/5 px-3 py-2 text-xs text-accent-green"
        >
          {notice}
        </p>
      ) : null}

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

      <Sheet
        open={Boolean(selectedEntry)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setComment("");
            setCommentError(null);
          }
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          {selectedEntry ? (
            <>
              <SheetHeader>
                <p className="type-eyebrow">
                  {trips.find((trip) => trip.id === selectedEntry.tripId)?.title ?? "LOG ENTRY"}
                </p>
                <SheetTitle className="font-serif text-3xl tracking-[-0.03em]">
                  {selectedEntry.title}
                </SheetTitle>
                <SheetDescription>
                  {selectedEntry.date} · {selectedEntry.location} · VERSION {selectedEntry.version}
                </SheetDescription>
              </SheetHeader>
              <div
                className="mt-5 text-sm leading-7 text-body"
                dangerouslySetInnerHTML={{ __html: selectedEntry.contentHtml }}
              />
              <div className="mt-6 flex flex-wrap gap-2">
                {selectedEntry.tags.map((tag) => (
                  <Badge key={tag} tone="neutral">
                    {tag}
                  </Badge>
                ))}
              </div>

              <section className="mt-8 border-t border-hairline pt-5" aria-label="评论">
                <div className="flex items-center justify-between">
                  <h3 className="font-serif text-xl text-ink">评论</h3>
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
                    {commentsQuery.data?.items.length ?? 0} THREADS
                  </span>
                </div>
                <div className="mt-4 space-y-4">
                  {commentsQuery.isLoading ? <Skeleton className="h-20 rounded-card" /> : null}
                  {commentsQuery.data?.items.map((item) => {
                    const author = members.find((member) => member.userId === item.authorId)?.user;
                    return (
                      <div key={item.id} className="flex items-start gap-3">
                        <Avatar name={author?.name ?? "成员"} src={author?.image ?? undefined} size={28} />
                        <div className="min-w-0 flex-1 rounded-card border border-hairline bg-surface-1 px-3 py-2.5">
                          <p className="text-[11px] text-ink">{author?.name ?? "成员"}</p>
                          <p className="mt-1 text-xs leading-5 text-body">{item.body}</p>
                          <p className="mt-1 font-mono text-[9px] text-stone">
                            {item.createdAt.slice(0, 16).replace("T", " ")}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {commentsQuery.data?.items.length === 0 ? (
                    <p className="text-xs text-muted">还没有评论。Viewer 也可以在这里参与讨论。</p>
                  ) : null}
                </div>

                <form className="mt-5 space-y-2" onSubmit={(event) => void submitComment(event)}>
                  <Textarea
                    value={comment}
                    onChange={(event) => {
                      setComment(event.target.value);
                      if (commentError) setCommentError(null);
                    }}
                    placeholder="写下评论，输入 @ 提及成员…"
                    aria-label="评论内容"
                    rows={3}
                  />
                  {commentError ? (
                    <p role="alert" className="text-xs text-accent-red">
                      {commentError}
                    </p>
                  ) : null}
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={!comment.trim() || createComment.isPending}
                    >
                      发送评论
                    </Button>
                  </div>
                </form>
              </section>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="sm:max-w-lg">
          <form onSubmit={(event) => void submitEntry(event)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>写日志</DialogTitle>
              <DialogDescription>
                日志会写入真实 API，并生成第一个 revision。正文先以纯文本保存。
              </DialogDescription>
            </DialogHeader>
            <FormField label="旅行">
              <Select value={tripId} onChange={(event) => setTripId(event.target.value)}>
                <option value="">选择旅行</option>
                {trips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.title}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="标题">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={180}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="日期">
                <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </FormField>
              <FormField label="地点">
                <Input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  maxLength={160}
                />
              </FormField>
            </div>
            <FormField label="正文">
              <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} />
            </FormField>
            {formError ? (
              <p role="alert" className="text-xs text-accent-red">
                {formError}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setComposeOpen(false)}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={createEntry.isPending}>
                <NotebookPen aria-hidden="true" />
                保存日志
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
