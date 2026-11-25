"use client";

import { Button, FormField, Input } from "@roamlog/ui";
import { ArrowRight, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { authErrorMessage, signUp } from "@/lib/api/auth";
import { validateEmail, validatePassword, validateRequired } from "@/lib/validation";

interface RegisterErrors {
  name?: string;
  email?: string;
  password?: string;
}

export function RegisterForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = {
      name: validateRequired(name, "请输入你的名字"),
      email: validateEmail(email),
      password: validatePassword(password),
    };

    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.email || nextErrors.password) {
      setNotice(null);
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await signUp(name.trim(), email.trim(), password);
      setNotice("账号已创建。请检查邮箱完成验证，然后返回登录。");
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="type-eyebrow">开始使用</p>
      <h1 className="mt-2 font-display text-[clamp(1.75rem,1.5rem+0.7vw,2.25rem)] leading-tight font-semibold tracking-[-0.02em] text-ink">
        创建账号
      </h1>
      <p className="mt-4 text-sm leading-6 text-muted">
        注册后会发送验证邮件。完成邮箱验证后，即可创建工作区或接受邀请。
      </p>

      <form noValidate onSubmit={handleSubmit} className="mt-8 space-y-5">
        <FormField label="名字" error={errors.name}>
          <Input
            name="name"
            autoComplete="name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (errors.name) setErrors((current) => ({ ...current, name: undefined }));
            }}
            placeholder="你的显示名称"
          />
        </FormField>
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
        <FormField
          label="密码"
          error={errors.password}
          hint="至少 8 位。"
        >
          <Input
            type="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (errors.password) {
                setErrors((current) => ({ ...current, password: undefined }));
              }
            }}
            placeholder="至少 8 位"
          />
        </FormField>

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
          <UserPlus aria-hidden="true" />
          {submitting ? "正在创建…" : "创建账号"}
          <ArrowRight aria-hidden="true" />
        </Button>
      </form>

      <p className="mt-6 text-center text-xs text-muted">
        已有账号？{" "}
        <a href="/login" className="text-ink underline-offset-4 hover:underline">
          返回登录
        </a>
      </p>
    </div>
  );
}
