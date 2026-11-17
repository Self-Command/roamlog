"use client";

import type { JournalEntry } from "@roamlog/contracts";
import {
  Avatar,
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@roamlog/ui";
import { Heart, MapPin, Send, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

import { useDemoStore } from "@/lib/demo-store";
import {
  entryBody,
  gradientFor,
  moodColors,
  moodLabels,
  shortDate,
  weatherLabels,
} from "@/lib/demo-format";

interface JournalEntrySheetProps {
  entry: JournalEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function JournalEntrySheet({ entry, open, onOpenChange }: JournalEntrySheetProps) {
  const { state, currentUser, toggleEntryFavorite, addComment } = useDemoStore();
  const [body, setBody] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const trip = state.trips.find((candidate) => candidate.id === entry?.tripId);
  const comments = state.comments.filter((comment) => comment.targetId === entry?.id);
  const photos = state.media.filter((media) => media.tripId === entry?.tripId).slice(0, 4);

  const mentionMatch = body.match(/@([^\s@]*)$/);
  const suggestions = useMemo(() => {
    const query = mentionMatch?.[1]?.toLocaleLowerCase("zh-CN") ?? "";
    if (!mentionMatch) return [];
    return state.members.filter(
      (member) =>
        member.userId !== currentUser.id &&
        (!query || member.user.name.toLocaleLowerCase("zh-CN").includes(query)),
    );
  }, [currentUser.id, mentionMatch, state.members]);

  if (!entry) return null;

  function chooseMention(memberId: string, name: string) {
    setBody((current) => current.replace(/@([^\s@]*)$/, `@${name} `));
    setMentionIds((current) => [...new Set([...current, memberId])]);
  }

  function submitComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entry || !body.trim()) return;
    addComment(entry.id, body, mentionIds);
    setBody("");
    setMentionIds([]);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">{trip?.title ?? "旅行日志"}</Badge>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              {shortDate(entry.date)} · {weatherLabels[entry.weather ?? "cloudy"]}
            </span>
          </div>
          <SheetTitle className="type-journal-title mt-2">{entry.title}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="inline-flex items-center gap-1.5">
              <MapPin aria-hidden="true" className="size-3.5" />
              {entry.location}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`size-1.5 rounded-pill ${moodColors[entry.mood ?? "calm"]}`}
              />
              {moodLabels[entry.mood ?? "calm"]}
            </span>
            <span>版本 {entry.version}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2">
            {photos.map((photo, index) => (
              <div
                key={photo.id}
                className={`relative min-h-28 overflow-hidden rounded-card border border-hairline-strong bg-gradient-to-br ${gradientFor(photo.id)}`}
              >
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.16),transparent_45%)]" />
                <span className="absolute left-2.5 top-2.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/70">
                  FRAME / {String(index + 1).padStart(2, "0")}
                </span>
                <p className="absolute inset-x-3 bottom-3 line-clamp-2 text-[11px] leading-5 text-white/75">
                  {photo.caption ?? photo.location ?? "旅行现场"}
                </p>
              </div>
            ))}
          </div>

          <article className="surface-card p-5">
            <p className="whitespace-pre-line text-[14px] leading-7 text-body">
              {entryBody(entry)}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
              {entry.tags.map((tag) => (
                <Badge key={tag} tone="neutral">
                  {tag}
                </Badge>
              ))}
              <Button
                type="button"
                variant={entry.favorite ? "subtle" : "outline"}
                size="sm"
                className="ml-auto"
                aria-pressed={entry.favorite}
                onClick={() => toggleEntryFavorite(entry.id)}
              >
                <Heart
                  aria-hidden="true"
                  className={entry.favorite ? "fill-accent-orange text-accent-orange" : undefined}
                />
                {entry.favorite ? "已收藏" : "收藏"}
              </Button>
            </div>
          </article>

          <section aria-labelledby="entry-comments-title">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="type-eyebrow">COMMENTS</p>
                <h2
                  id="entry-comments-title"
                  className="mt-1.5 font-serif text-2xl tracking-[-0.02em] text-ink"
                >
                  同行者的话
                </h2>
              </div>
              <Badge tone="neutral">{comments.length}</Badge>
            </div>

            <div className="mt-3 space-y-2">
              {comments.length ? (
                comments.map((comment) => {
                  const author = state.members.find(
                    (member) => member.userId === comment.authorId,
                  )?.user;
                  return (
                    <article
                      key={comment.id}
                      className="flex gap-3 rounded-card border border-hairline bg-surface-1 p-3.5"
                    >
                      <Avatar name={author?.name ?? "同行者"} size={30} />
                      <div className="min-w-0">
                        <p className="text-xs text-ink">{author?.name ?? "同行者"}</p>
                        <p className="mt-1 text-[12px] leading-5 text-body">{comment.body}</p>
                        <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                          {shortDate(comment.createdAt.slice(0, 10))}
                        </p>
                      </div>
                    </article>
                  );
                })
              ) : (
                <p className="rounded-card border border-dashed border-hairline-strong px-4 py-6 text-center text-xs text-muted">
                  还没有评论，写下第一句。
                </p>
              )}
            </div>

            <form onSubmit={submitComment} className="relative mt-3">
              <label htmlFor="entry-comment" className="sr-only">
                评论内容
              </label>
              <textarea
                id="entry-comment"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="写下评论，输入 @ 提及成员…"
                className="min-h-24 w-full resize-y rounded-control border border-hairline-strong bg-surface-1 px-3 py-2.5 pr-12 text-sm leading-6 text-ink outline-none placeholder:text-stone focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="absolute bottom-2.5 right-2.5 size-9 p-0"
                aria-label="发送评论"
                disabled={!body.trim()}
              >
                <Send aria-hidden="true" />
              </Button>

              {suggestions.length ? (
                <div className="absolute inset-x-2 bottom-14 z-10 rounded-control border border-hairline-strong bg-surface-2 p-1.5 shadow-2xl">
                  <p className="px-2 py-1 type-eyebrow">提及成员</p>
                  {suggestions.slice(0, 4).map((member) => (
                    <button
                      key={member.userId}
                      type="button"
                      onClick={() => chooseMention(member.userId, member.user.name)}
                      className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-xs text-body hover:bg-surface-1 hover:text-ink"
                    >
                      <Avatar name={member.user.name} size={22} />
                      {member.user.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </form>
          </section>

          <div className="flex items-start gap-2 rounded-card border border-hairline bg-surface-1 p-3">
            <Sparkles aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent-orange" />
            <p className="text-[10px] leading-5 text-muted">
              评论与收藏会立即写入当前浏览器的本地演示状态；真实 API、presence 与邮件通知尚未接入。
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
