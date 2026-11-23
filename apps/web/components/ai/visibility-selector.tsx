"use client";

/**
 * Conversation visibility selector, ported from vercel/chatbot
 * `components/chat/visibility-selector.tsx`,
 * `components/chat/sidebar-history-item.tsx:40-113` and
 * `components/chat/chat-header.tsx:28-55`
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0).
 *
 * The upstream dropdown has exactly two states: private and public. Roamlog
 * keeps that structure and adds only the adaptation the public-link contract
 * requires: while public, the same menu exposes a copy action for the signed
 * URL. The server returns a new URL after every visibility transition, so a
 * copied URL is revoked as soon as the conversation is made private again.
 */

import type { AiConversation, AiConversationVisibility } from "@roamlog/contracts";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@roamlog/ui";
import { Check, ChevronDown, Copy, Globe2, Lock, Share2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";

import { setConversationVisibility } from "@/lib/api/ai-conversations";

import { cn } from "./cn";

export type { AiConversationVisibility };

export function visibilityFromThreadCustom(
  custom: Record<string, unknown> | undefined,
): AiConversationVisibility {
  return custom?.visibility === "public" ? "public" : "private";
}

export function shareUrlFromThreadCustom(
  custom: Record<string, unknown> | undefined,
): string | null {
  return typeof custom?.shareUrl === "string" && custom.shareUrl.length > 0
    ? custom.shareUrl
    : null;
}

const VISIBILITIES: ReadonlyArray<{
  id: AiConversationVisibility;
  label: string;
  description: string;
  icon: typeof Lock;
}> = [
  {
    id: "private",
    label: "私密",
    description: "只有你可以查看这个会话",
    icon: Lock,
  },
  {
    id: "public",
    label: "公开",
    description: "任何拿到链接的人都可以只读查看",
    icon: Globe2,
  },
];

interface VisibilityState {
  visibility: AiConversationVisibility;
  shareUrl: string | null;
  busy: boolean;
  copied: boolean;
  error: string | null;
  setVisibility: (next: AiConversationVisibility) => Promise<void>;
  copy: () => Promise<void>;
}

function useConversationVisibility(args: {
  workspaceId: string;
  conversationId: string | null;
  initialVisibility: AiConversationVisibility;
  initialShareUrl: string | null;
  onUpdated?: (conversation: AiConversation) => void | Promise<void>;
}): VisibilityState {
  const [visibility, setVisibilityState] = useState(args.initialVisibility);
  const [shareUrl, setShareUrl] = useState(args.initialShareUrl);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setVisibilityState(args.initialVisibility);
    setShareUrl(args.initialShareUrl);
    setBusy(false);
    setCopied(false);
    setError(null);
  }, [args.conversationId, args.initialShareUrl, args.initialVisibility]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const setVisibility = useCallback(
    async (next: AiConversationVisibility) => {
      if (!args.conversationId || busy || next === visibility) return;
      setBusy(true);
      setError(null);
      try {
        const updated = await setConversationVisibility(
          args.workspaceId,
          args.conversationId,
          next,
        );
        setVisibilityState(updated.visibility);
        setShareUrl(updated.shareUrl);
        await args.onUpdated?.(updated);
      } catch (cause) {
        setError(
          cause instanceof Error && cause.message.trim()
            ? cause.message
            : "分享设置保存失败，请重试。",
        );
      } finally {
        setBusy(false);
      }
    },
    [args, busy, visibility],
  );

  const copy = useCallback(async () => {
    if (!shareUrl) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("浏览器没有授予剪贴板权限，请手动复制地址栏中的链接。");
    }
  }, [shareUrl]);

  return { busy, copied, copy, error, setVisibility, shareUrl, visibility };
}

function VisibilityOptionRows({ state }: { state: VisibilityState }) {
  return (
    <>
      {VISIBILITIES.map((option) => {
        const Icon = option.icon;
        const active = state.visibility === option.id;
        return (
          <DropdownMenuItem
            className="items-start gap-2.5 py-2.5"
            data-active={active ? "true" : undefined}
            data-testid={`visibility-selector-item-${option.id}`}
            disabled={state.busy}
            key={option.id}
            onSelect={(event) => {
              event.preventDefault();
              void state.setVisibility(option.id);
            }}
          >
            <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-stone" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] text-ink">
                {option.label}
                {active ? (
                  <Check aria-label="当前设置" className="size-3.5 text-accent-green" />
                ) : null}
              </span>
              <span className="mt-0.5 block text-[11px] leading-4 text-stone">
                {option.description}
              </span>
            </span>
          </DropdownMenuItem>
        );
      })}
      {state.visibility === "public" && state.shareUrl ? (
        <DropdownMenuItem
          className="gap-2.5"
          data-testid="visibility-copy-link"
          onSelect={(event) => {
            event.preventDefault();
            void state.copy();
          }}
        >
          {state.copied ? (
            <Check aria-hidden="true" className="text-accent-green" />
          ) : (
            <Copy aria-hidden="true" />
          )}
          {state.copied ? "链接已复制" : "复制公开链接"}
        </DropdownMenuItem>
      ) : null}
      {state.error ? (
        <p className="px-2.5 py-2 text-[11px] leading-4 text-accent-red" role="alert">
          {state.error}
        </p>
      ) : null}
    </>
  );
}

export interface ConversationVisibilitySelectorProps extends Omit<
  ComponentProps<typeof Button>,
  "onChange"
> {
  workspaceId: string;
  conversationId: string | null;
  visibility: AiConversationVisibility;
  shareUrl: string | null;
  onUpdated?: (conversation: AiConversation) => void | Promise<void>;
  compact?: boolean;
}

export function ConversationVisibilitySelector({
  workspaceId,
  conversationId,
  visibility,
  shareUrl,
  onUpdated,
  compact = false,
  className,
  ...buttonProps
}: ConversationVisibilitySelectorProps) {
  const state = useConversationVisibility({
    workspaceId,
    conversationId,
    initialVisibility: visibility,
    initialShareUrl: shareUrl,
    ...(onUpdated ? { onUpdated } : {}),
  });
  const current = useMemo(
    () => VISIBILITIES.find((option) => option.id === state.visibility) ?? VISIBILITIES[0]!,
    [state.visibility],
  );
  const Icon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          {...buttonProps}
          aria-label={`会话可见性：${current.label}`}
          className={cn("h-7 gap-1.5 px-2 text-xs font-normal text-muted", className)}
          data-testid="visibility-selector"
          disabled={!conversationId || buttonProps.disabled}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Icon aria-hidden="true" className="size-3.5" />
          <span className={cn("truncate", compact && "sr-only")}>{current.label}</span>
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>谁可以查看</DropdownMenuLabel>
        <VisibilityOptionRows state={state} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ConversationVisibilitySubmenu({
  workspaceId,
  conversationId,
  visibility,
  shareUrl,
  onUpdated,
}: Omit<ConversationVisibilitySelectorProps, "compact" | "className">) {
  const state = useConversationVisibility({
    workspaceId,
    conversationId,
    initialVisibility: visibility,
    initialShareUrl: shareUrl,
    ...(onUpdated ? { onUpdated } : {}),
  });

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Share2 aria-hidden="true" />
        分享
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72">
        <DropdownMenuLabel>谁可以查看</DropdownMenuLabel>
        <VisibilityOptionRows state={state} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
