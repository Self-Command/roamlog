"use client";

import { ArrowLeft, Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Badge, Button, FormField, Input, Separator, useHydrated } from "@roamlog/ui";

import {
  authErrorMessage,
  generatedAdminAuthTransport,
  type AdminAuthTransport,
} from "../../lib/admin-auth";
import { getAdminPostLoginPath } from "../../lib/admin-paths";
import { PLATFORM_ROLE_LABELS } from "../../lib/labels";

interface LoginPanelProps {
  onAuthenticated?: () => void;
  transport?: AdminAuthTransport;
}

const ADMIN_DEMO_EMAIL = "demo@roamlog.local";

function resolvePostLoginPath(): string {
  if (typeof window === "undefined") {
    return getAdminPostLoginPath();
  }
  const returnTo = new URLSearchParams(window.location.search).get("returnTo");
  return getAdminPostLoginPath(returnTo);
}

export function LoginPanel({ onAuthenticated, transport }: LoginPanelProps) {
  const auth = transport ?? generatedAdminAuthTransport;
  // Explicit opt-in only: `NEXT_PUBLIC_ADMIN_DEMO=1` prefills a labelled demo
  // address. Production builds never prefill any stored account.
  const demoEnabled = process.env.NEXT_PUBLIC_ADMIN_DEMO === "1";
  const [step, setStep] = useState<"credentials" | "two-factor">("credentials");
  const [email, setEmail] = useState(() => (demoEnabled ? ADMIN_DEMO_EMAIL : ""));
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hydrated = useHydrated();

  function completeAuthentication() {
    if (onAuthenticated) {
      onAuthenticated();
      return;
    }
    window.location.assign(resolvePostLoginPath());
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-canvas">
      <div className="relative mx-auto grid min-h-dvh w-full max-w-[1320px] lg:grid-cols-[minmax(0,1fr)_390px]">
        <section className="flex min-h-dvh flex-col px-5 py-6 sm:px-10 lg:px-14 lg:py-10">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-control border border-hairline-strong bg-surface-1 text-ink">
                <Fingerprint aria-hidden="true" className="size-4" />
              </span>
              <div>
                <p className="font-display text-lg font-semibold leading-none tracking-[-0.02em] text-ink">
                  Roamlog
                </p>
                <p className="mt-1 font-ui text-[9px] font-medium tracking-[0.08em] text-muted">
                  平台控制
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {demoEnabled ? <Badge tone="orange">演示模式</Badge> : null}
              <Badge tone="green">安全认证</Badge>
            </div>
          </header>

          <div className="flex flex-1 items-center py-12">
            <div className="w-full max-w-[420px]">
              <p className="type-eyebrow">受限 / 管理员</p>
              <h1 className="mt-3 font-display text-[36px] font-semibold leading-10 tracking-[-0.025em] text-ink">
                {step === "credentials" ? "进入平台控制台" : "两步验证"}
              </h1>
              <p className="mt-4 max-w-sm text-[13px] leading-6 text-muted">
                {step === "credentials"
                  ? "访问用户、工作区、审计和运营工具。所有后台操作均按平台角色与审计规则约束。"
                  : "请输入身份验证器中的 6 位验证码。"}
              </p>

              <Separator className="my-7" />

              {step === "credentials" ? (
                <form
                  className="space-y-4"
                  method="post"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!email.trim() || !password.trim()) {
                      setMessage("请输入管理员邮箱和密码。");
                      return;
                    }
                    setMessage("");
                    setIsSubmitting(true);
                    try {
                      const response = await auth.signIn({
                        email: email.trim(),
                        password,
                      });
                      if (response.status >= 400) {
                        setMessage(authErrorMessage(response));
                        return;
                      }
                      if (response.data.twoFactorRedirect === true) {
                        setStep("two-factor");
                      } else {
                        completeAuthentication();
                      }
                    } catch (error) {
                      setMessage(
                        error instanceof Error ? error.message : "无法连接认证服务，请稍后重试。",
                      );
                    } finally {
                      setIsSubmitting(false);
                    }
                  }}
                >
                  <FormField
                    id="admin-email"
                    label="管理员邮箱"
                    required
                    hint={demoEnabled ? "演示模式：已填入示例账号，请勿用于生产。" : undefined}
                  >
                    <Input
                      autoComplete="username"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.currentTarget.value)}
                      placeholder="admin@roamlog.app"
                    />
                  </FormField>
                  <FormField
                    id="admin-password"
                    label="密码"
                    required
                    hint="密码只用于本次登录，不会被保存到浏览器草稿。"
                  >
                    <Input
                      autoComplete="current-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.currentTarget.value)}
                      placeholder="输入账户密码"
                    />
                  </FormField>

                  {message ? (
                    <p role="alert" className="text-xs leading-5 text-accent-red">
                      {message}
                    </p>
                  ) : null}

                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full"
                    disabled={!hydrated || isSubmitting}
                  >
                    <KeyRound aria-hidden="true" />
                    {isSubmitting ? "正在登录…" : "登录"}
                  </Button>
                  <a
                    href="/admin/2fa/enroll"
                    className="block rounded-control text-center text-[11px] text-muted underline-offset-4 outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    已登录但尚未完成两步验证？
                  </a>
                </form>
              ) : (
                <form
                  className="space-y-4"
                  method="post"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!/^\d{6}$/.test(code)) {
                      setMessage("请输入 6 位数字验证码。");
                      return;
                    }
                    setMessage("");
                    setIsSubmitting(true);
                    try {
                      const response = await auth.verifyTotp(code);
                      if (response.status >= 400) {
                        setMessage(authErrorMessage(response));
                        return;
                      }
                      completeAuthentication();
                    } catch (error) {
                      setMessage(
                        error instanceof Error ? error.message : "无法连接认证服务，请稍后重试。",
                      );
                    } finally {
                      setIsSubmitting(false);
                    }
                  }}
                >
                  <div className="rounded-control border border-hairline-strong bg-surface-1 p-3">
                    <p className="type-eyebrow">验证对象</p>
                    <p className="mt-1.5 truncate text-[13px] text-ink">{email}</p>
                  </div>
                  <FormField
                    id="admin-totp"
                    label="6 位验证码"
                    required
                    hint="输入验证器中的动态验证码。"
                  >
                    <Input
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={code}
                      onChange={(event) =>
                        setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))
                      }
                      placeholder="000000"
                      className="text-center font-mono text-lg tracking-[0.4em]"
                    />
                  </FormField>

                  {message ? (
                    <p role="alert" className="text-xs leading-5 text-accent-red">
                      {message}
                    </p>
                  ) : null}

                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full"
                    disabled={!hydrated || code.length !== 6 || isSubmitting}
                  >
                    <ShieldCheck aria-hidden="true" />
                    {isSubmitting ? "正在验证…" : "验证并进入控制台"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => {
                      setStep("credentials");
                      setCode("");
                      setMessage("");
                    }}
                  >
                    <ArrowLeft aria-hidden="true" />
                    更换账户
                  </Button>
                </form>
              )}
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-4">
            <p className="font-ui text-[10px] tracking-[0.04em] text-muted">统一认证 · 同源接入</p>
            <p className="font-ui text-[10px] text-stone">独立管理应用</p>
          </footer>
        </section>

        <aside className="hidden border-l border-hairline bg-surface-deep px-7 py-10 lg:flex lg:flex-col">
          <div className="flex items-center justify-between">
            <p className="type-eyebrow">访问边界</p>
            <Badge tone="green">需要两步验证</Badge>
          </div>
          <h2 className="mt-4 font-display text-2xl font-semibold leading-8 tracking-[-0.02em] text-ink">
            为运营操作保留证据
          </h2>
          <p className="mt-3 text-[12px] leading-6 text-muted">
            后台与用户端是独立应用。暂停、删除、角色变更和队列操作必须经过确认并写入审计日志。
          </p>

          <div className="mt-8 divide-y divide-hairline border-y border-hairline">
            {[
              [PLATFORM_ROLE_LABELS.support, "查看用户/工作区；暂停、恢复、重发邮件"],
              [PLATFORM_ROLE_LABELS.analyst, "只读指标、审计和队列；可导出审计 CSV"],
              [PLATFORM_ROLE_LABELS.admin, "运营删除/恢复、重置两步验证、队列重试"],
              [PLATFORM_ROLE_LABELS.super_admin, "平台角色、功能开关、队列管理"],
            ].map(([role, capability]) => (
              <div key={role} className="py-4">
                <div className="flex items-center gap-2">
                  <ShieldCheck aria-hidden="true" className="size-3.5 text-muted" />
                  <h3 className="text-[12px] font-medium text-ink">{role}</h3>
                </div>
                <p className="mt-1.5 text-[11px] leading-5 text-muted">{capability}</p>
              </div>
            ))}
          </div>

          <div className="mt-auto rounded-card border border-hairline-strong bg-surface-1 p-4">
            <p className="type-eyebrow">环境</p>
            <div className="mt-3 space-y-2 font-mono text-[9px] text-muted">
              <div className="flex justify-between gap-3">
                <span>后台服务</span>
                <span className="text-accent-green">同源代理</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>审计写入</span>
                <span className="text-ink">自动记录</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
