"use client";

import { Button, FormField, Input } from "@roamlog/ui";
import { ArrowRight, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";

import { authErrorMessage, resetPassword } from "@/lib/api/auth";
import { useDataMode } from "@/lib/data-provider";
import { validatePassword } from "@/lib/validation";

interface ResetErrors {
  password?: string;
  confirmation?: string;
}

export function ResetPasswordForm({ token }: { token?: string }) {
  const mode = useDataMode();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<ResetErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: ResetErrors = {
      password: validatePassword(password),
      confirmation:
        confirmation.length === 0
          ? "请再次输入密码"
          : confirmation !== password
            ? "两次输入的密码不一致"
            : undefined,
    };

    setErrors(nextErrors);
    if (nextErrors.password || nextErrors.confirmation) {
      setNotice(null);
      return;
    }

    if (mode === "mock") {
      setNotice("重置表单已通过本地校验。真实密码更新将在身份后端接入后启用。");
      return;
    }

    if (!token) {
      setError("重置链接缺少 token。请重新发送重置邮件。");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setNotice("密码已更新，正在返回登录页…");
      window.setTimeout(() => window.location.assign("/login?reset=1"), 800);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5">
      <FormField label="新密码" error={errors.password}>
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
      <FormField label="再次输入" error={errors.confirmation}>
        <Input
          type="password"
          name="confirmation"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => {
            setConfirmation(event.target.value);
            if (errors.confirmation) {
              setErrors((current) => ({ ...current, confirmation: undefined }));
            }
          }}
          placeholder="再次输入新密码"
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
        <KeyRound aria-hidden="true" />
        {submitting ? "正在更新…" : "更新密码"}
        <ArrowRight aria-hidden="true" />
      </Button>
    </form>
  );
}
