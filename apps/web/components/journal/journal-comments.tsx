"use client";

import type { Comment, WorkspaceMemberWithUser } from "@roamlog/contracts";
import { Avatar, Badge, Button } from "@roamlog/ui";
import { MessageCircle, Send } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { isForbidden } from "@/lib/api";
import { ReportMenu } from "@/components/moderation/report-menu";

interface JournalCommentsProps {
  comments: Comment[];
  members: WorkspaceMemberWithUser[];
  currentUserId?: string;
  loading?: boolean;
  disabled?: boolean;
  onSubmit?: (body: string, mentionUserIds: string[]) => Promise<void> | void;
}

function commentTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function JournalComments({
  comments,
  members,
  currentUserId,
  loading = false,
  disabled = false,
  onSubmit,
}: JournalCommentsProps) {
  const id = useId();
  const [body, setBody] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mentionMatch = body.match(/@([^\s@]*)$/);
  const suggestions = useMemo(() => {
    if (!mentionMatch) return [];
    const query = mentionMatch[1]?.toLocaleLowerCase("zh-CN") ?? "";
    return members.filter(
      (member) =>
        member.userId !== currentUserId &&
        (!query || member.user.name.toLocaleLowerCase("zh-CN").includes(query)),
    );
  }, [currentUserId, mentionMatch, members]);

  function chooseMention(memberId: string, name: string) {
    setBody((current) => current.replace(/@([^\s@]*)$/, `@${name} `));
    setMentionIds((current) => [...new Set([...current, memberId])]);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSubmit || !body.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await onSubmit(body.trim(), mentionIds);
      setBody("");
      setMentionIds([]);
    } catch (cause) {
      setError(isForbidden(cause) ? "你的角色不能评论这个日志。" : "评论没有发送成功，请重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="type-eyebrow">评论</p>
          <h3 id={`${id}-title`} className="mt-1 font-display text-lg font-semibold text-ink">
            评论
          </h3>
        </div>
        <Badge tone="neutral">{loading ? "…" : comments.length}</Badge>
      </div>

      <div className="space-y-2">
        {loading ? (
          <p className="rounded-card border border-hairline bg-surface-1 px-3 py-4 text-xs text-muted">
            正在读取评论…
          </p>
        ) : comments.length === 0 ? (
          <p className="rounded-card border border-dashed border-hairline-strong px-4 py-5 text-center text-xs text-muted">
            <MessageCircle aria-hidden="true" className="mx-auto mb-2 size-4 text-stone" />
            还没有评论，写下第一句。
          </p>
        ) : (
          comments.map((comment) => {
            const author = members.find((member) => member.userId === comment.authorId)?.user;
            return (
              <article
                key={comment.id}
                className="flex gap-3 rounded-card border border-hairline bg-surface-1 p-3.5"
              >
                <Avatar name={author?.name ?? "同行者"} src={author?.image ?? undefined} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-ink">{author?.name ?? "同行者"}</p>
                    <ReportMenu
                      workspaceId={comment.workspaceId}
                      target={{
                        type: "comment",
                        id: comment.id,
                        label: comment.body.slice(0, 120),
                      }}
                      label={`更多操作：${author?.name ?? "同行者"}的评论`}
                    />
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5 text-body">
                    {comment.body}
                  </p>
                  <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.06em] text-stone">
                    {commentTime(comment.createdAt)}
                  </p>
                </div>
              </article>
            );
          })
        )}
      </div>

      {onSubmit && !disabled ? (
        <form onSubmit={(event) => void submit(event)} className="relative">
          <label htmlFor={`${id}-input`} className="sr-only">
            评论内容
          </label>
          <textarea
            id={`${id}-input`}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              if (error) setError(null);
            }}
            placeholder="写下评论，输入 @ 提及成员…"
            className="min-h-24 w-full resize-y rounded-control border border-hairline-strong bg-surface-1 px-3 py-2.5 pr-12 text-sm leading-6 text-ink outline-none placeholder:text-stone focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          />
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="absolute bottom-2.5 right-2.5 size-9 p-0"
            aria-label="发送评论"
            disabled={!body.trim() || pending}
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
                  <Avatar name={member.user.name} src={member.user.image ?? undefined} size={22} />
                  {member.user.name}
                </button>
              ))}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="mt-2 text-xs text-accent-red">
              {error}
            </p>
          ) : null}
        </form>
      ) : disabled ? (
        <p className="text-xs text-muted">当前角色只能阅读评论。</p>
      ) : null}
    </section>
  );
}
