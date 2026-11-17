"use client";

import {
  Badge,
  Button,
  PageHeader,
  Select,
  Switch,
} from "@roamlog/ui";
import {
  Bell,
  BellOff,
  CheckCheck,
  ChevronRight,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { useDemoStore } from "@/lib/demo-store";
import { shortDate } from "@/lib/demo-format";

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

export function NotificationsWorkspace() {
  const {
    state,
    markNotificationRead,
    markAllNotificationsRead,
    updateNotificationPreference,
  } = useDemoStore();
  const [tab, setTab] = useState<InboxTab>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const unread = state.notifications.filter((notification) => !notification.readAt).length;
  const visible = useMemo(
    () =>
      state.notifications
        .filter((notification) => {
          if (tab === "unread" && notification.readAt) return false;
          if (tab === "mentions" && notification.type !== "mention") return false;
          return typeFilter === "all" || notification.type === typeFilter;
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [state.notifications, tab, typeFilter],
  );
  const groups = useMemo(() => {
    const map = new Map<string, typeof visible>();
    visible.forEach((notification) =>
      map.set(notification.createdAt.slice(0, 10), [
        ...(map.get(notification.createdAt.slice(0, 10)) ?? []),
        notification,
      ]),
    );
    return [...map.entries()];
  }, [visible]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`INBOX / ${String(unread).padStart(2, "0")} UNREAD`}
        title="通知中心"
        description="评论、提及、邀请与旅行提醒都在这里。标记已读和偏好切换会保存到本地演示状态。"
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={markAllNotificationsRead}
            disabled={unread === 0}
          >
            <CheckCheck aria-hidden="true" />
            {unread ? "全部标为已读" : "全部已读"}
          </Button>
        }
      />

      <div className="flex flex-col gap-3 border-b border-hairline pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-fit items-center rounded-control border border-hairline-strong bg-surface-1 p-1">
          {[
            { key: "all", label: "全部", count: state.notifications.length },
            { key: "unread", label: "未读", count: unread },
            {
              key: "mentions",
              label: "提及",
              count: state.notifications.filter((item) => item.type === "mention").length,
            },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={tab === item.key}
              onClick={() => setTab(item.key as InboxTab)}
              className={`inline-flex h-9 items-center gap-1.5 rounded-[6px] px-3 text-[11px] ${
                tab === item.key
                  ? "bg-surface-2 text-ink"
                  : "text-muted hover:text-ink"
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
          {groups.map(([day, notifications]) => (
            <section key={day} aria-label={`${day} 的通知`}>
              <div className="mb-2 flex items-center gap-3 px-1">
                <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink">
                  {shortDate(day)}
                </h2>
                <span className="font-mono text-[9px] text-stone">
                  {String(notifications.length).padStart(2, "0")}
                </span>
                <div className="h-px flex-1 bg-hairline" />
              </div>
              <div className="surface-card overflow-hidden divide-y divide-hairline">
                {notifications.map((notification) => {
                  const read = Boolean(notification.readAt);
                  return (
                    <div
                      key={notification.id}
                      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 p-4 ${
                        read ? "bg-transparent" : "bg-white/[0.018]"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex size-9 items-center justify-center rounded-control border bg-surface-2 ${
                          read
                            ? "border-hairline text-stone"
                            : "border-hairline-strong text-body"
                        }`}
                      >
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
                              onClick={() => markNotificationRead(notification.id)}
                            >
                              标为已读
                              <ChevronRight aria-hidden="true" className="size-3" />
                            </Button>
                          ) : (
                            <span className="font-mono text-[9px] uppercase text-stone">已读</span>
                          )}
                        </div>
                      </div>
                      <span
                        aria-label={read ? "已读" : "未读"}
                        className={`mt-1.5 size-1.5 rounded-pill ${
                          read ? "border border-stone" : "bg-accent-orange"
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {!groups.length ? (
            <div className="surface-card px-6 py-14 text-center">
              {tab === "unread" ? (
                <BellOff aria-hidden="true" className="mx-auto size-5 text-stone" />
              ) : (
                <MessageSquare aria-hidden="true" className="mx-auto size-5 text-stone" />
              )}
              <h2 className="mt-3 font-serif text-2xl text-ink">
                {tab === "unread" ? "未读已经清空" : "没有匹配的通知"}
              </h2>
              <p className="mt-2 text-sm text-muted">
                调整类型筛选，或回到全部通知。
              </p>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setTab("all");
                  setTypeFilter("all");
                }}
              >
                查看全部
              </Button>
            </div>
          ) : null}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20">
          <section className="surface-card overflow-hidden">
            <div className="border-b border-hairline p-4">
              <p className="type-eyebrow">NOTIFICATION SETTINGS</p>
              <h2 className="mt-1.5 font-serif text-2xl text-ink">通知偏好</h2>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                只接收真正需要你回应的提醒。
              </p>
            </div>
            <div className="divide-y divide-hairline">
              {state.settings.notificationPreferences.map((preference, index) => (
                <div key={preference.type} className="flex items-start gap-3 px-4 py-3.5">
                  <span className="pt-0.5 font-mono text-[9px] text-stone">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-body">
                      {typeLabels[preference.type] ?? preference.type}
                    </p>
                    <p className="mt-0.5 text-[10px] text-stone">
                      In-app {preference.inApp ? "开" : "关"} · Email{" "}
                      {preference.email ? "开" : "关"}
                    </p>
                  </div>
                  <Switch
                    checked={preference.inApp}
                    aria-label={`${typeLabels[preference.type] ?? preference.type} in-app`}
                    onCheckedChange={(checked) =>
                      updateNotificationPreference(preference.type, "inApp", checked)
                    }
                  />
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2 border-t border-hairline px-4 py-3">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-pill bg-accent-green" />
              <p className="text-[10px] leading-5 text-stone">
                偏好仅保存在当前设备；不会改变其他成员，也不会真实发送邮件。
              </p>
            </div>
          </section>

          <section className="surface-card p-4">
            <div className="flex items-center gap-2">
              <Sparkles aria-hidden="true" className="size-3.5 text-accent-orange" />
              <p className="type-eyebrow">LOCAL BOUNDARY</p>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              通知由受控 fixtures 生成；未接 Better Auth、BullMQ、Resend 或实时通知。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
