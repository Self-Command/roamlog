"use client";

import { Button, FormField, Input } from "@roamlog/ui";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";

import { authErrorMessage, signIn } from "@/lib/api/auth";
import { useDataMode } from "@/lib/data-provider";
import { validateEmail, validatePassword } from "@/lib/validation";

interface LoginErrors {
  email?: string;
  password?: string;
}

export function LoginFormView() {
  const mode = useDataMode();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<LoginErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

    if (mode === "mock") {
      setNotice("表单校验通过。真实认证将在身份后端接入后启用。");
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await signIn(email.trim(), password);
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.assign(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (cause) {
      setError(authErrorMessage(cause));
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <p className="type-eyebrow">WELCOME BACK</p>
        <h1 className="mt-3 font-serif text-[clamp(2rem,1.5rem+1vw,2.75rem)] leading-none tracking-[-0.035em] text-ink">
          回到你的旅行档案
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted">
          {mode === "api"
            ? "登录后会进入 Workspace 总览。会话由 Better Auth 的 httpOnly cookie 维护。"
            : "登录后会进入 Workspace 总览。当前是 mock 预览，不会发起真实认证请求。"}
        </p>
      </div>

      <form noValidate onSubmit={handleSubmit} className="space-y-5">
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
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-stone">
            <LockKeyhole aria-hidden="true" className="size-3" />
            httpOnly session
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

        <Button type="submit" variant="primary" size="lg" className="w-full" disabled={submitting}>
          <Mail aria-hidden="true" />
          {submitting ? "正在登录…" : "登录"}
          <ArrowRight aria-hidden="true" />
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-muted">
        还没有账号？{" "}
        <a href="/register" className="text-ink underline-offset-4 hover:underline">
          创建旅行档案
        </a>
      </p>
    </div>
  );
}
