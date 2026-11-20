"use client";

import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  Skeleton,
  Switch,
} from "@roamlog/ui";
import { Bell, CheckCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { shortDate } from "@/lib/demo-format";
import {
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationPreferencesQuery,
  useNotificationsQuery,
  useUpdateNotificationPreferencesMutation,
} from "@/lib/query";

type InboxTab = "all" | "unread" | "mentions";

const typeLabels: Record<string, string> = {
  mention: "提及",
  comment: "评论",
  invitation: "邀请",
  trip_reminder: "提醒",
  budget_alert: "预算",
  export: "导出",
  weekly_digest: "摘要",
};

export function NotificationsLive() {
  const [tab, setTab] = useState<InboxTab>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const notificationsQuery = useNotificationsQuery({ limit: 100, sort: "createdAt:desc" });
  const preferencesQuery = useNotificationPreferencesQuery();
  const markRead = useMarkNotificationReadMutation();
  const markAllRead = useMarkAllNotificationsReadMutation();
  const updatePreferences = useUpdateNotificationPreferencesMutation();

  const notifications = notificationsQuery.data?.items ?? [];
  const unread = notifications.filter((notification) => !notification.readAt).length;
  const visible = useMemo(
    () =>
      notifications.filter((notification) => {
        if (tab === "unread" && notification.readAt) return false;
        if (tab === "mentions" && notification.type !== "mention") return false;
        return typeFilter === "all" || notification.type === typeFilter;
      }),
    [notifications, tab, typeFilter],
  );
  const groups = useMemo(() => {
    const map = new Map<string, typeof visible>();
    visible.forEach((notification) => {
      const day = notification.createdAt.slice(0, 10);
      map.set(day, [...(map.get(day) ?? []), notification]);
    });
    return [...map.entries()];
  }, [visible]);

  if (notificationsQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-12 w-48" />
        <Skeleton className="h-80 rounded-card" />
      </div>
    );
  }

  if (notificationsQuery.error) {
    return (
      <ErrorState
        title="通知不可用"
        description="通知列表没有返回。请稍后重试。"
        retryAction={
          <Button
            type="button"
            variant="primary"
            onClick={() => void notificationsQuery.refetch()}
          >
            重新加载
          </Button>
        }
      />
    );
  }

  async function togglePreference(type: string, channel: "inApp" | "email", value: boolean) {
    if (!preferencesQuery.data) return;
    const next = preferencesQuery.data.map((preference) =>
      preference.type === type ? { ...preference, [channel]: value } : preference,
    );
    await updatePreferences.mutateAsync(next);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`INBOX / ${String(unread).padStart(2, "0")} UNREAD`}
        title="通知中心"
        description="评论、提及、邀请与旅行提醒都在这里。标记已读后立即生效。"
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => void markAllRead.mutateAsync()}
            disabled={unread === 0 || markAllRead.isPending}
          >
            <CheckCheck aria-hidden="true" />
            {unread ? "全部标为已读" : "全部已读"}
          </Button>
        }
      />

      <div className="flex flex-col gap-3 border-b border-hairline pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-fit items-center rounded-control border border-hairline-strong bg-surface-1 p-1">
          {[
            { key: "all", label: "全部", count: notifications.length },
            { key: "unread", label: "未读", count: unread },
            {
              key: "mentions",
              label: "提及",
              count: notifications.filter((item) => item.type === "mention").length,
            },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={tab === item.key}
              onClick={() => setTab(item.key as InboxTab)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-[6px] px-3 text-[11px] ${
                tab === item.key ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {item.label}
              <span className="font-mono text-[8px] text-stone">{item.count}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            aria-label="筛选通知类型"
            className="h-10 w-40 text-xs"
          >
            <option value="all">全部类型</option>
            {Object.entries(typeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.1em] text-stone sm:block">
            {visible.length} VISIBLE
          </span>
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          {groups.length === 0 ? (
            <EmptyState title="没有匹配通知" description="调整筛选条件，或等待新的提及与评论。" />
          ) : (
            groups.map(([day, grouped]) => (
              <section key={day} aria-label={`${day} 的通知`}>
                <div className="mb-2 flex items-center gap-3 px-1">
                  <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">
                    {shortDate(day)}
                  </h2>
                  <span className="font-mono text-[9px] text-stone">
                    {String(grouped.length).padStart(2, "0")}
                  </span>
                  <div className="h-px flex-1 bg-hairline" />
                </div>
                <div className="surface-card divide-y divide-hairline overflow-hidden">
                  {grouped.map((notification) => {
                    const read = Boolean(notification.readAt);
                    return (
                      <div
                        key={notification.id}
                        className={`grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 p-4 ${
                          read ? "bg-transparent" : "bg-white/[0.018]"
                        }`}
                      >
                        <span className="mt-0.5 flex size-9 items-center justify-center rounded-control border border-hairline-strong bg-surface-2 text-body">
                          <Bell aria-hidden="true" className="size-3.5" />
                        </span>
                        <div className={read ? "opacity-70" : undefined}>
                          <p className="text-[13px] leading-5 text-ink">{notification.title}</p>
                          <p className="mt-1 text-[12px] leading-5 text-muted">
                            {notification.body}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <Badge tone={notification.type === "mention" ? "orange" : "neutral"}>
                              {typeLabels[notification.type] ?? notification.type}
                            </Badge>
                            {!read ? (
                              <Button
                                type="button"
                                variant="link"
                                onClick={() => void markRead.mutateAsync(notification.id)}
                                disabled={markRead.isPending}
                              >
                                标为已读
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
                          {notification.createdAt.slice(11, 16)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        <aside className="surface-card p-5" aria-label="通知偏好">
          <p className="type-eyebrow">CHANNELS</p>
          <h2 className="mt-1.5 font-serif text-2xl tracking-[-0.02em] text-ink">通知偏好</h2>
          <p className="mt-2 text-xs leading-5 text-muted">
            选择哪些事件通过站内或邮件提醒。修改会保存到你的账号。
          </p>
          <div className="mt-4 divide-y divide-hairline">
            {(preferencesQuery.data ?? []).map((preference) => (
              <div key={preference.type} className="space-y-2 py-3">
                <p className="text-[12px] text-ink">
                  {typeLabels[preference.type] ?? preference.type}
                </p>
                <label className="flex items-center justify-between gap-3 text-[11px] text-muted">
                  站内
                  <Switch
                    checked={preference.inApp}
                    onCheckedChange={(value) =>
                      void togglePreference(preference.type, "inApp", value)
                    }
                    aria-label={`${preference.type} 站内通知`}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-[11px] text-muted">
                  邮件
                  <Switch
                    checked={preference.email}
                    onCheckedChange={(value) =>
                      void togglePreference(preference.type, "email", value)
                    }
                    aria-label={`${preference.type} 邮件通知`}
                  />
                </label>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
