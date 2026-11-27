"use client";

import {
  Button,
  FormField,
  HydrationSafeForm,
  HydrationSafeSubmitButton,
  Input,
} from "@roamlog/ui";
import { ArrowLeft, ArrowRight, KeyRound, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

import { ApiError } from "@/lib/api";
import {
  authErrorMessage,
  twoFactorAuthTransport,
  twoFactorErrorMessage,
  type SignInResult,
  type TwoFactorAuthTransport,
} from "@/lib/api/auth";
import { validateEmail, validatePassword } from "@/lib/validation";

interface LoginErrors {
  email?: string;
  password?: string;
}

const DEFAULT_LOGIN_TAGLINE = "登录后进入你的旅行总览，行程与日志会留在同一个工作区。";

type LoginStep = "credentials" | "challenge";
type ChallengeFactor = "totp" | "backup-code";

interface LoginFormViewProps {
  auth?: TwoFactorAuthTransport;
  onAuthenticated?: () => void;
  /** Runtime `theme.loginTagline`; blank falls back to the built-in copy. */
  tagline?: string;
}

export function LoginFormView({
  auth = twoFactorAuthTransport,
  onAuthenticated,
  tagline,
}: LoginFormViewProps) {
  const [step, setStep] = useState<LoginStep>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challengeEmail, setChallengeEmail] = useState("");
  const [factor, setFactor] = useState<ChallengeFactor>("totp");
  const [totpCode, setTotpCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  function completeAuthentication() {
    if (onAuthenticated) {
      onAuthenticated();
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.assign(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: LoginErrors = {
      email: validateEmail(email),
      password: validatePassword(password),
    };

    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) {
      setNotice(null);
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const result: SignInResult = await auth.signIn(email.trim(), password);
      if (result.twoFactorRedirect) {
        setChallengeEmail(email.trim());
        setTotpCode("");
        setBackupCode("");
        setChallengeError(null);
        setFailedAttempts(0);
        setFactor("totp");
        setStep("challenge");
      } else {
        completeAuthentication();
      }
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = factor === "totp" ? totpCode : backupCode.trim();
    if (factor === "totp" && !/^\d{6}$/.test(value)) {
      setChallengeError("请输入验证器中的 6 位数字验证码。");
      return;
    }
    if (factor === "backup-code" && !value) {
      setChallengeError("请输入一个尚未使用的备用码。");
      return;
    }

    setSubmitting(true);
    setChallengeError(null);
    try {
      if (factor === "totp") {
        await auth.verifyTotp(value);
      } else {
        await auth.verifyBackupCode(value);
      }
      completeAuthentication();
    } catch (cause) {
      setChallengeError(twoFactorErrorMessage(cause));
      if (cause instanceof ApiError && cause.status === 401) {
        setFailedAttempts((current) => current + 1);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resetChallenge() {
    setStep("credentials");
    setPassword("");
    setTotpCode("");
    setBackupCode("");
    setChallengeError(null);
    setFailedAttempts(0);
    setFactor("totp");
  }

  if (step === "challenge") {
    return (
      <div>
        <div className="mb-8">
          <p className="type-eyebrow">安全验证</p>
          <h1 className="mt-2 font-display text-[clamp(1.75rem,1.5rem+0.7vw,2.25rem)] leading-tight font-semibold tracking-[-0.02em] text-ink">
            再确认一次是你
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted">
            密码已验证。输入验证器中的动态验证码，或使用一个一次性备用码完成登录。
          </p>
        </div>

        <div className="mb-5 rounded-control border border-hairline-strong bg-surface-1 p-3">
          <p className="type-eyebrow">正在验证</p>
          <p className="mt-1.5 break-all text-[13px] text-ink">{challengeEmail}</p>
        </div>

        <HydrationSafeForm onSubmit={handleChallenge} className="space-y-5">
          <div
            role="group"
            aria-label="选择验证方式"
            className="grid grid-cols-2 gap-1 rounded-control border border-hairline-strong bg-surface-1 p-1"
          >
            <button
              type="button"
              aria-pressed={factor === "totp"}
              onClick={() => {
                setFactor("totp");
                setChallengeError(null);
              }}
              className={`flex h-9 items-center justify-center gap-1.5 rounded-[6px] text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                factor === "totp" ? "bg-ink text-black" : "text-muted hover:text-ink"
              }`}
            >
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              验证器
            </button>
            <button
              type="button"
              aria-pressed={factor === "backup-code"}
              onClick={() => {
                setFactor("backup-code");
                setChallengeError(null);
              }}
              className={`flex h-9 items-center justify-center gap-1.5 rounded-[6px] text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                factor === "backup-code" ? "bg-ink text-black" : "text-muted hover:text-ink"
              }`}
            >
              <KeyRound aria-hidden="true" className="size-3.5" />
              备用码
            </button>
          </div>

          {factor === "totp" ? (
            <FormField
              id="login-totp"
              label="验证器 6 位验证码"
              required
              hint="验证码每 30 秒刷新。连续输错会触发临时锁定。"
            >
              <Input
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoFocus
                value={totpCode}
                onChange={(event) =>
                  setTotpCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="000000"
                className="text-center font-mono text-lg tracking-[0.4em]"
              />
            </FormField>
          ) : (
            <FormField
              id="login-backup-code"
              label="一次性备用码"
              required
              hint="格式类似 abcde-12345。每个备用码只能成功使用一次，请勿复用。"
            >
              <Input
                autoComplete="off"
                spellCheck={false}
                autoFocus
                value={backupCode}
                onChange={(event) => setBackupCode(event.currentTarget.value)}
                placeholder="xxxxx-xxxxx"
                className="text-center font-mono tracking-[0.16em]"
              />
            </FormField>
          )}

          {challengeError ? (
            <div
              role="alert"
              className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2.5 text-xs leading-5 text-accent-red"
            >
              <p>{challengeError}</p>
              {failedAttempts > 0 ? (
                <p className="mt-1 text-accent-red/80">
                  本次验证已失败 {failedAttempts} 次。请确认设备时间同步后再试。
                </p>
              ) : null}
            </div>
          ) : null}

          <HydrationSafeSubmitButton
            variant="primary"
            size="lg"
            className="w-full"
            disabled={
              submitting ||
              (factor === "totp" ? totpCode.length !== 6 : backupCode.trim().length === 0)
            }
          >
            <ShieldCheck aria-hidden="true" />
            {submitting ? "正在验证…" : "完成验证"}
            <ArrowRight aria-hidden="true" />
          </HydrationSafeSubmitButton>
          <Button type="button" variant="ghost" className="w-full" onClick={resetChallenge}>
            <ArrowLeft aria-hidden="true" />
            更换账户
          </Button>
        </HydrationSafeForm>

        <p className="mt-6 text-center text-xs leading-5 text-muted">
          找不到备用码？打开{" "}
          <a href="/settings/security" className="text-ink underline-offset-4 hover:underline">
            账号安全
          </a>{" "}
          查看说明或重新生成。
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <p className="type-eyebrow">欢迎回来</p>
        <h1 className="mt-2 font-display text-[clamp(1.75rem,1.5rem+0.7vw,2.25rem)] leading-tight font-semibold tracking-[-0.02em] text-ink">
          登录 Roamlog
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted">
          {tagline?.trim() ? tagline : DEFAULT_LOGIN_TAGLINE}
        </p>
      </div>

      <HydrationSafeForm noValidate onSubmit={handleSubmit} className="space-y-5">
        <FormField label="邮箱" error={errors.email}>
          <Input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (errors.email) setErrors((current) => ({ ...current, email: undefined }));
            }}
            placeholder="you@example.com"
          />
        </FormField>

        <FormField label="密码" error={errors.password}>
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (errors.password) setErrors((current) => ({ ...current, password: undefined }));
            }}
            placeholder="至少 8 位"
          />
        </FormField>

        <div className="flex items-center justify-between gap-4">
          <a
            href="/forgot-password"
            className="text-xs text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            忘记密码
          </a>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-stone">
            <LockKeyhole aria-hidden="true" className="size-3" />
            安全登录
          </span>
        </div>

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

        <HydrationSafeSubmitButton
          variant="primary"
          size="lg"
          className="w-full"
          disabled={submitting}
        >
          <Mail aria-hidden="true" />
          {submitting ? "正在登录…" : "登录"}
          <ArrowRight aria-hidden="true" />
        </HydrationSafeSubmitButton>
      </HydrationSafeForm>

      <p className="mt-6 text-center text-xs text-muted">
        还没有账号？{" "}
        <a href="/register" className="text-ink underline-offset-4 hover:underline">
          创建账号
        </a>
      </p>
      <p className="mt-3 text-center text-[11px] text-stone">
        <a href="/settings/security" className="underline-offset-4 hover:text-ink hover:underline">
          管理账号安全与两步验证
        </a>
      </p>
    </div>
  );
}
