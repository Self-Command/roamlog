"use client";

import { Badge, Button, Separator } from "@roamlog/ui";
import { Check, ShieldCheck, Users, X } from "lucide-react";
import { useState } from "react";

import { authErrorMessage } from "@/lib/api/auth";
import { useDataAdapter } from "@/lib/data-provider";

interface InviteAcceptProps {
  workspaceName: string;
  inviterName: string;
  role: "editor" | "viewer" | "admin";
  token?: string;
}

const roleDescriptions = {
  admin: "可以管理工作区成员、邀请和设置。",
  editor: "可以创建与编辑旅行、日志、照片和行程。",
  viewer: "可以阅读全部共享内容，并参与评论。",
} as const;

const roleLabels = {
  admin: "管理员",
  editor: "编辑者",
  viewer: "只读成员",
} as const;

export function InviteAccept({ workspaceName, inviterName, role, token }: InviteAcceptProps) {
  const adapter = useDataAdapter();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleAccept() {
    if (!token) {
      setError("邀请链接不完整，请向工作区管理员索取新的邀请链接。");
      return;
    }

    setPending(true);
    setError(null);
    try {
      await adapter.acceptInvitation(token);
      setNotice("邀请已接受，正在进入工作区…");
      window.setTimeout(() => window.location.assign("/"), 800);
    } catch (cause) {
      setError(authErrorMessage(cause));
      setPending(false);
    }
  }

  return (
    <div>
      <Badge tone="blue">旅行档案邀请</Badge>
      <h1 className="mt-3 font-display text-[clamp(1.75rem,1.5rem+0.7vw,2.25rem)] leading-tight font-semibold tracking-[-0.02em] text-ink">
        加入「{workspaceName}」
      </h1>
      <p className="mt-4 text-sm leading-6 text-muted">{inviterName} 邀请你共同维护旅行档案。</p>

      <div className="mt-8 rounded-card border border-hairline-strong bg-surface-1 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-pill border border-hairline bg-surface-2 text-accent-blue">
            <Users aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display text-xl leading-tight font-semibold tracking-[-0.015em] text-ink">
                {workspaceName}
              </p>
              <Badge tone={role === "viewer" ? "slate" : "green"}>{roleLabels[role]}</Badge>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">{roleDescriptions[role]}</p>
          </div>
        </div>
        <Separator className="my-4" />
        <ul className="space-y-2 text-xs leading-5 text-body">
          <li className="flex items-start gap-2">
            <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent-green" />
            旅行、共享日志和照片会出现在同一个工作区。
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent-blue" />
            访问权限由工作区角色控制；只读成员可以阅读全文并参与评论。
          </li>
        </ul>
      </div>

      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-control border border-hairline-strong bg-surface-1 px-3 py-2.5 text-xs leading-5 text-body"
        >
          {notice}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-control border border-accent-red/25 bg-accent-red/5 px-3 py-2.5 text-xs leading-5 text-accent-red"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="primary"
          size="lg"
          className="flex-1"
          onClick={() => void handleAccept()}
          disabled={pending}
        >
          <Check aria-hidden="true" />
          {pending ? "正在加入…" : "接受邀请"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="flex-1"
          onClick={() =>
            setNotice("已拒绝邀请。关闭页面即可，你不会加入这个工作区。")
          }
        >
          <X aria-hidden="true" />
          谢绝
        </Button>
      </div>

      <p className="mt-6 text-center text-xs text-muted">
        接受前请确认这是你预期的工作区。{" "}
        <a href="/login" className="text-ink underline-offset-4 hover:underline">
          先登录
        </a>
      </p>
    </div>
  );
}
