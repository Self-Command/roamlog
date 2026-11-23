"use client";

/**
 * Read-only public conversation, using the same message structure as
 * vercel/chatbot's `components/chat/messages.tsx` + `message.tsx`
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0).
 *
 * There is deliberately no composer, action bar, model selector or artifact
 * editor here: an anonymous visitor gets the conversation content only. Text
 * and image parts are the only content the public API exposes, so tool payloads
 * and provider metadata cannot be rendered even accidentally.
 */

import type {
  PublicAiChatContentPart,
  PublicAiChatMessage,
  PublicAiChatResponse,
} from "@roamlog/contracts";
import { Sparkles } from "lucide-react";

import { Markdown } from "./markdown";

function dateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ContentParts({
  parts,
  align,
}: {
  parts: readonly PublicAiChatContentPart[];
  align: "start" | "end";
}) {
  return (
    <div className={align === "end" ? "flex flex-col items-end gap-2" : "space-y-2"}>
      {parts.map((part, index) =>
        part.type === "text" ? (
          <div
            className={
              align === "end"
                ? "whitespace-pre-wrap break-words text-sm leading-6 text-ink"
                : "min-w-0"
            }
            key={`text-${String(index)}`}
          >
            {align === "end" ? part.text : <Markdown text={part.text} />}
          </div>
        ) : (
          <a
            aria-label={`查看图片 ${part.filename ?? ""}`.trim()}
            className="block h-40 max-w-full overflow-hidden rounded-control border border-hairline-strong bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-ink"
            href={part.image}
            key={`image-${String(index)}`}
            rel="noreferrer"
            target="_blank"
          >
            {/* Signed object-store URL; no Next image host allow-list is needed. */}
            <img
              alt={part.filename ?? "分享的图片"}
              className="h-full w-auto max-w-full object-contain"
              loading="lazy"
              src={part.image}
            />
          </a>
        ),
      )}
    </div>
  );
}

function PublicMessage({ message }: { message: PublicAiChatMessage }) {
  if (message.role === "user") {
    return (
      <article className="flex w-full justify-end" data-testid="public-message-user">
        <div className="flex max-w-[85%] flex-col items-end gap-1">
          <div className="flex max-w-full flex-col items-end rounded-card border border-hairline-strong bg-surface-2 px-4 py-3">
            <ContentParts align="end" parts={message.content} />
          </div>
          <time
            className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone"
            dateTime={message.createdAt}
          >
            {dateLabel(message.createdAt)}
          </time>
        </div>
      </article>
    );
  }

  return (
    <article className="flex w-full justify-start gap-3" data-testid="public-message-assistant">
      <div className="flex h-7 shrink-0 items-center">
        <div className="flex size-7 items-center justify-center rounded-card bg-surface-2 text-muted ring-1 ring-hairline-strong">
          <Sparkles aria-hidden="true" className="size-3.5" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="min-w-0">
          <ContentParts align="start" parts={message.content} />
        </div>
        <time
          className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone"
          dateTime={message.createdAt}
        >
          {dateLabel(message.createdAt)}
        </time>
      </div>
    </article>
  );
}

export function PublicChat({ data }: { data: PublicAiChatResponse }) {
  return (
    <main className="min-h-dvh bg-canvas">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <header className="border-b border-hairline pb-6">
          <a
            className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted transition-colors hover:text-ink"
            href="/"
          >
            Roamlog / Shared AI conversation
          </a>
          <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-serif text-3xl leading-tight tracking-[-0.03em] text-ink sm:text-4xl">
                {data.title?.trim() || "AI 旅行助手对话"}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted">
                分享者公开展示的 AI 规划对话。页面为只读，不能继续发送消息或修改旅行。
              </p>
            </div>
            <span className="rounded-pill border border-hairline-strong px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted">
              只读
            </span>
          </div>
          <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
            {dateLabel(data.createdAt)}
            {data.messages.length > 0 ? ` · ${String(data.messages.length)} 条消息` : ""}
          </p>
        </header>

        {data.messages.length === 0 ? (
          <p className="py-20 text-center text-sm text-muted">这段分享还没有消息。</p>
        ) : (
          <div className="flex flex-col gap-7 py-8" data-testid="public-chat-messages">
            {data.messages.map((message) => (
              <PublicMessage key={message.id} message={message} />
            ))}
          </div>
        )}

        <footer className="mt-4 border-t border-hairline pt-5 text-center text-[11px] leading-5 text-stone">
          内容由分享者发布。Roamlog 不会在公开页面展示账号信息、系统提示或工具内部数据。
        </footer>
      </div>
    </main>
  );
}

export function PublicChatError({ notFound = false }: { notFound?: boolean }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-5">
      <div className="w-full max-w-md rounded-card border border-hairline-strong bg-surface-1 p-6 text-center">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-stone">
          Shared AI conversation
        </p>
        <h1 className="mt-4 font-serif text-3xl tracking-[-0.03em] text-ink">
          {notFound ? "这个分享链接已失效" : "暂时无法读取分享"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          {notFound
            ? "会话可能已改为私密、被删除，或链接从未存在。请联系分享者获取新的链接。"
            : "分享服务没有正常响应，请稍后刷新页面重试。"}
        </p>
        <a
          className="mt-6 inline-flex h-9 items-center justify-center rounded-control border border-hairline-strong px-4 text-sm text-ink transition-colors hover:bg-surface-2"
          href="/"
        >
          返回 Roamlog
        </a>
      </div>
    </main>
  );
}
