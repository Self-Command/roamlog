"use client";

import {
  Badge,
  Button,
  ErrorState,
  PageHeader,
  Skeleton,
  Switch,
} from "@roamlog/ui";
import { Bell, Mail } from "lucide-react";
import { useEffect, useState } from "react";

import {
  useMeQuery,
  useNotificationPreferencesQuery,
  useUpdateNotificationPreferencesMutation,
} from "@/lib/query";

/**
 * Notification types the API actually produces.
 *
 * Every one of them comes from `CommentsService.notificationInputs`
 * (`apps/api/src/modules/comments/comments.service.ts`: `mention`,
 * `comment_reply`, `comment`), which is the only producer that calls
 * `NotificationsService.createInTransaction`. Types that only exist in a stored
 * preference row are merged in below, so a future producer shows up without a
 * code change here.
 */
const catalog: Array<{ type: string; label: string; description: string }> = [
  {
    type: "mention",
    label: "提及",
    description: "有人在评论里 @ 了你。",
  },
  {
    type: "comment_reply",
    label: "回复",
    description: "有人回复了你的评论。",
  },
  {
    type: "comment",
    label: "评论",
    description: "你创建的日志或行程收到了新评论。",
  },
];

interface ChannelState {
  inApp: boolean;
  email: boolean;
}

function defaultsFor(preferences: ReadonlyMap<string, ChannelState>): Record<string, ChannelState> {
  const state: Record<string, ChannelState> = {};
  for (const item of catalog) {
    state[item.type] = preferences.get(item.type) ?? { inApp: true, email: true };
  }
  for (const [type, value] of preferences) {
    if (!state[type]) state[type] = value;
  }
  return state;
}

export function NotificationsSettings() {
  const meQuery = useMeQuery();
  const preferencesQuery = useNotificationPreferencesQuery();
  const updatePreferences = useUpdateNotificationPreferencesMutation();

  const [state, setState] = useState<Record<string, ChannelState>>(() =>
    defaultsFor(new Map()),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingType, setSavingType] = useState<string | null>(null);

  const remote = preferencesQuery.data;

  useEffect(() => {
    if (!remote) return;
    setState(
      defaultsFor(
        new Map(
          remote.map((preference) => [
            preference.type,
            { inApp: preference.inApp, email: preference.email },
          ]),
        ),
      ),
    );
  }, [remote]);

  if (meQuery.isLoading || preferencesQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-44" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    );
  }

  if (preferencesQuery.isError) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="设置 / 通知"
          title="通知"
          description="选择哪些提醒在应用内出现，哪些同时通过邮件发送。"
        />
        <ErrorState
          title="通知偏好不可用"
          description="通知偏好暂时无法加载，请稍后重试。"
          retryAction={
            <Button
              type="button"
              variant="outline"
              onClick={() => void preferencesQuery.refetch()}
            >
              重新加载
            </Button>
          }
        />
      </div>
    );
  }

  const userId = meQuery.data?.id ?? remote?.[0]?.userId;
  const types = Object.keys(state);
  const rows = types.map((type) => {
    const entry = catalog.find((item) => item.type === type);
    return {
      type,
      label: entry?.label ?? type,
      description: entry?.description ?? "该类型的提醒。",
    };
  });

  async function save(type: string, next: ChannelState) {
    if (!userId) {
      setError("当前账号没有载入，暂时无法保存通知偏好。");
      return;
    }
    const previous = state;
    const optimistic = { ...state, [type]: next };
    setState(optimistic);
    setSavingType(type);
    setNotice(null);
    setError(null);
    try {
      await updatePreferences.mutateAsync(
        Object.entries(optimistic).map(([entryType, value]) => ({
          userId,
          type: entryType,
          inApp: value.inApp,
          email: value.email,
        })),
      );
      setNotice("通知偏好已保存。");
    } catch {
      setState(previous);
      setError("通知偏好保存失败，请稍后重试。");
    } finally {
      setSavingType(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="设置 / 通知"
        title="通知"
        description="选择哪些提醒在应用内出现，哪些同时通过邮件发送。切换后立即生效。"
      />

      {notice ? (
        <p
          role="status"
          className="rounded-control border border-accent-green/20 bg-accent-green/5 px-3 py-2 text-xs text-accent-green"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-xs text-accent-red"
        >
          {error}
        </p>
      ) : null}

      <section className="surface-card p-5" aria-label="通知偏好">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
              <Bell aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="type-eyebrow">通知偏好</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                通知偏好
              </h2>
              <p className="mt-2 max-w-xl text-xs leading-5 text-muted">
                每种提醒可以分别控制应用内消息与邮件。关闭两者后，这类提醒不会再产生。
              </p>
            </div>
          </div>
          <Badge tone="slate">{rows.length} 类提醒</Badge>
        </div>

        <div className="mt-2 hidden items-center gap-3 border-b border-hairline pb-2 pt-3 md:flex">
          <span className="flex-1 type-eyebrow">
            提醒类型
          </span>
          <span className="w-28 text-center type-eyebrow">
            应用内
          </span>
          <span className="w-28 text-center type-eyebrow">
            邮件
          </span>
        </div>

        <ul className="divide-y divide-hairline">
          {rows.map((row) => {
            const value = state[row.type] ?? { inApp: true, email: true };
            const busy = savingType === row.type;
            return (
              <li
                key={row.type}
                className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{row.label}</p>
                  <p className="mt-1 text-[11px] leading-5 text-muted">{row.description}</p>
                </div>
                <div className="flex items-center gap-6 md:gap-3">
                  <div className="flex w-28 items-center justify-between gap-2 md:justify-center">
                    <span className="flex items-center gap-1.5 text-[11px] text-muted md:hidden">
                      <Bell aria-hidden="true" className="size-3.5" />
                      应用内
                    </span>
                    <Switch
                      aria-label={`${row.label}的应用内通知`}
                      checked={value.inApp}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        void save(row.type, { ...value, inApp: checked })
                      }
                    />
                  </div>
                  <div className="flex w-28 items-center justify-between gap-2 md:justify-center">
                    <span className="flex items-center gap-1.5 text-[11px] text-muted md:hidden">
                      <Mail aria-hidden="true" className="size-3.5" />
                      邮件
                    </span>
                    <Switch
                      aria-label={`${row.label}的邮件通知`}
                      checked={value.email}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        void save(row.type, { ...value, email: checked })
                      }
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 text-[11px] leading-5 text-muted">
          未单独设置过的提醒默认同时开启应用内与邮件。
        </p>
      </section>
    </div>
  );
}
