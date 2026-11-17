"use client";

import { Button, FormField, Input } from "@roamlog/ui";
import { ArrowRight, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";

import { validateEmail } from "@/lib/validation";

interface EmailLinkFormProps {
  submitLabel: string;
  successMessage: string;
  defaultValue?: string;
}

export function EmailLinkForm({
  submitLabel,
  successMessage,
  defaultValue = "",
}: EmailLinkFormProps) {
  const [email, setEmail] = useState(defaultValue);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextError = validateEmail(email);
    setError(nextError);
    setSent(!nextError);
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

      <Button type="submit" variant="primary" size="lg" className="w-full">
        <Mail aria-hidden="true" />
        {submitLabel}
        <ArrowRight aria-hidden="true" />
      </Button>
    </form>
  );
}
