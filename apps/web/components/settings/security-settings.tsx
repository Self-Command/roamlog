"use client";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  FormField,
  HydrationSafeForm,
  HydrationSafeSubmitButton,
  Input,
  PageHeader,
  Separator,
  Skeleton,
} from "@roamlog/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Link2,
  LogOut,
  Mail,
  Monitor,
  ShieldCheck,
  Smartphone,
  Tablet,
  TriangleAlert,
  Tv,
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";

import {
  accountSecurityErrorMessage,
  changeEmail,
  changePassword,
  getSecuritySession,
  revokeOtherSessions,
  signOut,
  verifyCurrentPassword,
} from "@/lib/api/auth";
import { isApiError } from "@/lib/api";
import { groupSessionsByDevice, type DeviceKind } from "@/lib/device-sessions";
import {
  MY_SESSIONS_QUERY_KEY,
  deleteMyAccount,
  listMySessions,
  revokeMySession,
} from "@/lib/api/me";
import { useSessionQuery } from "@/lib/query";

const SECURITY_SESSION_KEY = ["v1", "auth", "security-session"] as const;
const MIN_PASSWORD_LENGTH = 8;
/**
 * Rows rendered before the "显示其余" button. A long-lived account can accumulate
 * dozens of sessions; the page keeps them all reachable without pushing the
 * password and 2FA cards below a metre of repetition.
 */
const SESSIONS_PAGE_SIZE = 6;

function Notice({ tone, children }: { tone: "ok" | "error"; children: ReactNode }) {
  return (
    <p
      role={tone === "ok" ? "status" : "alert"}
      className={
        tone === "ok"
          ? "rounded-control border border-accent-green/20 bg-accent-green/5 px-3 py-2 text-xs text-accent-green"
          : "rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-xs text-accent-red"
      }
    >
      {children}
    </p>
  );
}

function DeviceIcon({ kind }: { kind: DeviceKind }) {
  switch (kind) {
    case "mobile":
      return <Smartphone aria-hidden="true" className="size-4" />;
    case "tablet":
      return <Tablet aria-hidden="true" className="size-4" />;
    case "tv":
      return <Tv aria-hidden="true" className="size-4" />;
    case "desktop":
      return <Monitor aria-hidden="true" className="size-4" />;
    default:
      return <Smartphone aria-hidden="true" className="size-4" />;
  }
}

