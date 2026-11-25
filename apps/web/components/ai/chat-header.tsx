"use client";

/**
 * Chat header ported from vercel/chatbot `components/chat/chat-header.tsx`
 * @ a8989b522fa3672a2ae52f053105e40993b36ca1 (Apache-2.0).
 *
 * Upstream renders the mobile sidebar trigger and the `VisibilitySelector` in
 * the same header. Roamlog keeps that structure on desktop and exposes the same
 * selector next to the mobile drawer trigger. The only visual adaptation is the
 * existing Roamlog hairline/canvas treatment.
 */

import type { AiConversation, AiConversationVisibility } from "@roamlog/contracts";
import { Button } from "@roamlog/ui";
import { PanelLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useCallback } from "react";

import {
  ConversationVisibilitySelector,
  shareUrlFromThreadCustom,
  visibilityFromThreadCustom,
} from "./visibility-selector";

export function DesktopChatHeader({
  workspaceId,
  collapsed,
  onToggleSidebar,
}: {
  workspaceId: string;
  collapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const aui = useAui();
  const current = useAuiState((state) =>
    state.threads.threadItems.find((item) => item.id === state.threads.mainThreadId),
  );
  const remoteId = current?.remoteId ?? null;
  const visibility = visibilityFromThreadCustom(current?.custom);
  const shareUrl = shareUrlFromThreadCustom(current?.custom);
  const title = current?.title?.trim() || "AI 旅行助手";

  const onUpdated = useCallback(
    async (_conversation: AiConversation) => {
      await aui.threads.reload();
    },
    [aui],
  );

  return (
    <header className="hidden min-h-11 items-center gap-2 border-b border-hairline px-3 py-2 lg:flex">
      <Button
        aria-expanded={!collapsed}
        aria-label={collapsed ? "展开会话列表" : "收起会话列表"}
        onClick={onToggleSidebar}
        size="sm"
        type="button"
        variant="ghost"
      >
        {collapsed ? (
          <PanelLeftOpen aria-hidden="true" className="size-4" />
        ) : (
          <PanelLeftClose aria-hidden="true" className="size-4" />
        )}
      </Button>
      <p className="min-w-0 flex-1 truncate type-meta">
        {collapsed ? "AI 旅行助手" : title}
      </p>
      {remoteId ? (
        <ConversationVisibilitySelector
          conversationId={remoteId}
          onUpdated={onUpdated}
          shareUrl={shareUrl}
          visibility={visibility}
          workspaceId={workspaceId}
        />
      ) : null}
    </header>
  );
}

export function MobileChatHeader({
  workspaceId,
  onOpenSidebar,
  conversationId,
  title,
  visibility,
  shareUrl,
  onUpdated,
}: {
  workspaceId: string;
  onOpenSidebar: () => void;
  conversationId: string | null;
  title: string;
  visibility: AiConversationVisibility;
  shareUrl: string | null;
  onUpdated: (conversation: AiConversation) => void | Promise<void>;
}) {
  return (
    <header className="flex min-h-11 items-center gap-2 border-b border-hairline px-3 py-2 lg:hidden">
      <Button
        aria-label="打开会话列表"
        onClick={onOpenSidebar}
        size="sm"
        type="button"
        variant="ghost"
      >
        <PanelLeft aria-hidden="true" className="size-4" />
      </Button>
      <p className="min-w-0 flex-1 truncate type-meta">{title}</p>
      {conversationId ? (
        <ConversationVisibilitySelector
          compact
          conversationId={conversationId}
          onUpdated={onUpdated}
          shareUrl={shareUrl}
          visibility={visibility}
          workspaceId={workspaceId}
        />
      ) : null}
    </header>
  );
}
