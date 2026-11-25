"use client";

import {
  Avatar,
  Badge,
  Button,
  FormField,
  Input,
  PageHeader,
  Progress,
  Select,
  Skeleton,
} from "@roamlog/ui";
import { Camera, MailCheck, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { resolveCoverMimeType } from "@/components/media/cover-upload-validation";
import { isForbidden } from "@/lib/api";
import { authErrorMessage, sendVerificationEmail } from "@/lib/api/auth";
import {
  isAvatarUploadError,
  isImageUrlExpired,
  mediaIdFromImageUrl,
  uploadAvatar,
  type AvatarUploadPhase,
} from "@/lib/api/me";
import { COVER_ACCEPT_ATTRIBUTE, COVER_MAX_BYTES } from "@/lib/api/media";
import { formatBytes } from "@/lib/format-bytes";
import { useMeQuery, useUpdateMeMutation, useWorkspaceBySlug } from "@/lib/query";

/** Timezones offered in the picker; the account's current value is always added. */
const timezones = [
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

const locales = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English (US)" },
];

const PHASE_LABEL: Record<AvatarUploadPhase, string> = {
  idle: "",
  validating: "正在检查图片…",
  presigning: "正在准备上传…",
  uploading: "正在上传头像…",
  completing: "正在登记图片…",
  processing: "正在生成头像尺寸…",
  done: "头像已更新。",
};

export function ProfileSettings({ workspaceSlug }: { workspaceSlug: string }) {
  const meQuery = useMeQuery();
  const { workspace } = useWorkspaceBySlug(workspaceSlug);
  const updateMe = useUpdateMeMutation();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [locale, setLocale] = useState("zh-CN");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avatarPhase, setAvatarPhase] = useState<AvatarUploadPhase>("idle");
  const [avatarProgress, setAvatarProgress] = useState<number | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [pendingPreview, setPendingPreview] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [resending, setResending] = useState(false);

  const me = meQuery.data;

  useEffect(() => {
    if (me) {
      setName(me.name);
      setTimezone(me.timezone);
      setLocale(me.locale);
    }
  }, [me]);

  /**
   * A signed avatar URL is only valid for 15 minutes. The API stores the media
   * id and re-signs it on every read, so a single refetch replaces the expiring
   * URL before `<img>` breaks. `healedAvatarUrl` limits that to one request per
   * URL: a legacy row that still stores a raw URL stays expired (with the
   * warning below) instead of refetching in a loop.
   */
  const healedAvatarUrl = useRef<string | null>(null);
  useEffect(() => {
    const url = me?.image;
    if (!url || healedAvatarUrl.current === url || !isImageUrlExpired(url)) return;
    healedAvatarUrl.current = url;
    void meQuery.refetch();
  }, [me?.image, meQuery]);

  // Object URLs from the picked file must be released on unmount.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );
  useEffect(
    () => () => {
      if (pendingPreview) URL.revokeObjectURL(pendingPreview);
    },
    [pendingPreview],
  );

  if (meQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-44" />
        <Skeleton className="h-80 rounded-card" />
      </div>
    );
  }

  if (!me) {
    return (
      <p className="text-sm text-muted">个人资料不可用：当前账号没有载入。请刷新页面重试。</p>
    );
  }

  const avatarBusy = avatarPhase !== "idle" && avatarPhase !== "done";
  const avatarSrc = pendingPreview ?? me.image ?? undefined;
  const avatarIsMedia = mediaIdFromImageUrl(me.image) !== null;
  const avatarExpired = avatarIsMedia && isImageUrlExpired(me.image);
  const zoneOptions = timezones.includes(me.timezone)
    ? timezones
    : [me.timezone, ...timezones];
  const localeOptions = locales.some((item) => item.value === me.locale)
    ? locales
    : [{ value: me.locale, label: me.locale }, ...locales];

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so picking the same file twice still fires a change event.
    event.target.value = "";
    if (!file) return;

    setAvatarError(null);
    setNotice(null);
    setError(null);

    const mimeType = resolveCoverMimeType(file);
    if (!mimeType) {
      setAvatarError("请选择 JPEG、PNG、WebP、AVIF 或 HEIC 格式的图片。");
      return;
    }
    if (file.size > COVER_MAX_BYTES) {
      setAvatarError(`图片不能超过 ${formatBytes(COVER_MAX_BYTES)}。`);
      return;
    }
    if (!workspace) {
      setAvatarError("工作区暂时无法加载，请稍后再试。");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const objectUrl = URL.createObjectURL(file);
    setPendingPreview(objectUrl);
    setAvatarPhase("validating");
    setAvatarProgress(0);

    try {
      const result = await uploadAvatar({
        workspaceId: workspace.id,
        file,
        mimeType,
        signal: controller.signal,
        onPhase: setAvatarPhase,
        onProgress: setAvatarProgress,
      });
      await updateMe.mutateAsync({ image: result.url });
      setAvatarPhase("done");
      setAvatarProgress(null);
      setNotice("头像已更新。");
    } catch (cause) {
      setAvatarPhase("idle");
      setAvatarProgress(null);
      setAvatarError(
        isAvatarUploadError(cause)
          ? cause.message
          : "头像上传失败，请稍后重试。",
      );
    } finally {
      URL.revokeObjectURL(objectUrl);
      setPendingPreview(null);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function removeAvatar() {
    setAvatarError(null);
    setNotice(null);
    setRemoving(true);
    try {
      await updateMe.mutateAsync({ image: null });
      setNotice("头像已移除。");
    } catch {
      setAvatarError("头像移除失败，请稍后重试。");
    } finally {
      setRemoving(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("显示名称不能为空。");
      return;
    }
    try {
      await updateMe.mutateAsync({ name: trimmedName, timezone, locale });
      setNotice("个人资料已保存。");
    } catch (cause) {
      setError(
        isForbidden(cause)
          ? "当前账号没有修改个人资料的权限。"
          : "个人资料保存失败，请检查网络后重试。",
      );
    }
  }

  async function resendVerification(email: string) {
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      await sendVerificationEmail(email);
      setNotice(`验证邮件已发送到 ${email}。请查收并点击邮件中的链接完成验证。`);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="设置 / 个人资料"
        title="个人资料"
        description="头像、显示名称、时区与语言会用于整个账号，也会出现在其他成员的视图里。"
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

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <section className="surface-card p-5" aria-label="头像">
          <div className="flex items-center gap-3 border-b border-hairline pb-4">
            <span className="flex size-9 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
              <Camera aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="type-eyebrow">头像</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                头像
              </h2>
            </div>
          </div>

          <div className="mt-5 flex flex-col items-center gap-4">
            <Avatar name={me.name} src={avatarSrc} size={96} />
            <p className="text-center text-[11px] leading-5 text-muted">
              {avatarBusy
                ? PHASE_LABEL[avatarPhase]
                : "支持 JPEG、PNG、WebP、AVIF、HEIC，最大 " + formatBytes(COVER_MAX_BYTES) + "。"}
            </p>
            {avatarProgress !== null ? (
              <Progress
                aria-label="头像上传进度"
                value={avatarProgress}
                className="w-full"
              />
            ) : null}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept={COVER_ACCEPT_ATTRIBUTE}
            className="sr-only"
            aria-label="选择头像图片"
            data-testid="avatar-file-input"
            onChange={(event) => void handleFile(event)}
          />

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={avatarBusy || !workspace}
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera aria-hidden="true" />
              {me.image ? "替换头像" : "上传头像"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!me.image || removing || avatarBusy}
              onClick={() => void removeAvatar()}
            >
              <Trash2 aria-hidden="true" />
              移除
            </Button>
          </div>

          {avatarError ? (
            <p
              role="alert"
              className="mt-3 rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-[11px] leading-5 text-accent-red"
            >
              {avatarError}
            </p>
          ) : null}

          {avatarExpired ? (
            <p className="mt-3 rounded-control border border-accent-yellow/25 bg-accent-yellow/5 px-3 py-2 text-[11px] leading-5 text-accent-yellow">
              这张头像保存的是旧版短期图片链接，已经过期，其他页面会显示姓名首字母。重新上传即可换成长期有效的头像。
            </p>
          ) : null}
        </section>

        <form className="surface-card p-5" onSubmit={(event) => void saveProfile(event)}>
          <div className="flex items-center gap-3 border-b border-hairline pb-4">
            <span className="flex size-9 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
              <MailCheck aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="type-eyebrow">账号信息</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                账号信息
              </h2>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <FormField label="显示名称" hint="其他成员在成员列表、评论与活动里看到这个名字。">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                required
                autoComplete="name"
              />
            </FormField>

            <div>
              <div className="flex items-center justify-between gap-3">
                <FormField label="邮箱" className="min-w-0 flex-1">
                  <Input value={me.email} readOnly disabled />
                </FormField>
                <Badge tone={me.emailVerified ? "green" : "yellow"} className="mt-5">
                  {me.emailVerified ? "已验证" : "未验证"}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className="text-[11px] leading-5 text-muted">
                  {me.emailVerified
                    ? "邮箱已验证。修改邮箱请前往账号安全。"
                    : "邮箱还没有验证，部分操作会受限。"}
                </p>
                {me.emailVerified ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={resending}
                    onClick={() => void resendVerification(me.email)}
                  >
                    {resending ? "发送中…" : "重新发送验证邮件"}
                  </Button>
                )}
              </div>
            </div>

            <FormField label="时区" hint="用于日志时间、提醒和导出文件里的时间换算。">
              <Select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                {zoneOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="语言">
              <Select value={locale} onChange={(event) => setLocale(event.target.value)}>
                {localeOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <Button
            type="submit"
            variant="primary"
            className="mt-5"
            disabled={updateMe.isPending}
          >
            <Save aria-hidden="true" />
            {updateMe.isPending ? "保存中…" : "保存个人资料"}
          </Button>
        </form>
      </div>
    </div>
  );
}
