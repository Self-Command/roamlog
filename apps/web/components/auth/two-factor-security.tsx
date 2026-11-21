"use client";

import {
  Badge,
  Button,
  FormField,
  Input,
  PageGlow,
  Separator,
  Skeleton,
  Switch,
} from "@roamlog/ui";
import {
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  LockKeyhole,
  QrCode,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  twoFactorAuthTransport,
  twoFactorErrorMessage,
  type SecuritySession,
  type TwoFactorAuthTransport,
  type TwoFactorEnrollment,
} from "@/lib/api/auth";

import { TotpQr } from "./totp-qr";

type SecurityPanel = "none" | "enroll-password" | "enrollment" | "disable" | "regenerate";

interface TwoFactorSecurityViewProps {
  auth?: TwoFactorAuthTransport;
  initialSession?: SecuritySession;
}

export function TwoFactorSecurityView({
  auth = twoFactorAuthTransport,
  initialSession,
}: TwoFactorSecurityViewProps) {
  const [session, setSession] = useState<SecuritySession | null | undefined>(initialSession);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [panel, setPanel] = useState<SecurityPanel>("none");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<TwoFactorEnrollment | null>(null);
  const [enrollmentVerified, setEnrollmentVerified] = useState(false);
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<"secret" | "codes" | null>(null);

  useEffect(() => {
    if (initialSession) {
      setSession(initialSession);
      return;
    }

    let cancelled = false;
    setSession(undefined);
    auth
      .getSecuritySession()
      .then((next) => {
        if (!cancelled) setSession(next);
      })
      .catch((cause) => {
        if (!cancelled) {
          setLoadError(twoFactorErrorMessage(cause));
          setSession(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [auth, initialSession]);

  const authenticated = session?.authenticated === true;
  const enabled = authenticated && session?.twoFactorEnabled === true;
  const loading = session === undefined;
  const secret = useMemo(() => {
    if (!enrollment) return "";
    try {
      return new URL(enrollment.totpURI).searchParams.get("secret") ?? "";
    } catch {
      return "";
    }
  }, [enrollment]);

  function resetMessages() {
    setError(null);
    setNotice(null);
    setCopied(null);
  }

  function closePanel() {
    setPanel("none");
    setPassword("");
    setCode("");
    setError(null);
  }

  async function startEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setError("请输入当前账户密码。");
      return;
    }
    resetMessages();
    setBusy(true);
    try {
      const next = await auth.enableTwoFactor(password);
      setEnrollment(next);
      setEnrollmentVerified(false);
      setPanel("enrollment");
      setPassword("");
      if (next.backupCodes.length === 0) {
        setError("没有获取到备用码。请完成验证后重新生成备用码。");
      }
    } catch (cause) {
      setError(twoFactorErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("请输入验证器中的 6 位数字验证码。");
      return;
    }
    resetMessages();
    setBusy(true);
    try {
      await auth.verifyTotp(code);
      setSession((current) => (current ? { ...current, twoFactorEnabled: true } : current));
      setEnrollmentVerified(true);
      setNotice("两步验证已启用。请确认备用码已离线保存。");
      setCode("");
    } catch (cause) {
      setError(twoFactorErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setError("请输入当前账户密码。");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError("请输入验证器中的 6 位数字验证码。");
      return;
    }
    resetMessages();
    setBusy(true);
    try {
      await auth.verifyTotp(code);
      await auth.disableTwoFactor(password);
      setSession((current) => (current ? { ...current, twoFactorEnabled: false } : current));
      setEnrollment(null);
      setNewBackupCodes(null);
      setEnrollmentVerified(false);
      setPanel("none");
      setPassword("");
      setCode("");
      setNotice("两步验证已关闭。现有备用码已失效。");
    } catch (cause) {
      setError(twoFactorErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function regenerateBackupCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password) {
      setError("请输入当前账户密码。");
      return;
    }
    resetMessages();
    setBusy(true);
    try {
      const codes = await auth.generateBackupCodes(password);
      setNewBackupCodes(codes);
      setPanel("regenerate");
      setPassword("");
      setNotice(`已生成 ${codes.length} 个新备用码。旧备用码已全部失效。`);
    } catch (cause) {
      setError(twoFactorErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function copyText(kind: "secret" | "codes", value: string) {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setNotice(kind === "secret" ? "验证器密钥已复制。" : "备用码已复制。");
    } catch {
      setError("浏览器没有允许剪贴板访问，请手动选择并复制。");
    }
  }

  function handleToggle(checked: boolean) {
    resetMessages();
    setPassword("");
    setCode("");
    if (checked) {
      setPanel("enroll-password");
      return;
    }
    setPanel("disable");
  }

  if (loading) {
    return (
      <SecurityFrame>
        <div className="space-y-4">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-14 w-80" />
          <Skeleton className="h-72 rounded-card" />
        </div>
      </SecurityFrame>
    );
  }

  if (loadError) {
    return (
      <SecurityFrame>
        <div className="surface-card max-w-xl p-6">
          <p className="type-eyebrow">SECURITY / LOAD ERROR</p>
          <h1 className="mt-2 font-serif text-4xl tracking-[-0.03em] text-ink">无法读取安全状态</h1>
          <p role="alert" className="mt-3 text-sm leading-6 text-accent-red">
            {loadError}
          </p>
          <Button className="mt-5" variant="outline" onClick={() => window.location.reload()}>
            重试
          </Button>
        </div>
      </SecurityFrame>
    );
  }

  return (
    <SecurityFrame>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="type-eyebrow">ACCOUNT / SECURITY</p>
            <Badge tone={enabled ? "green" : "neutral"}>
              {enabled ? "两步验证已开启" : "两步验证未开启"}
            </Badge>
          </div>
          <h1 className="mt-3 font-serif text-[clamp(2.1rem,1.7rem+1.2vw,3.25rem)] leading-none tracking-[-0.04em] text-ink">
            账号安全
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
            用验证器应用保护邮箱登录。备用码只在生成时显示一次，每个码只能成功使用一次。
          </p>
        </div>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          返回 Roamlog
        </a>
      </div>

      <Separator className="my-6" />

      {!authenticated ? (
        <section className="surface-card max-w-2xl p-6">
          <div className="flex items-center gap-2">
            <LockKeyhole aria-hidden="true" className="size-4 text-muted" />
            <p className="type-eyebrow">SIGN IN REQUIRED</p>
          </div>
          <h2 className="mt-3 font-serif text-3xl tracking-[-0.03em] text-ink">
            先登录再管理两步验证
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted">
            启用两步验证、查看备用码和关闭功能都需要先登录。
          </p>
          <a
            href="/login?next=/settings/security"
            className="mt-5 inline-flex h-9 items-center rounded-control bg-ink px-4 text-[12px] font-medium text-black outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            前往登录
          </a>
        </section>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.8fr)]">
          <div className="space-y-4">
            {notice ? (
              <p
                role="status"
                className="rounded-control border border-accent-green/20 bg-accent-green/5 px-3 py-2.5 text-xs leading-5 text-accent-green"
              >
                {notice}
              </p>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2.5 text-xs leading-5 text-accent-red"
              >
                {error}
              </p>
            ) : null}

            <section className="surface-card overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-hairline p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
                    <ShieldCheck aria-hidden="true" className="size-4" />
                  </span>
                  <div>
                    <p className="type-eyebrow">AUTHENTICATOR APP</p>
                    <h2 className="mt-1 font-serif text-2xl tracking-[-0.02em] text-ink">
                      两步验证
                    </h2>
                    <p className="mt-1 text-[11px] leading-5 text-muted">
                      {enabled
                        ? "登录密码通过后，还会要求输入验证器动态码。"
                        : "启用后，每次登录都需要密码和验证器中的 6 位动态码。"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 sm:pl-4">
                  <div className="text-right">
                    <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
                      {enabled ? "ENABLED" : "DISABLED"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {enabled ? "需要验证码" : "仅密码登录"}
                    </p>
                  </div>
                  <Switch
                    checked={enabled}
                    aria-label={enabled ? "关闭两步验证" : "启用两步验证"}
                    disabled={busy || panel === "enrollment"}
                    onCheckedChange={handleToggle}
                  />
                </div>
              </div>

              <div className="p-5">
                {panel === "none" ? (
                  <EnabledSummary
                    enabled={enabled}
                    onRegenerate={() => {
                      resetMessages();
                      setPanel("regenerate");
                    }}
                  />
                ) : null}

                {panel === "enroll-password" ? (
                  <form onSubmit={startEnrollment} className="max-w-md space-y-4">
                    <div>
                      <p className="type-eyebrow">STEP 1 / CONFIRM PASSWORD</p>
                      <h3 className="mt-1 text-sm font-medium text-ink">确认当前密码</h3>
                      <p className="mt-1 text-[11px] leading-5 text-muted">
                        密码只用于本次确认，不会保存在浏览器中。
                      </p>
                    </div>
                    <FormField
                      id="security-enrollment-password"
                      label="当前密码"
                      required
                      hint="确认后会生成验证器密钥与 10 个一次性备用码。"
                    >
                      <Input
                        autoComplete="current-password"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.currentTarget.value)}
                      />
                    </FormField>
                    {error ? (
                      <p role="alert" className="text-xs leading-5 text-accent-red">
                        {error}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" variant="primary" disabled={busy}>
                        <QrCode aria-hidden="true" />
                        {busy ? "正在生成…" : "生成验证器密钥"}
                      </Button>
                      <Button type="button" variant="ghost" onClick={closePanel}>
                        取消
                      </Button>
                    </div>
                  </form>
                ) : null}

                {panel === "enrollment" && enrollment ? (
                  <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                    <div className="rounded-control border border-hairline bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="type-eyebrow">SCAN QR</p>
                        <Badge tone="green">QR CODE</Badge>
                      </div>
                      <div className="mt-3">
                        <TotpQr uri={enrollment.totpURI} label="验证器二维码" />
                      </div>
                      <p className="mt-3 text-[10px] leading-5 text-muted">
                        二维码在浏览器本地生成，验证器密钥不会发送给第三方二维码服务。
                      </p>
                      {secret ? (
                        <div className="mt-3 border-t border-hairline pt-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="type-eyebrow">MANUAL KEY</p>
                            <button
                              type="button"
                              onClick={() => void copyText("secret", secret)}
                              className="inline-flex items-center gap-1 text-[10px] text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ink"
                            >
                              {copied === "secret" ? (
                                <Check aria-hidden="true" className="size-3" />
                              ) : (
                                <Copy aria-hidden="true" className="size-3" />
                              )}
                              {copied === "secret" ? "已复制" : "复制"}
                            </button>
                          </div>
                          <p className="mt-1.5 break-all font-mono text-[10px] leading-4 text-body">
                            {secret}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-4">
                      <BackupCodesPanel
                        codes={enrollment.backupCodes}
                        copied={copied === "codes"}
                        onCopy={() => void copyText("codes", enrollment.backupCodes.join("\n"))}
                      />

                      {enrollmentVerified ? (
                        <div className="rounded-control border border-accent-green/20 bg-accent-green/5 p-4">
                          <div className="flex items-center gap-2 text-accent-green">
                            <ShieldCheck aria-hidden="true" className="size-4" />
                            <p className="text-[12px] font-medium">已启用并验证</p>
                          </div>
                          <p className="mt-1.5 text-[11px] leading-5 text-muted">
                            请先离线保存上方备用码，再关闭此面板。备用码之后不会再次完整显示。
                          </p>
                          <Button
                            className="mt-3"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setPanel("none");
                              setEnrollment(null);
                              setEnrollmentVerified(false);
                              resetMessages();
                            }}
                          >
                            我已安全保存备用码
                          </Button>
                        </div>
                      ) : (
                        <form
                          onSubmit={verifyEnrollment}
                          className="rounded-control border border-hairline-strong bg-surface-1 p-4"
                        >
                          <p className="type-eyebrow">STEP 2 / VERIFY CODE</p>
                          <h3 className="mt-1 text-sm font-medium text-ink">
                            输入验证器中的 6 位数字
                          </h3>
                          <div className="mt-3">
                            <FormField
                              id="security-enrollment-totp"
                              label="验证器验证码"
                              required
                              hint="验证成功后才会启用两步验证。"
                            >
                              <Input
                                autoComplete="one-time-code"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={6}
                                autoFocus
                                value={code}
                                onChange={(event) =>
                                  setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))
                                }
                                placeholder="000000"
                                className="text-center font-mono text-lg tracking-[0.4em]"
                              />
                            </FormField>
                          </div>
                          {error ? (
                            <p role="alert" className="mt-3 text-xs leading-5 text-accent-red">
                              {error}
                            </p>
                          ) : null}
                          <Button
                            type="submit"
                            variant="primary"
                            className="mt-4 w-full"
                            disabled={busy || code.length !== 6}
                          >
                            <ShieldCheck aria-hidden="true" />
                            {busy ? "正在验证…" : "验证并启用两步验证"}
                          </Button>
                        </form>
                      )}
                    </div>
                  </div>
                ) : null}

                {panel === "disable" ? (
                  <form onSubmit={disable} className="max-w-md space-y-4">
                    <div>
                      <p className="type-eyebrow">DISABLE / VERIFY FIRST</p>
                      <h3 className="mt-1 text-sm font-medium text-ink">关闭前验证密码和动态码</h3>
                      <p className="mt-1 text-[11px] leading-5 text-muted">
                        关闭后所有备用码立即失效。若验证码连续错误，账号会临时锁定。
                      </p>
                    </div>
                    <FormField id="security-disable-password" label="当前密码" required>
                      <Input
                        autoComplete="current-password"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.currentTarget.value)}
                      />
                    </FormField>
                    <FormField id="security-disable-totp" label="验证器 6 位验证码" required>
                      <Input
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        value={code}
                        onChange={(event) =>
                          setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))
                        }
                        placeholder="000000"
                        className="text-center font-mono text-lg tracking-[0.4em]"
                      />
                    </FormField>
                    {error ? (
                      <p role="alert" className="text-xs leading-5 text-accent-red">
                        {error}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" variant="danger" disabled={busy || code.length !== 6}>
                        <ShieldOff aria-hidden="true" />
                        {busy ? "正在关闭…" : "确认关闭两步验证"}
                      </Button>
                      <Button type="button" variant="ghost" onClick={closePanel}>
                        取消
                      </Button>
                    </div>
                  </form>
                ) : null}

                {panel === "regenerate" ? (
                  <div className="max-w-xl space-y-4">
                    {newBackupCodes ? (
                      <>
                        <BackupCodesPanel
                          codes={newBackupCodes}
                          copied={copied === "codes"}
                          onCopy={() => void copyText("codes", newBackupCodes.join("\n"))}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setNewBackupCodes(null);
                            setPanel("none");
                            resetMessages();
                          }}
                        >
                          我已安全保存新备用码
                        </Button>
                      </>
                    ) : (
                      <form onSubmit={regenerateBackupCodes} className="space-y-4">
                        <div>
                          <p className="type-eyebrow">REGENERATE / REPLACE ALL</p>
                          <h3 className="mt-1 text-sm font-medium text-ink">生成一组新的备用码</h3>
                          <p className="mt-1 text-[11px] leading-5 text-muted">
                            新备用码会替换旧备用码。确认当前密码后生成，并立即离线保存。
                          </p>
                        </div>
                        <FormField id="security-regenerate-password" label="当前密码" required>
                          <Input
                            autoComplete="current-password"
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.currentTarget.value)}
                          />
                        </FormField>
                        {error ? (
                          <p role="alert" className="text-xs leading-5 text-accent-red">
                            {error}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Button type="submit" variant="primary" disabled={busy}>
                            <RefreshCw aria-hidden="true" />
                            {busy ? "正在生成…" : "替换备用码"}
                          </Button>
                          <Button type="button" variant="ghost" onClick={closePanel}>
                            取消
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="surface-card p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-hairline bg-surface-2 text-body">
                  <KeyRound aria-hidden="true" className="size-4" />
                </span>
                <div>
                  <p className="type-eyebrow">RECOVERY / ONE-TIME CODES</p>
                  <h2 className="mt-1 font-serif text-2xl tracking-[-0.02em] text-ink">
                    备用码与恢复
                  </h2>
                  <p className="mt-2 text-[11px] leading-5 text-muted">
                    在登录验证页切换到「备用码」，输入一组尚未使用的备用码即可登录。成功使用后，该码立即失效，不能再次使用。
                  </p>
                  <p className="mt-2 text-[11px] leading-5 text-muted">
                    页面不会显示备用码的剩余数量，只显示本次生成的这一组。如果不确定还剩多少，请重新生成一组并替换旧码。
                  </p>
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-6">
            <section className="surface-card p-5">
              <p className="type-eyebrow">ACCOUNT</p>
              <h2 className="mt-1 font-serif text-2xl tracking-[-0.02em] text-ink">当前账号</h2>
              <div className="mt-4 space-y-3">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
                    EMAIL
                  </p>
                  <p className="mt-1 break-all text-[12px] text-ink">{session?.email ?? "—"}</p>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
                    两步验证
                  </p>
                  <p className={`mt-1 text-[12px] ${enabled ? "text-accent-green" : "text-muted"}`}>
                    {enabled ? "已启用 · 验证器" : "未启用"}
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-stone">
                    登录状态
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-body">
                    已安全登录
                  </p>
                </div>
              </div>
            </section>

            <section className="surface-card p-5">
              <div className="flex items-center gap-2">
                <LockKeyhole aria-hidden="true" className="size-3.5 text-muted" />
                <p className="type-eyebrow">LOCKOUT</p>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                连续输错验证码会触发临时锁定。尝试过于频繁时请停止重试，等待约 15
                分钟，或改用未使用的备用码。
              </p>
            </section>

            <section className="surface-card p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck aria-hidden="true" className="size-3.5 text-accent-green" />
                <p className="type-eyebrow">PRIVACY</p>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                二维码、验证器密钥和备用码只在当前页面中处理，不会上传到二维码服务，也不会保存在浏览器本地。
              </p>
            </section>
          </aside>
        </div>
      )}
    </SecurityFrame>
  );
}

function SecurityFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-canvas">
      <PageGlow accent="green" className="opacity-60" />
      <div className="relative mx-auto max-w-[1180px] px-5 py-6 sm:px-8 lg:px-10 lg:py-8">
        <header className="flex items-center justify-between gap-4">
          <a
            href="/"
            className="inline-flex items-baseline gap-2 outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-4 focus-visible:ring-offset-canvas"
          >
            <span className="font-serif text-[25px] leading-none tracking-[-0.03em] text-ink">
              Roamlog
            </span>
            <span className="type-eyebrow text-[8px]">account security</span>
          </a>
          <Badge tone="neutral">ACCOUNT SECURITY</Badge>
        </header>
        <div className="mt-10">{children}</div>
      </div>
    </main>
  );
}

function EnabledSummary({ enabled, onRegenerate }: { enabled: boolean; onRegenerate: () => void }) {
  if (!enabled) {
    return (
      <div className="rounded-control border border-hairline bg-black/20 p-4">
        <p className="text-[12px] text-ink">两步验证当前未启用</p>
        <p className="mt-1 text-[11px] leading-5 text-muted">
          打开开关，确认当前密码后生成验证器密钥与备用码。完成 6 位验证码验证后才会启用。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-control border border-accent-green/20 bg-accent-green/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-[12px] font-medium text-accent-green">两步验证已启用</p>
        <p className="mt-1 text-[11px] leading-5 text-muted">
          登录时会要求输入验证码。备用码使用一次后立即失效；如无剩余码，请生成新的一组。
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRegenerate}>
        <RefreshCw aria-hidden="true" />
        重新生成备用码
      </Button>
    </div>
  );
}

function BackupCodesPanel({
  codes,
  copied,
  onCopy,
}: {
  codes: string[];
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-control border border-hairline bg-black/20 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="type-eyebrow">BACKUP CODES</p>
          <h3 className="mt-1 text-sm font-medium text-ink">剩余备用码（本次生成）</h3>
          <p className="mt-1 text-[10px] leading-5 text-muted">
            本组共 {codes.length} 个，只在当前页面显示。每个码只能成功使用一次。
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onCopy} disabled={codes.length === 0}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "已复制" : "复制全部"}
        </Button>
      </div>
      {codes.length > 0 ? (
        <ul className="mt-3 grid grid-cols-1 gap-2 font-mono text-[11px] text-body sm:grid-cols-2">
          {codes.map((backupCode) => (
            <li
              key={backupCode}
              className="rounded-control border border-hairline px-2.5 py-2 tracking-[0.08em]"
            >
              {backupCode}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-control border border-accent-red/20 bg-accent-red/5 px-3 py-2 text-[11px] text-accent-red">
          没有获取到备用码。请完成验证后重新生成。
        </p>
      )}
    </div>
  );
}
