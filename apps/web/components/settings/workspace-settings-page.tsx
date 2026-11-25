"use client";

import {
  Avatar,
  Button,
  FormField,
  Input,
  PageHeader,
  Progress,
  Select,
  Skeleton,
  Switch,
} from "@roamlog/ui";
import { useQuery } from "@tanstack/react-query";
import { ImageUp, RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type {
  MediaRead,
  TripVisibility,
  UpdateWorkspaceRequest,
  WorkspaceSettings,
  WorkspaceWithRole,
} from "@roamlog/contracts";
import { TripVisibilitySchema } from "@roamlog/contracts";

import { useCoverUpload } from "@/components/media";
import { isApiError, isForbidden } from "@/lib/api";
import { COVER_ACCEPT_ATTRIBUTE, createCoverMediaClient } from "@/lib/api/media";
import { useUpdateWorkspaceMutation, useWorkspaceBySlug } from "@/lib/query";

/**
 * Workspace settings form.
 *
 * The page is the transplant of `settings-live.tsx`'s Workspace card (same
 * FormField/Select/Input composition, same notice/error rows, same
 * `canManageWorkspace` gate) extended to every field
 * `UpdateWorkspaceRequestSchema` accepts, plus the Logo upload chain that
 * `CoverUploader`/`useCoverUpload` already own.
 */

const TIMEZONES = [
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

const CURRENCIES = [
  { value: "CNY", label: "人民币 CNY" },
  { value: "USD", label: "美元 USD" },
  { value: "EUR", label: "欧元 EUR" },
  { value: "JPY", label: "日元 JPY" },
  { value: "GBP", label: "英镑 GBP" },
];

/** JS `Date#getDay()` order, rotated so Monday is first in the picker. */
const WEEKDAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" },
];

const VISIBILITY_LABELS: Record<TripVisibility, string> = {
  workspace: "工作区成员可见",
  private: "仅创建者可见",
  public_link: "公开链接",
  custom: "指定成员",
};

const DENSITIES = [
  { value: "comfortable", label: "舒适" },
  { value: "compact", label: "紧凑" },
] as const;

const ROLES = {
  owner: "所有者",
  admin: "管理员",
  editor: "编辑者",
  viewer: "只读成员",
} as const;

/** Same rule as the contract (`packages/contracts/src/entities/workspace.ts:19-22`). */
const ACCENT_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Same rule as the contract (`packages/contracts/src/api/workspaces.ts:39-44`). */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_NOTICE_KEY = "roamlog.workspace-slug-updated";

interface WorkspaceFormState {
  name: string;
  slug: string;
  timezone: string;
  defaultCurrency: string;
  weekStartsOn: number;
  defaultVisibility: TripVisibility;
  notificationInApp: boolean;
  notificationEmail: boolean;
  density: "comfortable" | "compact";
  accentColor: string | null;
}

function formFromWorkspace(workspace: WorkspaceWithRole): WorkspaceFormState {
  const settings = workspace.settings ?? {};
  return {
    name: workspace.name,
    slug: workspace.slug,
    timezone: workspace.timezone,
    defaultCurrency: workspace.defaultCurrency,
    weekStartsOn: workspace.weekStartsOn,
    defaultVisibility: settings.defaultVisibility ?? "workspace",
    notificationInApp: settings.notificationDefaults?.inApp ?? true,
    notificationEmail: settings.notificationDefaults?.email ?? true,
    density: settings.density ?? "comfortable",
    accentColor: settings.accentColor ?? null,
  };
}

function slugError(value: string): string | null {
  const slug = value.trim();
  if (slug.length === 0) return "工作区地址不能为空。";
  if (slug.length > 80) return "工作区地址最多 80 个字符。";
  if (!SLUG_PATTERN.test(slug)) {
    return "工作区地址只能使用小写字母、数字和单个连字符，且不能以连字符开头或结尾。";
  }
  return null;
}

function accentError(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  return ACCENT_PATTERN.test(value.trim())
    ? null
    : "强调色必须是 #rrggbb 形式的六位十六进制色值。";
}

/**
 * Only the fields that actually changed are submitted.
 *
 * `UpdateWorkspaceRequestSchema` rejects an empty object (`.refine(keys > 0)`),
 * and `settings` is replaced wholesale by the API
 * (`apps/api/src/modules/workspaces/workspaces.service.ts:170`), so a settings
 * change must be merged over the values already stored.
 */
function buildPatch(
  current: WorkspaceFormState,
  baseline: WorkspaceFormState,
  storedSettings: WorkspaceSettings,
): UpdateWorkspaceRequest | null {
  const patch: UpdateWorkspaceRequest = {};

  const name = current.name.trim();
  if (name !== baseline.name) patch.name = name;
  const slug = current.slug.trim();
  if (slug !== baseline.slug) patch.slug = slug;
  if (current.timezone !== baseline.timezone) patch.timezone = current.timezone;
  if (current.defaultCurrency !== baseline.defaultCurrency) {
    patch.defaultCurrency = current.defaultCurrency;
  }
  if (current.weekStartsOn !== baseline.weekStartsOn) {
    patch.weekStartsOn = current.weekStartsOn;
  }

  const visibilityChanged = current.defaultVisibility !== baseline.defaultVisibility;
  const notificationsChanged =
    current.notificationInApp !== baseline.notificationInApp ||
    current.notificationEmail !== baseline.notificationEmail;
  const densityChanged = current.density !== baseline.density;
  const accentChanged = current.accentColor !== baseline.accentColor;

  if (visibilityChanged || notificationsChanged || densityChanged || accentChanged) {
    const settings: WorkspaceSettings = {};
    const visibility = visibilityChanged
      ? current.defaultVisibility
      : storedSettings.defaultVisibility;
    if (visibility !== undefined) settings.defaultVisibility = visibility;

    if (notificationsChanged) {
      settings.notificationDefaults = {
        inApp: current.notificationInApp,
        email: current.notificationEmail,
      };
    } else if (storedSettings.notificationDefaults) {
      settings.notificationDefaults = storedSettings.notificationDefaults;
    }

    const density = densityChanged ? current.density : storedSettings.density;
    if (density !== undefined) settings.density = density;

    const accent = accentChanged ? current.accentColor : storedSettings.accentColor;
    if (accent) settings.accentColor = accent;

    patch.settings = settings;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function uploadPhaseLabel(phase: string, progress: number | null): string {
  switch (phase) {
    case "validating":
      return "正在检查图片";
    case "compressing":
      return `正在压缩图片 ${progress ?? 0}%`;
    case "presigning":
      return "正在准备上传链接";
    case "uploading":
      return `正在上传 ${progress ?? 0}%`;
    case "completing":
      return "正在确认上传";
    case "processing":
      return "正在处理图片";
    default:
      return "";
  }
}

interface LogoFieldProps {
  workspace: WorkspaceWithRole;
  canManage: boolean;
  applying: boolean;
  onApply: (logoMediaId: string | null) => void;
}

/**
 * Workspace Logo: the CoverUploader chain (validate → compress → presign → PUT →
 * complete → poll) with an avatar-shaped preview instead of a 16:9 cover.
 * Persisting is a separate `logoMediaId` PATCH issued by the parent.
 */
function WorkspaceLogoField({ workspace, canManage, applying, onApply }: LogoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const client = useMemo(() => createCoverMediaClient(), []);
  const logoMediaId = workspace.logoMediaId;

  const storedLogo = useQuery({
    queryKey: ["v1", "media", logoMediaId],
    queryFn: ({ signal }) =>
      client.fetchMedia(logoMediaId as string, { signal }),
    enabled: Boolean(logoMediaId),
    staleTime: 60_000,
    retry: 1,
  });

  const upload = useCoverUpload({
    workspaceId: workspace.id,
    onMediaReady: (media: MediaRead) => onApply(media.id),
  });

  const busy = upload.isBusy || applying;
  const displayUrl = upload.isBusy
    ? upload.previewUrl
    : upload.media && (workspace.logoMediaId === upload.media.id || applying)
      ? (upload.media.url ?? upload.media.thumbUrl)
      : logoMediaId
        ? (storedLogo.data?.url ?? storedLogo.data?.thumbUrl ?? null)
        : null;

  const canPick = canManage && !busy;
  const label = uploadPhaseLabel(upload.phase, upload.progress);
  const statusChip = busy ? "上传中" : logoMediaId ? "已设置" : "未设置";

  return (
    <section aria-labelledby="workspace-logo-title" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3
          id="workspace-logo-title"
          className="font-mono text-[10px] uppercase tracking-[0.13em] text-muted"
        >
          工作区标志
        </h3>
        <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-stone">
          {statusChip}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <Avatar name={workspace.name} src={displayUrl ?? undefined} size={72} />
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={!canPick}
            >
              <ImageUp aria-hidden="true" className="size-3.5" />
              {logoMediaId ? "替换标志" : "上传标志"}
            </Button>
            {logoMediaId ? (
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => onApply(null)}
                disabled={!canPick}
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                移除
              </Button>
            ) : null}
            {upload.canRetry ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={upload.retry}
                disabled={!canPick}
              >
                <RefreshCw aria-hidden="true" className="size-3.5" />
                重试
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] leading-5 text-muted">
            方图效果最好。JPEG、PNG、WebP、AVIF、HEIC 均可，上传后自动压缩为 WebP。
          </p>
        </div>
      </div>

      {upload.isBusy ? (
        <div className="space-y-1.5">
          {upload.phase === "uploading" || upload.phase === "compressing" ? (
            <Progress
              value={upload.progress ?? 0}
              aria-label="标志上传进度"
              aria-valuetext={`${upload.progress ?? 0}%`}
              indicatorClassName="motion-reduce:transition-none!"
            />
          ) : (
            <Skeleton className="h-1.5 w-full motion-reduce:animate-none!" />
          )}
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">{label}</p>
        </div>
      ) : null}

      {upload.error ? (
        <p
          role="alert"
          className="rounded-control border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs leading-5 text-accent-red"
        >
          {upload.error.message}
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={COVER_ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-label="选择工作区标志"
        disabled={!canPick}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) upload.selectFile(file);
        }}
      />
    </section>
  );
}

export function WorkspaceSettingsPage({ workspaceSlug }: { workspaceSlug: string }) {
  const { workspace, workspacesQuery } = useWorkspaceBySlug(workspaceSlug);
  const updateWorkspace = useUpdateWorkspaceMutation();

  const [form, setForm] = useState<WorkspaceFormState | null>(null);
  const [baseline, setBaseline] = useState<WorkspaceFormState | null>(null);
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logoApplying, setLogoApplying] = useState(false);

  const workspaceKey = workspace ? `${workspace.id}:${workspace.updatedAt}` : null;
  if (workspace && workspaceKey !== appliedKey) {
    const next = formFromWorkspace(workspace);
    setAppliedKey(workspaceKey);
    setForm(next);
    setBaseline(next);
  }

  useEffect(() => {
    if (!workspace) return;
    let pending: string | null;
    try {
      pending = window.sessionStorage.getItem(SLUG_NOTICE_KEY);
      if (pending === workspace.slug) window.sessionStorage.removeItem(SLUG_NOTICE_KEY);
      else pending = null;
    } catch {
      pending = null;
    }
    if (pending) {
      setNotice(`Slug 已更新为 ${pending}，页面地址已变更为 /w/${pending}。`);
    }
  }, [workspace?.slug]);

  if (workspacesQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-48" />
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-80 rounded-card" />
          <Skeleton className="h-80 rounded-card" />
        </div>
      </div>
    );
  }

  if (!workspace || !form || !baseline) {
    return (
      <p className="text-sm text-muted">
        工作区设置暂时无法加载：当前账号不是该工作区的成员，或工作区地址已失效。
      </p>
    );
  }

  const canManageWorkspace = workspace.role === "owner" || workspace.role === "admin";
  const roleLabel = ROLES[workspace.role];
  const currentSlugError = slugError(form.slug);
  const currentAccentError = accentError(form.accentColor);
  const isDirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const timezoneOptions = TIMEZONES.includes(workspace.timezone)
    ? TIMEZONES
    : [workspace.timezone, ...TIMEZONES];
  const currencyOptions = CURRENCIES.some((item) => item.value === workspace.defaultCurrency)
    ? CURRENCIES
    : [{ value: workspace.defaultCurrency, label: workspace.defaultCurrency }, ...CURRENCIES];

  function update<K extends keyof WorkspaceFormState>(field: K, value: WorkspaceFormState[K]) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !form || !baseline || !canManageWorkspace) return;

    const problem = slugError(form.slug);
    if (problem) {
      setError(problem);
      return;
    }

    const accentProblem = accentError(form.accentColor);
    if (accentProblem) {
      setError(accentProblem);
      return;
    }

    const patch = buildPatch(form, baseline, workspace.settings);
    if (!patch) {
      setNotice("没有需要保存的更改。");
      return;
    }

    setError(null);
    setNotice(null);
    try {
      await updateWorkspace.mutateAsync({ workspaceId: workspace.id, input: patch });

      if (patch.slug) {
        try {
          window.sessionStorage.setItem(SLUG_NOTICE_KEY, patch.slug);
        } catch {
          // Storage is optional; the address still changes.
        }
        // A slug change re-scopes every cached query, so re-resolve the whole
        // route instead of leaving the old slug in the address bar.
        window.location.assign(`/w/${patch.slug}/settings/workspace`);
        return;
      }

      setNotice("工作区设置已保存。");
    } catch (cause) {
      if (isForbidden(cause)) {
        setError("你的角色不能修改工作区设置。");
      } else if (isApiError(cause) && cause.status === 409) {
        setError("这个 Slug 已被其他工作区使用，请换一个。");
      } else {
        setError("工作区设置保存失败，请稍后重试。");
      }
    }
  }

  async function applyLogo(logoMediaId: string | null) {
    if (!workspace) return;
    setError(null);
    setNotice(null);
    setLogoApplying(true);
    try {
      await updateWorkspace.mutateAsync({ workspaceId: workspace.id, input: { logoMediaId } });
      setNotice(logoMediaId ? "工作区标志已更新。" : "工作区标志已移除。");
    } catch (cause) {
      setError(
        isForbidden(cause)
          ? "你的角色不能修改工作区标志。"
          : "工作区标志更新失败，请稍后重试。",
      );
    } finally {
      setLogoApplying(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="工作区 / 设置"
        title="工作区设置"
        description="工作区名称、地址、默认时区与日历，以及新建内容的默认偏好。"
      />

      {!canManageWorkspace ? (
        <p
          role="status"
          className="rounded-control border border-accent-orange/25 bg-accent-orange/5 px-3 py-2 text-xs leading-5 text-accent-orange"
        >
          当前角色是{roleLabel}。只有所有者和管理员可以修改工作区设置，本页内容对你只读。
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="rounded-control border border-accent-green/20 bg-accent-green/5 px-3 py-2 text-xs leading-5 text-accent-green"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-xs leading-5 text-accent-red"
        >
          {error}
        </p>
      ) : null}

      <form className="space-y-4" onSubmit={(event) => void save(event)}>
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <section className="surface-card space-y-5 p-5" aria-label="工作区身份">
            <div className="border-b border-hairline pb-4">
              <p className="type-eyebrow">基本信息</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                身份与地址
              </h2>
            </div>

            <WorkspaceLogoField
              workspace={workspace}
              canManage={canManageWorkspace}
              applying={logoApplying}
              onApply={(logoMediaId) => void applyLogo(logoMediaId)}
            />

            <FormField label="工作区名称">
              <Input
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                maxLength={120}
                readOnly={!canManageWorkspace}
                required
              />
            </FormField>

            <FormField
              label="工作区地址"
              hint="出现在工作区链接中。修改后地址会立即变更，旧链接将不再指向这里。"
              error={currentSlugError}
            >
              <Input
                value={form.slug}
                onChange={(event) => update("slug", event.target.value)}
                maxLength={80}
                readOnly={!canManageWorkspace}
                spellCheck={false}
                autoCapitalize="none"
                aria-invalid={currentSlugError ? true : undefined}
              />
            </FormField>
          </section>

          <section className="surface-card space-y-4 p-5" aria-label="地区与日历">
            <div className="border-b border-hairline pb-4">
              <p className="type-eyebrow">地区与日历</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                地区与日历
              </h2>
            </div>

            <FormField label="默认时区" hint="行程时间、日志日期与提醒都按这个时区解读。">
              <Select
                value={form.timezone}
                onChange={(event) => update("timezone", event.target.value)}
                disabled={!canManageWorkspace}
              >
                {timezoneOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="默认币种" hint="新建费用默认使用这个币种记账。">
              <Select
                value={form.defaultCurrency}
                onChange={(event) => update("defaultCurrency", event.target.value)}
                disabled={!canManageWorkspace}
              >
                {currencyOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="周起始日"
              hint="决定日历与周视图从哪一天开始排列。"
            >
              <Select
                value={form.weekStartsOn}
                onChange={(event) => update("weekStartsOn", Number(event.target.value))}
                disabled={!canManageWorkspace}
              >
                {WEEKDAYS.map((day) => (
                  <option key={day.value} value={day.value}>
                    {day.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </section>

          <section
            className="surface-card space-y-4 p-5 xl:col-span-2"
            aria-label="新内容默认值"
          >
            <div className="border-b border-hairline pb-4">
              <p className="type-eyebrow">默认偏好</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                新内容默认值
              </h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                label="默认可见性"
                hint={`新建旅行时默认使用「${VISIBILITY_LABELS[form.defaultVisibility]}」，单次创建时仍可修改。`}
              >
                <Select
                  value={form.defaultVisibility}
                  onChange={(event) =>
                    update("defaultVisibility", event.target.value as TripVisibility)
                  }
                  disabled={!canManageWorkspace}
                >
                  {TripVisibilitySchema.options.map((value) => (
                    <option key={value} value={value}>
                      {VISIBILITY_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField label="界面密度" hint="紧凑会让列表与表格显示更多行。">
                <Select
                  value={form.density}
                  onChange={(event) =>
                    update("density", event.target.value as "comfortable" | "compact")
                  }
                  disabled={!canManageWorkspace}
                >
                  {DENSITIES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <fieldset className="space-y-3">
              <legend className="mb-1.5 block type-eyebrow">
                工作区通知默认
              </legend>
              <div className="flex items-start justify-between gap-4 rounded-control border border-hairline bg-surface-1 px-3 py-2.5">
                <div className="min-w-0">
                  <label htmlFor="notification-default-in-app" className="text-sm text-ink">
                    站内通知
                  </label>
                  <p className="mt-1 text-[11px] leading-5 text-muted">
                    成员在你的工作区收到站内提醒。未单独设置时默认开启。
                  </p>
                </div>
                <Switch
                  id="notification-default-in-app"
                  checked={form.notificationInApp}
                  onCheckedChange={(checked) => update("notificationInApp", checked)}
                  disabled={!canManageWorkspace}
                />
              </div>
              <div className="flex items-start justify-between gap-4 rounded-control border border-hairline bg-surface-1 px-3 py-2.5">
                <div className="min-w-0">
                  <label htmlFor="notification-default-email" className="text-sm text-ink">
                    邮件通知
                  </label>
                  <p className="mt-1 text-[11px] leading-5 text-muted">
                    同时向成员发送邮件提醒。未单独设置时默认开启。
                  </p>
                </div>
                <Switch
                  id="notification-default-email"
                  checked={form.notificationEmail}
                  onCheckedChange={(checked) => update("notificationEmail", checked)}
                  disabled={!canManageWorkspace}
                />
              </div>
            </fieldset>

            <div className="space-y-2">
              <label
                htmlFor="workspace-accent-color"
                className="mb-1.5 block type-eyebrow"
              >
                强调色
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id="workspace-accent-color"
                  type="color"
                  aria-label="强调色选择器"
                  value={form.accentColor ?? "#3b9eff"}
                  onChange={(event) => update("accentColor", event.target.value)}
                  disabled={!canManageWorkspace}
                  className="h-10 w-14 cursor-pointer rounded-control border border-hairline-strong bg-surface-1 p-1 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <Input
                  aria-label="强调色十六进制值"
                  value={form.accentColor ?? ""}
                  placeholder="#3b9eff"
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    update("accentColor", value === "" ? null : value);
                  }}
                  readOnly={!canManageWorkspace}
                  maxLength={7}
                  spellCheck={false}
                  aria-invalid={currentAccentError ? true : undefined}
                  className="h-10 w-32 font-mono"
                />
                <Button
                  type="button"
                  variant="subtle"
                  size="sm"
                  onClick={() => update("accentColor", null)}
                  disabled={!canManageWorkspace || form.accentColor === null}
                >
                  使用默认
                </Button>
              </div>
              {currentAccentError ? (
                <p role="alert" className="text-xs leading-5 text-accent-red">
                  {currentAccentError}
                </p>
              ) : (
                <p className="text-xs leading-5 text-muted">
                  {form.accentColor
                    ? `当前使用 ${form.accentColor}。`
                    : "当前使用主题默认强调色。"}
                  必须是 #rrggbb 形式的六位十六进制色值。
                </p>
              )}
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-hairline bg-surface-1 px-4 py-3">
          <p className="text-xs text-muted">
            {isDirty ? "有未保存的更改。" : "所有更改已保存。"}
            <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.08em] text-stone">
              你的角色：{roleLabel}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => baseline && setForm(baseline)}
              disabled={!isDirty || updateWorkspace.isPending}
            >
              放弃更改
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={
                !canManageWorkspace ||
                !isDirty ||
                Boolean(currentSlugError) ||
                Boolean(currentAccentError) ||
                updateWorkspace.isPending
              }
            >
              <Save aria-hidden="true" />
              保存更改
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
