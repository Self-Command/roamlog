"use client";

import {
  Button,
  FormField,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@roamlog/ui";
import { Save, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { isForbidden } from "@/lib/api";
import {
  useMeQuery,
  useUpdateMeMutation,
  useUpdateWorkspaceMutation,
  useWorkspaceBySlug,
} from "@/lib/query";

const timezones = ["Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/New_York", "UTC"];
const locales = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English (US)" },
];
const currencies = ["CNY", "USD", "EUR", "JPY", "GBP"];
const ROLE_LABELS = {
  owner: "所有者",
  admin: "管理员",
  editor: "编辑者",
  viewer: "只读成员",
} as const;

export function SettingsLive({ workspaceSlug }: { workspaceSlug: string }) {
  const meQuery = useMeQuery();
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const updateMe = useUpdateMeMutation();
  const updateWorkspace = useUpdateWorkspaceMutation();

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [locale, setLocale] = useState("zh-CN");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceTimezone, setWorkspaceTimezone] = useState("Asia/Shanghai");
  const [currency, setCurrency] = useState("CNY");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (meQuery.data) {
      setName(meQuery.data.name);
      setTimezone(meQuery.data.timezone);
      setLocale(meQuery.data.locale);
    }
  }, [meQuery.data]);

  useEffect(() => {
    if (workspace) {
      setWorkspaceName(workspace.name);
      setWorkspaceTimezone(workspace.timezone);
      setCurrency(workspace.defaultCurrency);
    }
  }, [workspace]);

  if (meQuery.isLoading || workspacesQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-44" />
        <Skeleton className="h-80 rounded-card" />
      </div>
    );
  }

  if (!meQuery.data || !workspace) {
    return (
      <p className="text-sm text-muted">设置暂时无法加载：当前账号或工作区未加载。</p>
    );
  }

  const canManageWorkspace = workspace.role === "owner" || workspace.role === "admin";

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await updateMe.mutateAsync({ name: name.trim(), timezone, locale });
      setNotice("个人资料已保存。");
    } catch {
      setError("个人资料保存失败，请稍后重试。");
    }
  }

  async function saveWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    setError(null);
    try {
      await updateWorkspace.mutateAsync({
        workspaceId: workspace.id,
        input: {
          name: workspaceName.trim(),
          timezone: workspaceTimezone,
          defaultCurrency: currency,
        },
      });
      setNotice("工作区设置已保存。");
    } catch (cause) {
      setError(
        isForbidden(cause)
          ? "你没有修改工作区设置的权限。"
          : "工作区设置保存失败。",
      );
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="账号 / 工作区"
        title="设置"
        description="个人资料与工作区偏好设置。"
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

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <form className="surface-card p-5" onSubmit={(event) => void saveProfile(event)}>
          <div className="flex items-center gap-3 border-b border-hairline pb-4">
            <span className="flex size-9 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
              <UserRound aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="type-eyebrow">个人资料</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                个人资料
              </h2>
            </div>
          </div>
          <div className="mt-5 space-y-4">
            <FormField label="显示名称">
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
            </FormField>
            <FormField label="邮箱">
              <Input value={meQuery.data.email} readOnly disabled />
            </FormField>
            <FormField label="时区">
              <Select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                {timezones.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="语言">
              <Select value={locale} onChange={(event) => setLocale(event.target.value)}>
                {locales.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <Button type="submit" variant="primary" className="mt-5" disabled={updateMe.isPending}>
            <Save aria-hidden="true" />
            保存个人资料
          </Button>
        </form>

        <form className="surface-card p-5" onSubmit={(event) => void saveWorkspace(event)}>
          <div className="flex items-center gap-3 border-b border-hairline pb-4">
            <span className="flex size-9 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
              <ShieldCheck aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="type-eyebrow">工作区</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                工作区设置
              </h2>
            </div>
          </div>
          <div className="mt-5 space-y-4">
            <FormField label="工作区名称">
              <Input
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                maxLength={120}
                disabled={!canManageWorkspace}
              />
            </FormField>
            <FormField label="Slug">
              <Input value={workspace.slug} readOnly disabled />
            </FormField>
            <FormField label="默认时区">
              <Select
                value={workspaceTimezone}
                onChange={(event) => setWorkspaceTimezone(event.target.value)}
                disabled={!canManageWorkspace}
              >
                {timezones.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="默认币种">
              <Select
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
                disabled={!canManageWorkspace}
              >
                {currencies.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <p className="mt-4 text-[11px] leading-5 text-muted">
            你的角色：{ROLE_LABELS[workspace.role]}。
            {canManageWorkspace ? " 可以修改工作区设置。" : " 仅可查看工作区设置。"}
          </p>
          <Button
            type="submit"
            variant="primary"
            className="mt-4"
            disabled={!canManageWorkspace || updateWorkspace.isPending}
          >
            <Save aria-hidden="true" />
            保存工作区设置
          </Button>
        </form>
      </div>
    </div>
  );
}
