"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Select,
  Textarea,
} from "@roamlog/ui";
import { Mail } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { InvitationInput } from "@/lib/api/types";

import { inviteErrorMessage } from "./invite-errors";

const ERROR_ID = "invite-member-error";

export interface InviteMemberDialogProps {
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onInvite: (input: InvitationInput) => Promise<void>;
}

/**
 * Invitation errors belong to the dialog's form state, not the page behind the
 * Radix overlay. Keeping the fields mounted after a failed request also lets
 * the person correct or retry without re-entering the invite.
 */
export function InviteMemberDialog({
  open,
  pending,
  onOpenChange,
  onInvite,
}: InviteMemberDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitationInput["role"]>("editor");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  const busy = pending || submitting;

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function reset() {
    setEmail("");
    setRole("editor");
    setMessage("");
    setError(null);
  }

  useEffect(() => {
    if (wasOpen.current && !open) {
      setEmail("");
      setRole("editor");
      setMessage("");
      setError(null);
    }
    wasOpen.current = open;
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    else setError(null);
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError("请输入邀请成员的邮箱。");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onInvite({
        email: normalizedEmail,
        role,
        ...(message.trim() ? { message: message.trim() } : {}),
      });
    } catch (cause) {
      setError(inviteErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form
          aria-describedby={error ? ERROR_ID : undefined}
          className="space-y-4"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <DialogHeader>
            <DialogTitle>邀请成员</DialogTitle>
            <DialogDescription>
              邀请会发送到邮箱。对方需要先登录，然后接受邀请进入工作区。
            </DialogDescription>
          </DialogHeader>
          <FormField
            error={error && !email.trim() ? error : undefined}
            id="invite-member-email"
            label="邮箱"
            required
          >
            <Input
              aria-invalid={Boolean(error)}
              autoComplete="email"
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError(null);
              }}
              placeholder="traveler@example.com"
              type="email"
              value={email}
            />
          </FormField>
          <FormField id="invite-member-role" label="角色">
            <Select
              onChange={(event) => setRole(event.target.value as InvitationInput["role"])}
              value={role}
            >
              <option value="admin">管理员</option>
              <option value="editor">编辑者</option>
              <option value="viewer">只读成员</option>
            </Select>
          </FormField>
          <FormField id="invite-member-message" label="留言（可选）">
            <Textarea
              maxLength={1000}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="一起补上这趟旅行的日志吧。"
              rows={3}
              value={message}
            />
          </FormField>
          {error ? (
            <div
              className="rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2 text-xs leading-5 text-accent-red outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              data-testid="invite-member-error"
              id={ERROR_ID}
              ref={errorRef}
              role="alert"
              tabIndex={-1}
            >
              {error}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              <Mail aria-hidden="true" />
              {busy ? "发送中…" : "发送邀请"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
