import { PublicAiChatResponseSchema } from "@roamlog/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { PublicChat, PublicChatError } from "@/components/ai/public-chat";

const DEFAULT_API_ORIGIN = "http://localhost:4000";

function apiOrigin(): string {
  return (
    process.env.API_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    DEFAULT_API_ORIGIN
  ).replace(/\/+$/, "");
}

type LoadResult =
  | { kind: "ready"; data: ReturnType<typeof PublicAiChatResponseSchema.parse> }
  | { kind: "not-found" }
  | { kind: "error" };

/** React request cache: metadata and the page share one API read per request. */
const loadPublicChat = cache(async (token: string): Promise<LoadResult> => {
  try {
    const response = await fetch(
      new URL(`/v1/public/ai-chats/${encodeURIComponent(token)}`, apiOrigin()),
      {
        cache: "no-store",
        headers: { accept: "application/json" },
      },
    );
    if (response.status === 404) return { kind: "not-found" };
    if (response.status !== 200) return { kind: "error" };

    const parsed = PublicAiChatResponseSchema.safeParse(await response.json().catch(() => null));
    return parsed.success ? { kind: "ready", data: parsed.data } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const result = await loadPublicChat(token);
  return {
    title: result.kind === "ready" ? (result.data.title ?? "共享 AI 对话") : "共享 AI 对话",
    description: "Roamlog 公开展示的只读 AI 旅行对话。",
    robots: { index: false, follow: false },
  };
}

export default async function PublicChatPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await loadPublicChat(token);
  if (result.kind === "not-found") notFound();
  if (result.kind === "error") return <PublicChatError />;
  return <PublicChat data={result.data} />;
}
