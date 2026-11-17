"use client";

import { Badge, Button, Separator } from "@roamlog/ui";
import { Check, ShieldCheck, Users, X } from "lucide-react";
import { useState } from "react";

import { authErrorMessage } from "@/lib/api/auth";
import { useDataAdapter, useDataMode } from "@/lib/data-provider";

interface InviteAcceptProps {
  workspaceName: string;
  inviterName: string;
  role: "editor" | "viewer" | "admin";
  token?: string;
}

const roleDescriptions = {
  admin: "可以管理成员、邀请和 Workspace 设置。",
  editor: "可以创建与编辑旅行、日志、照片和行程。",
  viewer: "可以阅读全部共享内容，并参与评论。",
} as const;

export function InviteAccept({ workspaceName, inviterName, role, token }: InviteAcceptProps) {
  const mode = useDataMode();
  const adapter = useDataAdapter();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleAccept() {
    if (mode === "mock") {
      setNotice("接受邀请的接口占位已记录。真实邀请校验将在身份后端接入后启用。");
      return;
    }
    if (!token) {
      setError("邀请链接缺少 token。请向 Workspace 管理员索取新的邀请。");
      return;
    }

    setPending(true);
    setError(null);
    try {
      await adapter.acceptInvitation(token);
      setNotice("邀请已接受，正在进入 Workspace…");
      window.setTimeout(() => window.location.assign("/"), 800);
    } catch (cause) {
      setError(authErrorMessage(cause));
      setPending(false);
    }
  }

  return (
    <div>
      <Badge tone="blue">WORKSPACE INVITATION</Badge>
      <h1 className="mt-4 font-serif text-[clamp(2rem,1.5rem+1vw,2.75rem)] leading-none tracking-[-0.035em] text-ink">
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
              <p className="font-serif text-2xl leading-none tracking-[-0.02em] text-ink">
                {workspaceName}
              </p>
              <Badge tone={role === "viewer" ? "slate" : "green"}>{role}</Badge>
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">{roleDescriptions[role]}</p>
          </div>
        </div>
        <Separator className="my-4" />
        <ul className="space-y-2 text-xs leading-5 text-body">
          <li className="flex items-start gap-2">
            <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent-green" />9
            趟旅行、共享日志和照片会出现在同一个 Workspace。
          </li>
          <li className="flex items-start gap-2">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent-blue" />
            访问权限由 Workspace 角色控制，Viewer 只读但可以评论。
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
            setNotice(
              mode === "mock"
                ? "已记录谢绝选择；当前不会向服务端发送状态。"
                : "已记录谢绝选择；关闭页面即可，服务端不会加入该 Workspace。",
            )
          }
        >
          <X aria-hidden="true" />
          谢绝
        </Button>
      </div>

      <p className="mt-6 text-center text-xs text-muted">
        接受前请确认这是你预期的 Workspace。{" "}
        <a href="/login" className="text-ink underline-offset-4 hover:underline">
          先登录
        </a>
      </p>
    </div>
  );
}