function formatMoment(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

interface ConfirmOptions {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
}

export function SecuritySettings({ workspaceSlug }: { workspaceSlug: string }) {
  const queryClient = useQueryClient();
  const sessionQuery = useSessionQuery();
  const currentSessionId = sessionQuery.data?.session?.id ?? null;

  const sessionsQuery = useQuery({
    queryKey: MY_SESSIONS_QUERY_KEY,
    queryFn: ({ signal }) => listMySessions({ signal }),
    staleTime: 15_000,
  });

  const securitySessionQuery = useQuery({
    queryKey: SECURITY_SESSION_KEY,
    queryFn: () => getSecuritySession(),
    staleTime: 30_000,
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordNotice, setPasswordNotice] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordConfirmOpen, setPasswordConfirmOpen] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailConfirmOpen, setEmailConfirmOpen] = useState(false);

  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [devicesExpanded, setDevicesExpanded] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const passwordMutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setPasswordNotice("密码已更新。当前设备保持登录状态。");
      setPasswordError(null);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (cause: unknown) => {
      setPasswordError(accountSecurityErrorMessage(cause, "password"));
    },
    onSettled: () => setPasswordConfirmOpen(false),
  });

  const emailMutation = useMutation({
    mutationFn: async () => {
      // `/change-email` does not take a password, so the form's password field is
      // verified against the auth service first — otherwise it would be decoration.
      await verifyCurrentPassword(emailPassword);
      const callbackURL = `${window.location.origin}/w/${workspaceSlug}/settings/security`;
      await changeEmail(newEmail.trim(), callbackURL);
    },
    onSuccess: () => {
      // Better Auth's two-step flow: the confirmation goes to the CURRENT
      // address, the verification link to the new one only after that.
      const currentEmail = sessionQuery.data?.user.email ?? "当前邮箱";
      setEmailNotice(
        `确认邮件已发送到 ${currentEmail}。点击确认后，验证邮件会发到 ${newEmail.trim()}；两封都完成后新邮箱才生效。`,
      );
      setEmailError(null);
      setNewEmail("");
      setEmailPassword("");
    },
    onError: (cause: unknown) => {
      setEmailError(accountSecurityErrorMessage(cause, "email"));
    },
    onSettled: () => setEmailConfirmOpen(false),
  });

  const revokeMutation = useMutation({
    mutationFn: async ({
      sessionIds,
    }: {
      deviceId: string;
      sessionIds: readonly string[];
      isCurrent: boolean;
    }) => {
      const ordered = [...sessionIds].sort(
        (left, right) => Number(left === currentSessionId) - Number(right === currentSessionId),
      );
      for (const id of ordered) {
        try {
          await revokeMySession(id);
        } catch (error) {
          if (!(isApiError(error) && error.status === 404)) {
            throw error;
          }
        }
      }
    },
    onMutate: ({ deviceId }) => setRevokingId(deviceId),
    onSuccess: (_data, { isCurrent }) => {
      setDeviceError(null);
      if (isCurrent) {
        setDeviceNotice("当前设备已退出登录。");
        void signOut().catch(() => undefined);
        window.location.assign("/login");
        return;
      }
      setDeviceNotice("该设备上的所有登录会话已退出。");
    },
    onError: () => {
      setDeviceError("退出该设备失败，请稍后重试。");
    },
    onSettled: () => {
      setRevokingId(null);
      void queryClient.invalidateQueries({ queryKey: MY_SESSIONS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: SECURITY_SESSION_KEY });
    },
  });

  const revokeOthersMutation = useMutation({
    mutationFn: () => revokeOtherSessions(),
    onSuccess: () => {
      setDeviceNotice("已退出所有其他设备，当前设备保持登录。");
      setDeviceError(null);
    },
    onError: () => setDeviceError("退出其他设备失败，请稍后重试。"),
    onSettled: () => {
      setRevokingOthers(false);
      void queryClient.invalidateQueries({ queryKey: MY_SESSIONS_QUERY_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMyAccount(),
    onSuccess: async () => {
      // The API has already deleted every session; drop the cookie too so the
      // next document request cannot land on a half-deleted account.
      await signOut().catch(() => undefined);
      window.location.assign("/login");
    },
    onError: (cause: unknown) => {
      setDeleteError(
        isApiError(cause) && cause.code === "OWNER_MUST_TRANSFER_OR_DELETE_WORKSPACE"
          ? "你仍然是某个工作区的所有者。请先在危险区转移所有权或删除该工作区，再回来删除账号。"
          : "账号删除没有完成，请稍后重试。",
      );
      setDeleteOpen(false);
    },
  });

  const twoFactorEnabled = securitySessionQuery.data?.twoFactorEnabled === true;
  const sessions = sessionsQuery.data ?? [];
  const devices = groupSessionsByDevice(sessions, currentSessionId);
  const visibleDevices = devicesExpanded ? devices : devices.slice(0, SESSIONS_PAGE_SIZE);
  const hiddenDeviceCount = Math.max(0, devices.length - visibleDevices.length);
  const otherDeviceCount = devices.filter((device) => !device.isCurrent).length;

  function requestPasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordNotice(null);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`新密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致。");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("新密码不能与当前密码相同。");
      return;
    }
    setConfirm({
      title: "确认修改密码？",
      description: "修改后当前密码立即失效，其他设备会继续使用现有的登录状态。",
      confirmLabel: "确认修改密码",
      tone: "danger",
    });
    setPasswordConfirmOpen(true);
  }

  function requestEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError(null);
    setEmailNotice(null);
    const trimmed = newEmail.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError("请输入有效的新邮箱地址。");
      return;
    }
    if (trimmed.toLowerCase() === (sessionQuery.data?.user.email ?? "").toLowerCase()) {
      setEmailError("新邮箱与当前邮箱相同。");
      return;
    }
    if (!emailPassword) {
      setEmailError("请输入当前密码以确认身份。");
      return;
    }
    setConfirm({
      title: "确认修改邮箱？",
      description: `我们会先向当前邮箱 ${sessionQuery.data?.user.email ?? ""} 发送确认邮件，确认后再向 ${trimmed} 发送验证邮件；两封都完成后新邮箱才生效。`,
      confirmLabel: "发送确认邮件",
      tone: "primary",
    });
    setEmailConfirmOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="设置 / 安全"
        title="账号安全"
        description="管理密码、邮箱、两步验证和已登录的设备。修改密码或邮箱前需要再次确认。"
      />

      {confirm ? (
        <Dialog
          open={confirm.tone === "primary" ? emailConfirmOpen : passwordConfirmOpen}
          onOpenChange={(open) => {
            if (!open) {
              if (confirm.tone === "primary") setEmailConfirmOpen(false);
              else setPasswordConfirmOpen(false);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirm.title}</DialogTitle>
              <DialogDescription className="text-sm leading-6 text-muted">
                {confirm.description}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setPasswordConfirmOpen(false);
                  setEmailConfirmOpen(false);
                }}
              >
                取消
              </Button>
              <Button
                type="button"
                variant={confirm.tone === "danger" ? "danger" : "primary"}
                disabled={passwordMutation.isPending || emailMutation.isPending}
                onClick={() => {
                  if (confirm.tone === "primary") emailMutation.mutate();
                  else passwordMutation.mutate();
                }}
              >
                {passwordMutation.isPending || emailMutation.isPending
                  ? "处理中…"
                  : confirm.confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      <Dialog open={revokeAllOpen} onOpenChange={setRevokeAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>退出所有其他设备？</DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted">
              其他设备上的登录状态会立即失效，当前设备保持登录。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRevokeAllOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={revokeOthersMutation.isPending}
              onClick={() => {
                setRevokeAllOpen(false);
                setRevokingOthers(true);
                revokeOthersMutation.mutate();
              }}
            >
              {revokeOthersMutation.isPending ? "处理中…" : "退出所有其他设备"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <HydrationSafeForm className="surface-card p-5" onSubmit={requestPasswordChange}>
          <div className="flex items-center gap-3 border-b border-hairline pb-4">
            <span className="flex size-9 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
              <KeyRound aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="type-eyebrow">密码</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                修改密码
              </h2>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <FormField label="当前密码" required>
              <Input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </FormField>
            <FormField label="新密码" hint={`至少 ${MIN_PASSWORD_LENGTH} 个字符。`} required>
              <Input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </FormField>
            <FormField label="确认新密码" required>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </FormField>
          </div>

          {passwordNotice ? (
            <div className="mt-4">
              <Notice tone="ok">{passwordNotice}</Notice>
            </div>
          ) : null}
          {passwordError ? (
            <div className="mt-4">
              <Notice tone="error">{passwordError}</Notice>
            </div>
          ) : null}

          <HydrationSafeSubmitButton
            variant="primary"
            className="mt-5"
            disabled={passwordMutation.isPending}
          >
            {passwordMutation.isPending ? "保存中…" : "修改密码"}
          </HydrationSafeSubmitButton>
        </HydrationSafeForm>

        <HydrationSafeForm className="surface-card p-5" onSubmit={requestEmailChange}>
          <div className="flex items-center gap-3 border-b border-hairline pb-4">
            <span className="flex size-9 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
              <Mail aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="type-eyebrow">邮箱</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                修改邮箱
              </h2>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <FormField label="当前邮箱">
              <Input value={sessionQuery.data?.user.email ?? ""} readOnly disabled />
            </FormField>
            <FormField label="新邮箱" required>
              <Input
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </FormField>
            <FormField label="当前密码" hint="用于确认这次修改是你本人操作。" required>
              <Input
                type="password"
                value={emailPassword}
                onChange={(event) => setEmailPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </FormField>
          </div>

          {emailNotice ? (
            <div className="mt-4">
              <Notice tone="ok">{emailNotice}</Notice>
            </div>
          ) : null}
          {emailError ? (
            <div className="mt-4">
              <Notice tone="error">{emailError}</Notice>
            </div>
          ) : null}

          <HydrationSafeSubmitButton
            variant="primary"
            className="mt-5"
            disabled={emailMutation.isPending}
          >
            {emailMutation.isPending ? "发送中…" : "修改邮箱"}
          </HydrationSafeSubmitButton>
        </HydrationSafeForm>
      </div>

      <section className="surface-card p-5" aria-label="两步验证">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
              <ShieldCheck aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="type-eyebrow">两步验证</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                两步验证
              </h2>
              <p className="mt-2 max-w-xl text-xs leading-5 text-muted">
                登录时在密码之外再输入一次验证器中的 6 位验证码。开启后还可以生成一次性备用码。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={twoFactorEnabled ? "green" : "slate"}>
              {securitySessionQuery.isLoading ? "读取中" : twoFactorEnabled ? "已开启" : "未开启"}
            </Badge>
            <Button type="button" variant="ghost" asChild>
              <Link href="/settings/security">
                <Link2 aria-hidden="true" />
                管理两步验证
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="surface-card p-5" aria-label="登录设备">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
              <Smartphone aria-hidden="true" className="size-4" />
            </span>
            <div>
              <p className="type-eyebrow">登录设备</p>
              <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
                登录设备
              </h2>
              <p className="mt-2 text-xs leading-5 text-muted">
                共 {devices.length} 台设备 · {sessions.length} 个有效会话；同一设备只显示一次。
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={revokingOthers || revokeOthersMutation.isPending || otherDeviceCount === 0}
            onClick={() => setRevokeAllOpen(true)}
          >
            <LogOut aria-hidden="true" />
            退出所有其他设备
          </Button>
        </div>

        {deviceNotice ? (
          <div className="mt-4">
            <Notice tone="ok">{deviceNotice}</Notice>
          </div>
        ) : null}
        {deviceError ? (
          <div className="mt-4">
            <Notice tone="error">{deviceError}</Notice>
          </div>
        ) : null}

        {sessionsQuery.isLoading ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full rounded-control" />
            ))}
          </div>
        ) : sessionsQuery.isError ? (
          <div className="mt-4">
            <ErrorState
              title="设备列表不可用"
              description="没有读取到已登录的设备，请稍后重试。"
              retryAction={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void sessionsQuery.refetch()}
                >
                  重新加载
                </Button>
              }
            />
          </div>
        ) : devices.length === 0 ? (
          <p className="mt-4 rounded-control border border-hairline bg-surface-1 px-3 py-6 text-center text-xs text-muted">
            没有仍在有效的设备会话。
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-hairline">
            {visibleDevices.map((device) => (
              <li
                key={device.id}
                aria-label={`设备：${device.profile.label}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
                    <DeviceIcon kind={device.profile.kind} />
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      <span className="truncate">{device.profile.label}</span>
                      {device.isCurrent ? <Badge tone="blue">当前设备</Badge> : null}
                      {device.sessionCount > 1 ? (
                        <Badge tone="neutral">{device.sessionCount} 次登录</Badge>
                      ) : null}
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-muted">{device.profile.detail}</p>
                    <p className="mt-1 text-[11px] text-muted">
                      {device.ip ?? "未知 IP"} · 最近登录 {formatMoment(device.loginAt)} · 有效至{" "}
                      {formatMoment(device.expiresAt)}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={revokingId === device.id}
                  onClick={() => {
                    setDeviceNotice(null);
                    setDeviceError(null);
                    revokeMutation.mutate({
                      deviceId: device.id,
                      sessionIds: device.sessionIds,
                      isCurrent: device.isCurrent,
                    });
                  }}
                >
                  {revokingId === device.id
                    ? "退出中…"
                    : device.isCurrent
                      ? "退出当前设备"
                      : "退出此设备"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {hiddenDeviceCount > 0 || devicesExpanded ? (
          <div className="mt-3 flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDevicesExpanded((current) => !current)}
            >
              {devicesExpanded ? "收起设备列表" : `显示其余 ${hiddenDeviceCount} 台设备`}
            </Button>
          </div>
        ) : null}

        <Separator className="mt-4" />
        <p className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-muted">
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0 text-accent-yellow"
          />
          在公共电脑上使用后请退出登录；如果发现陌生设备，请先修改密码再退出该设备。
        </p>
      </section>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除账号？</DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted">
              账号会被匿名化，登录会话、两步验证与通知偏好在同一事务里删除。这个操作无法撤销，
              历史评论与日志会显示为“已注销用户”。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={deleteMutation.isPending}
              onClick={() => {
                setDeleteError(null);
                deleteMutation.mutate();
              }}
            >
              {deleteMutation.isPending ? "删除中…" : "确认删除账号"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section className="surface-card p-5" aria-label="删除账号">
        <div className="flex items-start gap-3 border-b border-hairline pb-4">
          <span className="flex size-9 items-center justify-center rounded-control border border-accent-red/30 bg-accent-red/10 text-accent-red">
            <TriangleAlert aria-hidden="true" className="size-4" />
          </span>
          <div>
            <p className="type-eyebrow">危险操作</p>
            <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.015em] text-ink">
              删除账号
            </h2>
            <p className="mt-2 max-w-xl text-xs leading-5 text-muted">
              删除后当前账号立即退出所有设备，邮箱与姓名会被匿名化。工作区本身不会被删除：
              如果你仍然是某个工作区的所有者，需要先转移所有权或删除该工作区。
            </p>
          </div>
        </div>

        <div className="mt-5 max-w-sm space-y-3">
          <FormField
            label="输入“删除账号”以确认"
            hint="必须逐字输入“删除账号”，删除按钮才会启用。"
          >
            <Input
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              placeholder="删除账号"
              autoComplete="off"
            />
          </FormField>
          <Button
            type="button"
            variant="danger"
            disabled={deleteConfirmation !== "删除账号" || deleteMutation.isPending}
            onClick={() => {
              setDeleteError(null);
              setDeleteOpen(true);
            }}
          >
            <TriangleAlert aria-hidden="true" />
            删除这个账号
          </Button>
        </div>

        {deleteError ? (
          <div className="mt-4">
            <Notice tone="error">{deleteError}</Notice>
          </div>
        ) : null}
      </section>
    </div>
  );
}
