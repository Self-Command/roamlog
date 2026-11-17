"use client";

import { ArrowLeft, Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Badge, Button, FormField, Input, Separator } from "@roamlog/ui";

interface LoginPanelProps {
  onAuthenticated?: () => void;
}

export function LoginPanel({ onAuthenticated }: LoginPanelProps) {
  const [step, setStep] = useState<"credentials" | "two-factor">("credentials");
  const [email, setEmail] = useState("lin.zhixia@roamlog.local");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  function completeAuthentication() {
    if (onAuthenticated) {
      onAuthenticated();
      return;
    }
    window.location.assign("/admin");
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-canvas">
      <div className="admin-login-glow pointer-events-none absolute inset-x-0 top-0 h-[460px]" />
      <div className="relative mx-auto grid min-h-dvh w-full max-w-[1320px] lg:grid-cols-[minmax(0,1fr)_390px]">
        <section className="flex min-h-dvh flex-col px-5 py-6 sm:px-10 lg:px-14 lg:py-10">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-control border border-hairline-strong bg-surface-1 text-ink">
                <Fingerprint aria-hidden="true" className="size-4" />
              </span>
              <div>
                <p className="font-serif text-xl leading-none tracking-[-0.03em] text-ink">
                  Roamlog
                </p>
                <p className="type-eyebrow mt-1 text-[8px] text-ash">platform control</p>
              </div>
            </div>
            <Badge tone="neutral">LOGIN PLACEHOLDER</Badge>
          </header>

          <div className="flex flex-1 items-center py-12">
            <div className="w-full max-w-[420px]">
              <p className="type-eyebrow">RESTRICTED / ADMIN</p>
              <h1 className="mt-3 font-serif text-[clamp(2.35rem,1.9rem+1.4vw,3.25rem)] leading-[1.05] tracking-[-0.04em] text-ink">
                {step === "credentials" ? "进入平台控制台" : "双因素认证"}
              </h1>
              <p className="mt-4 max-w-sm text-[13px] leading-6 text-muted">
                {step === "credentials"
                  ? "访问用户、Workspace、审计和运营工具。所有后台操作均按平台角色与审计规则约束。"
                  : "输入 6 位 TOTP 验证码完成验证。当前为本地交互占位，不校验真实凭据。"}
              </p>

              <Separator className="my-7" />

              {step === "credentials" ? (
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!email.trim() || !password.trim()) {
                      setMessage("请输入管理员邮箱和密码。");
                      return;
                    }
                    setMessage("");
                    setStep("two-factor");
                  }}
                >
                  <FormField id="admin-email" label="管理员邮箱" required>
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
                    hint="占位表单不会创建 session，也不会发送网络请求。"
                  >
                    <Input
                      autoComplete="current-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.currentTarget.value)}
                      placeholder="输入任意本地占位密码"
                    />
                  </FormField>

                  {message ? (
                    <p role="alert" className="text-xs leading-5 text-accent-red">
                      {message}
                    </p>
                  ) : null}

                  <Button type="submit" variant="primary" className="w-full">
                    <KeyRound aria-hidden="true" />
                    继续验证
                  </Button>
                </form>
              ) : (
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!/^\d{6}$/.test(code)) {
                      setMessage("请输入 6 位数字验证码。");
                      return;
                    }
                    setMessage("");
                    completeAuthentication();
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
                    hint="本地占位：输入任意 6 位数字即可进入后台。"
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
                    disabled={code.length !== 6}
                  >
                    <ShieldCheck aria-hidden="true" />
                    进入控制台
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
            <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
              Better Auth placeholder / no real session
            </p>
            <p className="font-mono text-[9px] text-stone">ADMIN :3001</p>
          </footer>
        </section>

        <aside className="hidden border-l border-hairline bg-surface-deep px-7 py-10 lg:flex lg:flex-col">
          <div className="flex items-center justify-between">
            <p className="type-eyebrow">Access boundary</p>
            <Badge tone="green">2FA REQUIRED</Badge>
          </div>
          <h2 className="mt-4 font-serif text-3xl leading-tight tracking-[-0.035em] text-ink">
            为运营操作保留证据
          </h2>
          <p className="mt-3 text-[12px] leading-6 text-muted">
            后台与用户端是独立应用。暂停、删除、角色变更和队列操作必须经过确认并写入审计日志。
          </p>

          <div className="mt-8 divide-y divide-hairline border-y border-hairline">
            {[
              ["Support", "查看用户/Workspace；暂停、恢复、重发邮件"],
              ["Analyst", "只读指标、审计和队列；可导出审计 CSV"],
              ["Admin", "运营删除/恢复、2FA 重置、队列重试"],
              ["Super admin", "平台角色、功能开关、队列管理"],
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
            <p className="type-eyebrow">Environment</p>
            <div className="mt-3 space-y-2 font-mono text-[9px] text-muted">
              <div className="flex justify-between gap-3">
                <span>API</span>
                <span className="text-accent-yellow">NOT CONNECTED</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>MSW fixtures</span>
                <span className="text-ink">ADMIN LOCAL</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Audit writes</span>
                <span className="text-ink">MOCK ONLY</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
