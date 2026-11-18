"use client";

import type { ShellLinkComponent } from "@roamlog/ui";
import { Bell } from "lucide-react";

import { cx } from "./topbar-utils";

const DefaultLink = "a" as ShellLinkComponent;

export interface NotificationBellProps {
  href: string;
  /** Real unread count. 0 (or no data source) hides the badge entirely. */
  unreadCount: number;
  /** True when the unread query page ended before counting every unread item. */
  unreadHasMore?: boolean;
  className?: string;
  linkComponent?: ShellLinkComponent;
}

export function NotificationBell({
  href,
  unreadCount,
  unreadHasMore = false,
  className,
  linkComponent: Link = DefaultLink,
}: NotificationBellProps) {
  const hasUnread = unreadCount > 0;
  const badge = unreadCount > 99 ? "99+" : unreadHasMore ? `${unreadCount}+` : String(unreadCount);
  const unreadLabel = unreadHasMore ? `${unreadCount} 条以上未读` : `${unreadCount} 条未读`;

  return (
    <Link
      href={href}
      data-testid="topbar-notifications"
      aria-label={hasUnread ? `通知，${unreadLabel}` : "通知，没有未读"}
      className={cx(
        "relative inline-flex size-11 shrink-0 items-center justify-center rounded-control border border-hairline-strong bg-surface-2 text-ink outline-none hover:bg-[#151518] focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas md:size-9",
        className,
      )}
    >
      <Bell aria-hidden="true" className="size-4" />
      {hasUnread ? (
        <span
          aria-hidden="true"
          data-testid="topbar-notifications-badge"
          className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-pill border-2 border-canvas bg-accent-orange px-1 font-mono text-[9px] leading-none text-black"
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
