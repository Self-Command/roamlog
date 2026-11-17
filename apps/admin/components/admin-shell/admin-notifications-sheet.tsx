"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useState } from "react";

import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@roamlog/ui";

import { MOCK_ADMIN_NOTIFICATIONS, type AdminNotification } from "../../lib/fixtures";
import { formatRelativeTime } from "../../lib/format";
import { cn } from "./cn";

interface AdminNotificationsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const toneClasses: Record<AdminNotification["tone"], string> = {
  neutral: "bg-accent-blue",
  yellow: "bg-accent-yellow",
  red: "bg-accent-red",
};

export function AdminNotificationsSheet({ open, onOpenChange }: AdminNotificationsSheetProps) {
  const [notifications, setNotifications] = useState(MOCK_ADMIN_NOTIFICATIONS);
  const unreadCount = notifications.filter((item) => !item.read).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-md">
        <SheetHeader>
          <p className="type-eyebrow">Operations inbox</p>
          <SheetTitle>通知</SheetTitle>
          <SheetDescription>
            本地 fixture 通知，用于展示队列、邮件和安全事件的告警入口。
          </SheetDescription>
        </SheetHeader>

        <div className="mb-3 flex items-center justify-between">
          <Badge tone={unreadCount > 0 ? "orange" : "neutral"}>{unreadCount} 条未读</Badge>
          <Button
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0}
            onClick={() =>
              setNotifications((current) => current.map((item) => ({ ...item, read: true })))
            }
          >
            <CheckCheck aria-hidden="true" />
            全部标为已读
          </Button>
        </div>

        <div className="divide-y divide-hairline border-y border-hairline">
          {notifications.map((notification) => (
            <article key={notification.id} className="flex gap-3 py-4">
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-pill",
                  toneClasses[notification.tone],
                  notification.read && "opacity-35",
                )}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-medium text-ink">{notification.title}</h3>
                  {!notification.read ? (
                    <Bell aria-label="未读" className="size-3 text-muted" />
                  ) : null}
                </div>
                <p className="mt-1 text-[12px] leading-5 text-muted">{notification.body}</p>
                <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                  {formatRelativeTime(notification.createdAt)}
                </p>
              </div>
            </article>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
