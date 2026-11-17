"use client";

import { Button, FormField, Input } from "@roamlog/ui";
import { ArrowRight, KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";

import { validatePassword } from "@/lib/validation";

interface ResetErrors {
  password?: string;
  confirmation?: string;
}

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errors, setErrors] = useState<ResetErrors>({});
  const [notice, setNotice] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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

    setNotice("重置表单已通过本地校验。真实密码更新将在身份后端接入后启用。");
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

      <Button type="submit" variant="primary" size="lg" className="w-full">
        <KeyRound aria-hidden="true" />
        更新密码
        <ArrowRight aria-hidden="true" />
      </Button>
    </form>
  );
}
