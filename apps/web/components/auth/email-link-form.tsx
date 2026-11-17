"use client";

import { Button, FormField, Input } from "@roamlog/ui";
import { ArrowRight, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";

import {
  authErrorMessage,
  requestPasswordReset,
  sendVerificationEmail,
} from "@/lib/api/auth";
import { useDataMode } from "@/lib/data-provider";
import { validateEmail } from "@/lib/validation";

interface EmailLinkFormProps {
  submitLabel: string;
  successMessage: string;
  defaultValue?: string;
  intent?: "reset" | "verify";
}

export function EmailLinkForm({
  submitLabel,
  successMessage,
  defaultValue = "",
  intent = "reset",
}: EmailLinkFormProps) {
  const mode = useDataMode();
  const [email, setEmail] = useState(defaultValue);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextError = validateEmail(email);
    setError(nextError);
    if (nextError) return;

    if (mode === "mock") {
      setSent(true);
      return;
    }

    setSubmitting(true);
    setRequestError(null);
    try {
      if (intent === "verify") {
        await sendVerificationEmail(email.trim());
      } else {
        await requestPasswordReset(email.trim());
      }
      setSent(true);
    } catch (cause) {
      setRequestError(authErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5">
      <FormField label="邮箱" error={error}>
        <Input
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            if (error) setError(undefined);
            if (sent) setSent(false);
          }}
          placeholder="you@example.com"
        />
      </FormField>

      {sent ? (
        <p
          role="status"
          className="rounded-control border border-accent-blue/20 bg-accent-blue/5 px-3 py-2.5 text-xs leading-5 text-accent-blue"
        >
          {successMessage}
        </p>
      ) : null}

      {requestError ? (
        <p
          role="alert"
          className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2.5 text-xs leading-5 text-accent-red"
        >
          {requestError}
        </p>
      ) : null}

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={submitting}>
        <Mail aria-hidden="true" />
        {submitting ? "正在发送…" : submitLabel}
        <ArrowRight aria-hidden="true" />
      </Button>
    </form>
  );
}
